import { describe, expect, it, vi } from 'vitest';
import type { RenderReply } from './client.js';
import { RENDER_TIMEOUT_MS } from './client.js';
import { fakeClient, memoryDailyBudget, replyFixtures, type ReplyFixture } from './fakes.js';
import { NotAdmitted } from './admission.js';
import { RENDER_FAILURES } from './client.js';
import {
  NOT_RENDERED,
  RENDER_IN_FLIGHT,
  RENDER_RETRY,
  renderCheck,
  type RenderCheckInput,
} from './run.js';
import type { RenderCandidate } from './sample.js';

const FIXTURES = replyFixtures();
const fixture = (name: string) => FIXTURES.get(name)!;

const candidate = (
  f: Pick<ReplyFixture, 'url'>,
  template_key: string,
  pr = 0.1,
): RenderCandidate => ({
  url: f.url,
  template_key,
  kind: 'content',
  status_code: 200,
  is_html: true,
  pagerank_share: pr,
  fetched_under_our_robots: true,
});

const THREE = [
  candidate(fixture('server-rendered'), '/guide', 0.5),
  candidate(fixture('client-rendered'), '/products/{slug}', 0.4),
  candidate(fixture('partial'), '/blog/{slug}', 0.3),
];

const admitAll = async () => {};
const noSleep = async () => {};

function input(over: Partial<RenderCheckInput> = {}): RenderCheckInput {
  return {
    candidates: THREE,
    openFixTemplates: [],
    maxRenders: 25,
    previousStates: new Map(),
    client: fakeClient(FIXTURES.values()),
    admit: admitAll,
    caps: { perCheckMs: 600_000, perDayMs: 3_600_000 },
    daily: memoryDailyBudget(3_600_000),
    sleep: noSleep,
    ...over,
  };
}

const urlOf = (name: string) => fixture(name).url;

describe('a check whose renders all succeed', () => {
  it('measures each sampled page from its two renders, in the order they were picked', async () => {
    const out = await renderCheck(input());
    // One page per template, so each is a template pick, smallest key first among equal sizes.
    expect(out.pages).toEqual([
      {
        url: urlOf('partial'),
        template_key: '/blog/{slug}',
        picked_for: 'template',
        rendered: true,
        without_js: { raw_words: 50, rendered_words: 100, text_share: 0.5, state: 'partial' },
      },
      {
        url: urlOf('server-rendered'),
        template_key: '/guide',
        picked_for: 'template',
        rendered: true,
        without_js: { raw_words: 119, rendered_words: 119, text_share: 1, state: 'readable' },
      },
      {
        url: urlOf('client-rendered'),
        template_key: '/products/{slug}',
        picked_for: 'template',
        rendered: true,
        without_js: { raw_words: 0, rendered_words: 203, text_share: 0, state: 'empty_shell' },
      },
    ]);
  });

  it('meters the browser time of both sides of every page', async () => {
    const all = [...FIXTURES.values()];
    const expected = all.reduce((sum, f) => sum + f.static.browser_ms + f.rendered.browser_ms, 0);
    expect((await renderCheck(input())).browser_ms).toBe(expected);
  });

  it('renders the static side, then the rendered side, of each page', async () => {
    const client = fakeClient(FIXTURES.values());
    await renderCheck(input({ client, candidates: [THREE[0]!] }));
    expect(client.calls).toEqual([
      { url: urlOf('server-rendered'), side: 'static' },
      { url: urlOf('server-rendered'), side: 'rendered' },
    ]);
  });

  it('estimates the site from the graded pages', async () => {
    const out = await renderCheck(input());
    // By hand: three templates of one graded page each, shares 1, 0 and 0.5.
    expect(out.estimate.site_text_share).toBeCloseTo(0.5, 12);
    expect(out.estimate.label).toBe('estimated from 3 rendered pages across 3 of 3 templates');
  });

  it('uses each page’s previous state for the hysteresis', async () => {
    const shell = candidate({ url: 'https://site.example/shell' }, '/s');
    const html = (n: number) => `<body><main><p>${'w '.repeat(n)}</p></main></body>`;
    const f: ReplyFixture = {
      provenance: 'test',
      url: shell.url,
      static: { html: html(40), browser_ms: 1 },
      rendered: { html: html(100), browser_ms: 1 },
    };
    const run = (previous: Map<string, 'empty_shell'>) =>
      renderCheck(
        input({ candidates: [shell], client: fakeClient([f]), previousStates: previous }),
      );
    expect((await run(new Map())).pages[0]).toMatchObject({ without_js: { state: 'partial' } });
    expect((await run(new Map([[shell.url, 'empty_shell']]))).pages[0]).toMatchObject({
      without_js: { state: 'empty_shell' },
    });
  });
});

