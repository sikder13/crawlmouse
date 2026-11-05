import { describe, expect, it, vi } from 'vitest';
import type { RenderReply } from './client.js';
import { REQUEST_TIMEOUT_MS } from './client.js';
import { fakeClient, memoryDailyBudget, replyFixtures, type ReplyFixture } from './fakes.js';
import { NotAdmitted } from './admission.js';
import { RENDER_FAILURES } from './client.js';
import {
  NOT_RENDERED,
  RENDER_IN_FLIGHT,
  RESERVE_PER_RENDER_MS,
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
    daily: memoryDailyBudget(),
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
    expect(out.estimate.label).toBe(
      "estimated from 3 measured pages across 3 of 3 templates; 100 % of the estimate's weight rests on one measured page per template",
    );
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

  it.each([
    [{ perCheckMs: 0, perDayMs: 3_600_000 }],
    [{ perCheckMs: 600_000, perDayMs: 0 }],
    [{ perCheckMs: NaN, perDayMs: 3_600_000 }],
    [{ perCheckMs: 600_000, perDayMs: Infinity }],
    [{ perCheckMs: -1, perDayMs: 3_600_000 }],
  ])(
    'is caps_not_configured when a cap is not a positive finite number (%j), with no request made',
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
    // Room for one page's two reservations and a second's only if the first used under a second.
    const out = await renderCheck(
      input({
        client,
        caps: { perCheckMs: 2 * RESERVE_PER_RENDER_MS + 1000, perDayMs: 3_600_000 },
      }),
    );
    expect(out.pages.map((p) => (p.rendered ? 'rendered' : p.reason))).toEqual([
      'rendered',
      'check_cap',
      'check_cap',
    ]);
    expect(client.calls).toHaveLength(2);
  });
});

describe('a render whose browser time is not known', () => {
  it('counts at its reservation, so a check held to one page’s reservation stays within it', async () => {
    const unknown: RenderReply = {
      ok: true,
      html: '<body><main><p>a b</p></main></body>',
      browserMs: REQUEST_TIMEOUT_MS,
    };
    const client = fakeClient(FIXTURES.values(), { before: () => unknown });
    const out = await renderCheck(
      input({ client, caps: { perCheckMs: 2 * RESERVE_PER_RENDER_MS, perDayMs: 3_600_000 } }),
    );
    expect(RESERVE_PER_RENDER_MS).toBe(REQUEST_TIMEOUT_MS);
    expect(out.browser_ms).toBeLessThanOrEqual(2 * RESERVE_PER_RENDER_MS);
    expect(out.pages.map((p) => (p.rendered ? 'rendered' : p.reason))).toEqual([
      'rendered',
      'check_cap',
      'check_cap',
    ]);
  });
});

describe('a cap that binds while pages are in flight', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    provenance: 'test',
    url: `https://site.example/m${i}`,
    static: { html: '<body><main><p>a b</p></main></body>', browser_ms: 500 },
    rendered: { html: '<body><main><p>a b c d</p></main></body>', browser_ms: 500 },
  }));
  const candidates = many.map((f, i) => candidate(f, `/m${i}`));

  it('lets a page wait for another of the check to finish, so a cap with room for one reservation renders them all', async () => {
    // One page's reservation plus what eight pages use, 1 s each.
    const out = await renderCheck(
      input({
        client: fakeClient(many, { delayMs: 2 }),
        candidates,
        caps: { perCheckMs: 2 * RESERVE_PER_RENDER_MS + 8 * 1000, perDayMs: 3_600_000 },
      }),
    );
    expect(out.pages.map((p) => p.rendered)).toEqual(many.map(() => true));
    expect(out.browser_ms).toBe(8 * 1000);
  });

  it('frees what a page did not use for the pages after it, within the check', async () => {
    // The check's cap is one page's reservation plus what seven pages use, 1 s each, less a millisecond:
    // seven pages give back what they held and did not use, and the eighth finds no room.
    const out = await renderCheck(
      input({
        client: fakeClient(many, { delayMs: 2 }),
        candidates,
        caps: { perCheckMs: 2 * RESERVE_PER_RENDER_MS + 7 * 1000 - 1, perDayMs: 3_600_000 },
      }),
    );
    expect(out.pages.map((p) => (p.rendered ? 'rendered' : p.reason))).toEqual([
      ...Array(7).fill('rendered'),
      'check_cap',
    ]);
  });
});

describe('the estimate behind a check', () => {
  it('counts a URL the crawl lists under two templates once', async () => {
    const f = fixture('server-rendered');
    const out = await renderCheck(
      input({ candidates: [candidate(f, '/g', 0.5), candidate(f, '/f', 0.5)] }),
    );
    expect(out.estimate.measured_pages).toBe(1);
    expect(out.estimate.templates_total).toBe(1);
  });

  it('weights by every graded page, including one robots.txt kept from the render', async () => {
    const kept = {
      ...candidate({ url: 'https://site.example/kept' }, '/kept'),
      fetched_under_our_robots: false,
    };
    const out = await renderCheck(input({ candidates: [...THREE, kept] }));
    expect(out.estimate.templates_total).toBe(4);
    expect(out.estimate.unrendered_share).toBe(0.25);
  });
});