describe('a check that renders nothing, and does not fail', () => {
  it('is not_configured without a client', async () => {
    const out = await renderCheck(input({ client: null }));
    expect(out.pages.map((p) => [p.rendered, 'reason' in p && p.reason])).toEqual([
      [false, 'not_configured'],
      [false, 'not_configured'],
      [false, 'not_configured'],
    ]);
    expect(out.browser_ms).toBe(0);
    expect(out.estimate.site_text_share).toBeNull();
  });

  it.each([[{ perCheckMs: 0, perDayMs: 3_600_000 }], [{ perCheckMs: 600_000, perDayMs: 0 }]])(
    'is caps_not_configured when a cap is zero (%j), with no request made',
    async (caps) => {
      const client = fakeClient(FIXTURES.values());
      const out = await renderCheck(input({ client, caps }));
      expect(out.pages.every((p) => !p.rendered && p.reason === 'caps_not_configured')).toBe(true);
      expect(client.calls).toEqual([]);
    },
  );
});

describe('a page refused at admission', () => {
  it('is not_admitted with the rule, and no request is made for it', async () => {
    const client = fakeClient(FIXTURES.values());
    const admit = async (url: string) => {
      if (url === urlOf('partial')) throw new NotAdmitted('resolution');
    };
    const out = await renderCheck(input({ client, admit }));
    expect(out.pages[0]).toEqual({
      url: urlOf('partial'),
      template_key: '/blog/{slug}',
      picked_for: 'template',
      rendered: false,
      reason: 'not_admitted',
      detail: 'resolution',
    });
    expect(client.calls.some((c) => c.url === urlOf('partial'))).toBe(false);
  });
});

describe('the per-check cap', () => {
  it('stops rendering once a further render would pass it, and records why', async () => {
    const client = fakeClient(FIXTURES.values());
    // Room for exactly two renders' reservations: one page, both sides.
    const out = await renderCheck(
      input({ client, caps: { perCheckMs: 2 * RENDER_TIMEOUT_MS, perDayMs: 3_600_000 } }),
    );
    expect(out.pages.map((p) => (p.rendered ? 'rendered' : p.reason))).toEqual([
      'rendered',
      'check_cap',
      'check_cap',
    ]);
    expect(client.calls).toHaveLength(2);
  });
});

describe('the per-day cap', () => {
  it('stops rendering when today’s budget refuses a reservation', async () => {
    const client = fakeClient(FIXTURES.values());
    const out = await renderCheck(
      input({ client, daily: memoryDailyBudget(2 * RENDER_TIMEOUT_MS) }),
    );
    expect(out.pages.map((p) => (p.rendered ? 'rendered' : p.reason))).toEqual([
      'rendered',
      'daily_cap',
      'daily_cap',
    ]);
  });

  it('fails closed when the budget cannot be read: nothing renders, the check does not fail', async () => {
    const client = fakeClient(FIXTURES.values());
    const daily = {
      reserve: vi.fn(async () => {
        throw new Error('store unreachable');
      }),
      settle: vi.fn(async () => {}),
    };
    const out = await renderCheck(input({ client, daily }));
    expect(out.pages.every((p) => !p.rendered && p.reason === 'daily_budget_unavailable')).toBe(
      true,
    );
    expect(client.calls).toEqual([]);
  });

  it('gives back what a render did not use', async () => {
    const daily = memoryDailyBudget(3_600_000);
    const out = await renderCheck(input({ daily }));
    expect(daily.usedMs()).toBe(out.browser_ms);
  });
});

describe('a 429 from Browser Run', () => {
  const tooMany: RenderReply = {
    ok: false,
    reason: 'rate_limited',
    retryAfterMs: 2000,
    browserMs: 0,
  };

  it('is retried after the wait it asks for, and the page is still measured', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const client = fakeClient(FIXTURES.values(), { before: (n) => (n <= 2 ? tooMany : undefined) });
    const out = await renderCheck(input({ client, sleep, candidates: [THREE[0]!] }));
    expect(out.pages[0]).toMatchObject({ rendered: true });
    expect(sleep.mock.calls).toEqual([[2000], [2000]]);
  });

  it('backs off exponentially when it gives no wait', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const noWait: RenderReply = { ...tooMany, retryAfterMs: null };
    const client = fakeClient(FIXTURES.values(), { before: (n) => (n <= 3 ? noWait : undefined) });
    await renderCheck(input({ client, sleep, candidates: [THREE[0]!] }));
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      RENDER_RETRY.base_ms,
      RENDER_RETRY.base_ms * 2,
      RENDER_RETRY.base_ms * 4,
    ]);
  });

  it('leaves the page rate_limited once the attempts run out, and the check does not fail', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const client = fakeClient(FIXTURES.values(), { before: () => tooMany });
    const out = await renderCheck(input({ client, sleep }));
    expect(out.pages.map((p) => !p.rendered && p.reason)).toEqual([
      'rate_limited',
      'rate_limited',
      'rate_limited',
    ]);
    // Each page stops at its static side: RENDER_RETRY.attempts calls, never a rendered-side call.
    expect(client.calls).toHaveLength(3 * RENDER_RETRY.attempts);
    expect(client.calls.every((c) => c.side === 'static')).toBe(true);
  });

  it('is queued under the in-flight limit', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      provenance: 'test',
      url: `https://site.example/p${i}`,
      static: { html: '<body><main><p>a b</p></main></body>', browser_ms: 1 },
      rendered: { html: '<body><main><p>a b c d</p></main></body>', browser_ms: 1 },
    }));
    const client = fakeClient(many, {
      delayMs: 5,
      before: (n) => (n % 3 === 0 ? tooMany : undefined),
    });
    const out = await renderCheck(
      input({
        client,
        candidates: many.map((f, i) => candidate(f, `/t${i}`)),
        maxRenders: 14,
      }),
    );
    expect(RENDER_IN_FLIGHT).toBe(5);
    expect(client.maxInFlight).toBe(RENDER_IN_FLIGHT);
    expect(out.pages.every((p) => p.rendered)).toBe(true);
  });
});

describe('a client that throws', () => {
  it('is read as network_error, the check goes on, and the reservation is settled', async () => {
    const daily = memoryDailyBudget(3_600_000);
    const client = {
      content: vi.fn(async () => {
        throw new Error('client bug');
      }),
    };
    const out = await renderCheck(input({ client, daily, candidates: [THREE[0]!] }));
    expect(out.pages[0]).toMatchObject({ rendered: false, reason: 'network_error' });
    // Counted at the wait cap: the browser time of a request that threw is not known.
    expect(out.browser_ms).toBe(RENDER_TIMEOUT_MS);
    expect(daily.usedMs()).toBe(RENDER_TIMEOUT_MS);
  });
});

describe('a render that fails', () => {
  it.each(['page_failed', 'api_error', 'bad_reply', 'oversize', 'network_error'] as const)(
    'is recorded as %s, and the check does not fail',
    async (reason) => {
      const failed: RenderReply = { ok: false, reason, retryAfterMs: null, browserMs: 900 };
      const client = fakeClient(FIXTURES.values(), {
        before: (_n, _u, side) => (side === 'rendered' ? failed : undefined),
      });
      const out = await renderCheck(input({ client, candidates: [THREE[0]!] }));
      expect(out.pages[0]).toMatchObject({ rendered: false, reason });
      expect(out.browser_ms).toBe(fixture('server-rendered').static.browser_ms + 900);
    },
  );

  it('is challenged when the render is a challenge page', async () => {
    const challenge: RenderReply = {
      ok: true,
      html: '<html><head><title>Just a moment...</title></head><body></body></html>',
      browserMs: 10,
    };
    const client = fakeClient(FIXTURES.values(), { before: () => challenge });
    const out = await renderCheck(input({ client, candidates: [THREE[0]!] }));
    expect(out.pages[0]).toMatchObject({ rendered: false, reason: 'challenged' });
  });
});

describe('the reasons a page is not rendered', () => {
  it('give a meaning for every way a render can fail', () => {
    for (const f of RENDER_FAILURES) expect(Object.keys(NOT_RENDERED)).toContain(f);
  });
});