describe('the per-day cap', () => {
  // More pages than in-flight slots, so a per-page question would be asked more than once.
  const eight = Array.from({ length: 8 }, (_, i) => ({
    provenance: 'test',
    url: `https://site.example/e${i}`,
    static: { html: '<body><main><p>a b</p></main></body>', browser_ms: 500 },
    rendered: { html: '<body><main><p>a b c d</p></main></body>', browser_ms: 500 },
  }));
  const eightCandidates = eight.map((f, i) => candidate(f, `/e${i}`));
  const pageReserve = 2 * RESERVE_PER_RENDER_MS;

  it('is asked once, before any request, for the check’s cap when its pages could reserve more', async () => {
    const reserve = vi.fn(async (_ms: number, _limitMs: number) => true);
    const client = fakeClient(eight, { delayMs: 1 });
    const first: number[] = [];
    reserve.mockImplementation(async () => {
      first.push(client.calls.length);
      return true;
    });
    await renderCheck(
      input({
        client,
        candidates: eightCandidates,
        caps: { perCheckMs: 3 * pageReserve, perDayMs: 123_000_000 },
        daily: { reserve, settle: async () => {} },
      }),
    );
    expect(reserve.mock.calls).toEqual([[3 * pageReserve, 123_000_000]]);
    expect(first).toEqual([0]);
  });

  it('is asked for two reservations per sampled page when that is less than the cap', async () => {
    const reserve = vi.fn(async (_ms: number, _limitMs: number) => true);
    await renderCheck(
      input({
        caps: { perCheckMs: 600_000, perDayMs: 123_000 },
        daily: { reserve, settle: async () => {} },
      }),
    );
    expect(3 * pageReserve).toBeLessThan(600_000);
    expect(reserve.mock.calls).toEqual([[3 * pageReserve, 123_000]]);
  });

  it('settles once, after every page has finished, at the browser time the check counted', async () => {
    const client = fakeClient(eight, { delayMs: 2 });
    const settle = vi.fn(async (_reservedMs: number, _usedMs: number) => {
      expect(client.calls).toHaveLength(16);
      expect(client.maxInFlight).toBeGreaterThan(1);
    });
    const out = await renderCheck(
      input({
        client,
        candidates: eightCandidates,
        caps: { perCheckMs: 600_000, perDayMs: 3_600_000 },
        daily: { reserve: async () => true, settle },
      }),
    );
    expect(out.pages.every((p) => p.rendered)).toBe(true);
    expect(settle.mock.calls).toEqual([[600_000, 8 * 1000]]);
    expect(out.browser_ms).toBe(8 * 1000);
    expect(out.settle_failed).toBe(false);
  });

  it('renders nothing when today has room for less than the check’s allowance, and makes no request', async () => {
    const allowance = 8 * pageReserve;
    const run = (room: number) => {
      const client = fakeClient(eight, { delayMs: 1 });
      const daily = memoryDailyBudget(3_600_000 - room);
      return renderCheck(
        input({
          client,
          candidates: eightCandidates,
          caps: { perCheckMs: 1_000_000, perDayMs: 3_600_000 },
          daily,
        }),
      ).then((out) => ({ out, client, daily }));
    };
    const exact = await run(allowance);
    expect(exact.out.pages.every((p) => p.rendered)).toBe(true);
    const short = await run(allowance - 1);
    expect(short.out.pages.map((p) => !p.rendered && p.reason)).toEqual(Array(8).fill('daily_cap'));
    expect(short.client.calls).toEqual([]);
    expect(short.daily.usedMs()).toBe(0);
  });

  it('records daily_cap on a page admission would have refused, since no page is asked about', async () => {
    const admit = vi.fn(async () => {
      throw new NotAdmitted('ip_literal');
    });
    const out = await renderCheck(
      input({ admit, daily: { reserve: async () => false, settle: async () => {} } }),
    );
    expect(out.pages.map((p) => !p.rendered && p.reason)).toEqual(Array(3).fill('daily_cap'));
    expect(admit).not.toHaveBeenCalled();
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
    expect(daily.reserve).toHaveBeenCalledTimes(1);
    expect(daily.settle).not.toHaveBeenCalled();
  });

  it('is asked once when it refuses, and not settled', async () => {
    const reserve = vi.fn(async (_ms: number, _limitMs: number) => false);
    const settle = vi.fn(async () => {});
    const out = await renderCheck(
      input({ candidates: eightCandidates, daily: { reserve, settle } }),
    );
    expect(out.pages.every((p) => !p.rendered && p.reason === 'daily_cap')).toBe(true);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(settle).not.toHaveBeenCalled();
  });

  it('reports a settle that throws, and the pages it rendered stand', async () => {
    const out = await renderCheck(
      input({
        daily: {
          reserve: async () => true,
          settle: async () => {
            throw new Error('store down');
          },
        },
      }),
    );
    expect(out.pages.every((p) => p.rendered)).toBe(true);
    expect(out.settle_failed).toBe(true);
  });

  it.each([
    ['no client', { client: null }],
    ['a cap not configured', { caps: { perCheckMs: 0, perDayMs: 3_600_000 } }],
    ['no page sampled', { candidates: [] }],
  ] as const)('is not asked with %s', async (_name, over) => {
    const reserve = vi.fn(async () => true);
    await renderCheck(input({ ...over, daily: { reserve, settle: async () => {} } }));
    expect(reserve).not.toHaveBeenCalled();
  });

  it('is not asked when the check’s cap is below one page’s reservation: every page is check_cap', async () => {
    const reserve = vi.fn(async () => true);
    const out = await renderCheck(
      input({
        caps: { perCheckMs: pageReserve - 1, perDayMs: 3_600_000 },
        daily: { reserve, settle: async () => {} },
      }),
    );
    expect(out.pages.map((p) => !p.rendered && p.reason)).toEqual(Array(3).fill('check_cap'));
    expect(reserve).not.toHaveBeenCalled();
  });

  it('takes only true as a reservation granted', async () => {
    const reserve = vi.fn(async () => 'false' as unknown as boolean);
    const out = await renderCheck(input({ daily: { reserve, settle: async () => {} } }));
    expect(out.pages.every((p) => !p.rendered && p.reason === 'daily_cap')).toBe(true);
  });

  it('gives back what the check did not use', async () => {
    const daily = memoryDailyBudget();
    const out = await renderCheck(input({ daily }));
    expect(daily.usedMs()).toBe(out.browser_ms);
  });
});

describe('a page that throws out of the render', () => {
  it('lets the other pages finish, settles what the check counted, and then throws', async () => {
    const log: string[] = [];
    const tooMany: RenderReply = {
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: 1000,
      browserMs: 0,
    };
    const inner = fakeClient(FIXTURES.values(), {
      delayMs: 2,
      before: (_n, url) => (url === urlOf('server-rendered') ? tooMany : undefined),
    });
    const client = {
      async content(url: string, side: 'static' | 'rendered') {
        log.push('request');
        return inner.content(url, side);
      },
    };
    const settle = vi.fn(async (_reservedMs: number, _usedMs: number) => {
      log.push('settle');
    });
    const run = renderCheck(
      input({
        client,
        daily: { reserve: async () => true, settle },
        sleep: async () => {
          throw new Error('sleep failed');
        },
      }),
    );
    await expect(run).rejects.toThrow('sleep failed');
    expect(log.at(-1)).toBe('settle');
    expect(settle).toHaveBeenCalledTimes(1);
    // The two other pages rendered both sides; their time is in the settle.
    const other = [fixture('client-rendered'), fixture('partial')];
    const used = other.reduce((a, f) => a + f.static.browser_ms + f.rendered.browser_ms, 0);
    expect(settle.mock.calls[0]![1]).toBe(used);
  });
});

describe('a page that throws while other pages wait to start', () => {
  it('starts no further page', async () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({
      provenance: 'test',
      url: `https://site.example/t${i}`,
      static: { html: '<body><main><p>a b</p></main></body>', browser_ms: 500 },
      rendered: { html: '<body><main><p>a b c d</p></main></body>', browser_ms: 500 },
    }));
    const tooMany: RenderReply = {
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: 1000,
      browserMs: 0,
    };
    const client = fakeClient(pages, {
      delayMs: 2,
      before: (_n, url) => (url === pages[0]!.url ? tooMany : undefined),
    });
    const run = renderCheck(
      input({
        client,
        candidates: pages.map((f, i) => candidate(f, `/t${i}`, 0.9 - i / 100)),
        sleep: async () => {
          throw new Error('sleep failed');
        },
      }),
    );
    await expect(run).rejects.toThrow('sleep failed');
    const started = new Set(client.calls.map((c) => c.url));
    // The first five pages start together; the three after them do not start.
    expect(started.size).toBe(RENDER_IN_FLIGHT);
    expect(pages.slice(RENDER_IN_FLIGHT).some((f) => started.has(f.url))).toBe(false);
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

  it('does not wait longer than the backoff cap: a longer Retry-After leaves the page rate_limited', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const longWait: RenderReply = { ...tooMany, retryAfterMs: RENDER_RETRY.max_ms + 1 };
    const client = fakeClient(FIXTURES.values(), { before: () => longWait });
    const out = await renderCheck(input({ client, sleep, candidates: [THREE[0]!] }));
    expect(out.pages[0]).toMatchObject({ rendered: false, reason: 'rate_limited' });
    expect(sleep).not.toHaveBeenCalled();
    expect(client.calls).toHaveLength(1);
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
    const daily = memoryDailyBudget();
    const client = {
      content: vi.fn(async () => {
        throw new Error('client bug');
      }),
    };
    const out = await renderCheck(input({ client, daily, candidates: [THREE[0]!] }));
    expect(out.pages[0]).toMatchObject({ rendered: false, reason: 'network_error' });
    // Counted at the request timeout: the browser time of a request that threw is not known.
    expect(out.browser_ms).toBe(REQUEST_TIMEOUT_MS);
    expect(daily.usedMs()).toBe(REQUEST_TIMEOUT_MS);
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
