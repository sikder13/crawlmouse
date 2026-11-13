/**
 * The empty-root phase of a check's render (run.ts): it runs after the graded phase has settled,
 * under its own allowance, its own reservation from today's budget and its own stop, so the graded
 * phase's pages and the site estimate are what they would be with no empty-root page offered. Each
 * case below runs the same check twice, with the empty-root pool empty and full, under caps that bind.
 */
import { describe, expect, it } from 'vitest';
import { NotAdmitted } from './admission.js';
import type { DailyBudget } from './budget.js';
import { EMPTY_ROOT_MAX_RENDERS, type EmptyRootCandidate } from './empty-root.js';
import { fakeClient, memoryDailyBudget, replyFixtures, type ReplyFixture } from './fakes.js';
import {
  renderCheck,
  RESERVE_PER_RENDER_MS,
  type RenderCheckInput,
  type RenderOutcome,
} from './run.js';
import { detectRendered } from '../detectors/rendered.js';
import { renderedConfidence } from '../grade/outcomes.js';
import type { RenderCandidate } from './sample.js';

const PAGE = 2 * RESERVE_PER_RENDER_MS;
const FIXTURES = replyFixtures();

const graded = (name: string, template_key: string, pr: number): RenderCandidate => ({
  url: FIXTURES.get(name)!.url,
  template_key,
  kind: 'content',
  status_code: 200,
  is_html: true,
  pagerank_share: pr,
  fetched_under_our_robots: true,
});

const GRADED = [
  graded('server-rendered', '/guide', 0.5),
  graded('client-rendered', '/products/{slug}', 0.4),
  graded('partial', '/blog/{slug}', 0.3),
];
/** What the graded phase counts when each of its pages renders: the fixtures' reported times. */
const GRADED_MS = [...FIXTURES.values()].reduce(
  (n, f) => n + f.static.browser_ms + f.rendered.browser_ms,
  0,
);

/** An app shell: an empty root without JavaScript, a page of text with it. */
const shellReply = (path: string): ReplyFixture => ({
  provenance: 'generated',
  url: `https://site.example${path}`,
  static: { html: '<html><body><div id="root"></div></body></html>', browser_ms: 700 },
  rendered: {
    html: `<html><body><main><h1>${path}</h1><p>${'word '.repeat(80)}</p></main></body></html>`,
    browser_ms: 1300,
  },
});
const SHELL_PATHS = ['/app/1', '/app/2', '/app/3', '/work/1', '/work/2', '/work/3', '/x'];
const SHELLS = SHELL_PATHS.map(shellReply);
const POOL: EmptyRootCandidate[] = SHELLS.map((s, i) => ({
  url: s.url,
  template_key: s.url.includes('/app/')
    ? '/app/{n}'
    : s.url.includes('/work/')
      ? '/work/{n}'
      : '/x',
  kind: 'thin',
  status_code: 200,
  is_html: true,
  pagerank_share: 0.01 * (i + 1),
  fetched_under_our_robots: true,
  client_rendered: true,
}));

/** A daily budget that records each call, answering `reserve` and `settle` by call number. */
function recordingBudget(
  reserveAt: (n: number, ms: number, limitMs: number) => Promise<boolean> | boolean,
  settleAt: (n: number) => Promise<void> | void = () => {},
) {
  const calls: string[] = [];
  let reserves = 0;
  let settles = 0;
  const daily: DailyBudget = {
    async reserve(ms, limitMs) {
      calls.push(`reserve ${ms}`);
      return reserveAt(++reserves, ms, limitMs);
    },
    async settle(reservedMs, usedMs) {
      calls.push(`settle ${reservedMs} ${usedMs}`);
      await settleAt(++settles);
    },
  };
  return { daily, calls };
}

function input(over: Partial<RenderCheckInput>): RenderCheckInput {
  return {
    candidates: GRADED,
    openFixTemplates: [],
    maxRenders: 25,
    previousStates: new Map(),
    client: fakeClient([...FIXTURES.values(), ...SHELLS]),
    admit: async () => {},
    caps: { perCheckMs: 600_000, perDayMs: 3_600_000 },
    daily: memoryDailyBudget(),
    sleep: async () => {},
    inFlight: 1,
    emptyRootCandidates: POOL,
    maxEmptyRootRenders: EMPTY_ROOT_MAX_RENDERS,
    ...over,
  };
}

/** The same check with no empty-root page offered, and with the pool: both outcomes. */
async function both(make: () => Partial<RenderCheckInput>) {
  const without = await renderCheck(input({ ...make(), emptyRootCandidates: [] }));
  const withPool = await renderCheck(input(make()));
  return { without, withPool };
}

/** The graded phase's part of an outcome: its pages and the estimate drawn from them. */
const gradedPart = (o: RenderOutcome) => ({
  pages: o.pages.filter((p) => p.picked_for !== 'empty_root'),
  estimate: o.estimate,
});
const emptyRootPart = (o: RenderOutcome) => o.pages.filter((p) => p.picked_for === 'empty_root');

describe('with room for both phases', () => {
  it('renders the graded pages, then the empty-root picks, and counts both phases’ browser time', async () => {
    const { without, withPool } = await both(() => ({}));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(withPool.pages.slice(0, GRADED.length)).toEqual(without.pages);
    expect(emptyRootPart(withPool).map((p) => [p.url.slice(20), p.rendered])).toEqual([
      ['/app/3', true],
      ['/app/2', true],
      ['/work/3', true],
      ['/work/2', true],
      ['/x', true],
    ]);
    for (const p of emptyRootPart(withPool)) {
      expect(p.rendered && p.without_js.state).toBe('empty_shell');
    }
    expect(withPool.browser_ms).toBe(without.browser_ms + 5 * (700 + 1300));
  });

  it('asks today’s budget once a phase, the empty-root phase only after the graded one settled', async () => {
    const { daily, calls } = recordingBudget(() => true);
    await renderCheck(input({ daily }));
    expect(calls).toEqual([
      `reserve ${3 * PAGE}`,
      `settle ${3 * PAGE} ${GRADED_MS}`,
      `reserve ${5 * PAGE}`,
      `settle ${5 * PAGE} ${5 * 2000}`,
    ]);
  });

  it('starts no render of the empty-root phase before the graded phase’s last render', async () => {
    const client = fakeClient([...FIXTURES.values(), ...SHELLS]);
    await renderCheck(input({ client, inFlight: 2 }));
    const isShell = client.calls.map((c) => SHELLS.some((s) => s.url === c.url));
    const firstShell = isShell.indexOf(true);
    const lastGraded = isShell.lastIndexOf(false);
    expect(firstShell).toBeGreaterThan(-1);
    expect(firstShell).toBeGreaterThan(lastGraded);
  });

  it('renders nothing more when no empty-root pool or cap is passed', async () => {
    const plain = await renderCheck(
      input({ emptyRootCandidates: undefined, maxEmptyRootRenders: undefined }),
    );
    expect(emptyRootPart(plain)).toEqual([]);
    const capped = await renderCheck(input({ maxEmptyRootRenders: 0 }));
    expect(emptyRootPart(capped)).toEqual([]);
  });

  it('does not render a URL the graded phase took', async () => {
    const twice: EmptyRootCandidate = { ...POOL[0]!, url: GRADED[0]!.url };
    const out = await renderCheck(input({ emptyRootCandidates: [twice] }));
    expect(out.pages.filter((p) => p.url === GRADED[0]!.url)).toHaveLength(1);
    expect(emptyRootPart(out)).toEqual([]);
  });
});

describe('admission, in the empty-root phase', () => {
  it('refuses an empty-root URL as it refuses a graded one: not_admitted with the rule, no request, the graded phase unchanged', async () => {
    // /app/3, the empty-root phase's first pick
    const refused = SHELLS[2]!.url;
    const admit = async (url: string) => {
      if (url === refused) throw new NotAdmitted('private_address');
    };
    const { without, withPool } = await both(() => ({ admit }));
    const client = fakeClient([...FIXTURES.values(), ...SHELLS]);
    await renderCheck(input({ admit, client }));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(emptyRootPart(withPool).find((p) => p.url === refused)).toMatchObject({
      rendered: false,
      reason: 'not_admitted',
      detail: 'private_address',
    });
    expect(client.calls.filter((c) => c.url === refused)).toEqual([]);
    expect(emptyRootPart(withPool).filter((p) => p.rendered)).toHaveLength(4);
  });
});

describe('under caps that bind, the graded phase is what it is with no empty-root page offered', () => {
  it('a per-check cap the graded phase uses up: each empty-root page is check_cap', async () => {
    const { without, withPool } = await both(() => ({
      caps: { perCheckMs: GRADED_MS + PAGE - 1, perDayMs: 3_600_000 },
    }));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(without.pages.every((p) => p.rendered)).toBe(true);
    expect(emptyRootPart(withPool).map((p) => !p.rendered && p.reason)).toEqual(
      Array(5).fill('check_cap'),
    );
    expect(withPool.browser_ms).toBe(without.browser_ms);
  });

  it('a per-check cap with room for one more page: the empty-root phase renders one, then stops', async () => {
    const { without, withPool } = await both(() => ({
      caps: { perCheckMs: GRADED_MS + PAGE, perDayMs: 3_600_000 },
    }));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(emptyRootPart(withPool).map((p) => p.rendered || p.reason)).toEqual([
      true,
      ...Array(4).fill('check_cap'),
    ]);
  });

  it('a per-day cap the graded phase’s allowance fills: the empty-root phase is refused, daily_cap', async () => {
    const { without, withPool } = await both(() => ({
      caps: { perCheckMs: 600_000, perDayMs: 3 * PAGE },
    }));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(without.pages.every((p) => p.rendered)).toBe(true);
    expect(emptyRootPart(withPool).map((p) => !p.rendered && p.reason)).toEqual(
      Array(5).fill('daily_cap'),
    );
  });

  it('a budget that refuses the second reservation: only the empty-root pages carry it', async () => {
    const { without, withPool } = await both(() => ({
      daily: recordingBudget((n) => n === 1).daily,
    }));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(emptyRootPart(withPool).map((p) => !p.rendered && p.reason)).toEqual(
      Array(5).fill('daily_cap'),
    );
  });

  it('a budget that throws on the second reservation: only the empty-root pages carry it', async () => {
    const { without, withPool } = await both(() => ({
      daily: recordingBudget((n) => {
        if (n > 1) throw new Error('store down');
        return true;
      }).daily,
    }));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(emptyRootPart(withPool).map((p) => !p.rendered && p.reason)).toEqual(
      Array(5).fill('daily_budget_unavailable'),
    );
    expect(withPool.settle_failed).toBe(false);
  });

  it('a budget that throws on the second settle: settle_failed, and the graded pages unchanged', async () => {
    const { without, withPool } = await both(() => ({
      daily: recordingBudget(
        () => true,
        (n) => {
          if (n > 1) throw new Error('store down');
        },
      ).daily,
    }));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect([without.settle_failed, withPool.settle_failed]).toEqual([false, true]);
  });

  it('an empty-root page Browser Run fails: that page only', async () => {
    const failing = (n: number, url: string) =>
      url.endsWith('/app/3')
        ? ({ ok: false, reason: 'page_failed', retryAfterMs: null, browserMs: 100 } as const)
        : undefined;
    const { without, withPool } = await both(() => ({
      client: fakeClient([...FIXTURES.values(), ...SHELLS], { before: failing }),
    }));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(emptyRootPart(withPool).map((p) => p.rendered || p.reason)).toEqual([
      'page_failed',
      true,
      true,
      true,
      true,
    ]);
  });

  it('a graded phase today’s budget refused: the empty-root phase does not ask it again', async () => {
    const { daily, calls } = recordingBudget(() => false);
    const out = await renderCheck(input({ daily }));
    expect(out.pages.map((p) => !p.rendered && p.reason)).toEqual(Array(8).fill('daily_cap'));
    expect(calls).toEqual([`reserve ${3 * PAGE}`]);
  });

  it('a graded phase whose budget threw: the empty-root phase does not ask it again', async () => {
    const { daily, calls } = recordingBudget(() => {
      throw new Error('store down');
    });
    const out = await renderCheck(input({ daily }));
    expect(out.pages.map((p) => !p.rendered && p.reason)).toEqual(
      Array(8).fill('daily_budget_unavailable'),
    );
    expect(calls).toEqual([`reserve ${3 * PAGE}`]);
  });
});

describe('a throw out of a page', () => {
  it('in the graded phase is passed on, and the empty-root phase does not run', async () => {
    const client = fakeClient([...FIXTURES.values(), ...SHELLS], {
      before: () => ({ ok: false, reason: 'rate_limited', retryAfterMs: 1, browserMs: 0 }),
    });
    await expect(
      renderCheck(
        input({
          client,
          sleep: async () => {
            throw new Error('timer gone');
          },
        }),
      ),
    ).rejects.toThrow('timer gone');
    expect(client.calls.some((c) => SHELLS.some((s) => s.url === c.url))).toBe(false);
  });

  it('r6: in the empty-root phase leaves that phase phase_threw, settles, and keeps the graded outcome', async () => {
    const isShell = (url: string) => SHELLS.some((s) => s.url === url);
    const make = () => {
      const { daily, calls } = recordingBudget(() => true);
      return {
        calls,
        over: {
          daily,
          client: fakeClient([...FIXTURES.values(), ...SHELLS], {
            before: (_n: number, url: string) =>
              isShell(url)
                ? ({ ok: false, reason: 'rate_limited', retryAfterMs: 1, browserMs: 0 } as const)
                : undefined,
          }),
          sleep: async () => {
            throw new Error('timer gone');
          },
        },
      };
    };
    const off = make();
    const without = await renderCheck(input({ ...off.over, emptyRootCandidates: [] }));
    const on = make();
    const withPool = await renderCheck(input(on.over));
    expect(gradedPart(withPool)).toEqual(gradedPart(without));
    expect(emptyRootPart(withPool).map((p) => !p.rendered && p.reason)).toEqual(
      Array(5).fill('phase_threw'),
    );
    expect(on.calls).toEqual([
      `reserve ${3 * PAGE}`,
      `settle ${3 * PAGE} ${GRADED_MS}`,
      `reserve ${5 * PAGE}`,
      `settle ${5 * PAGE} 0`,
    ]);
  });
});

describe('r5: a large site, where the graded phase takes the cap and the empty-root phase still renders', () => {
  it('spends its renders on the template with no graded page, and the shells of a graded template decide nothing', async () => {
    const text = `<html><body><main><h1>x</h1><p>${'word '.repeat(80)}</p></main></body></html>`;
    const empty = '<html><body><div id="root"></div></body></html>';
    const t = (i: number) => `/t${String(i).padStart(2, '0')}`;
    const shellAt = (template: string, k: number) => `https://s.example${template}/shell${k}`;
    const replies: ReplyFixture[] = [
      ...Array.from({ length: 30 }, (_, i) => ({
        provenance: 'r5',
        url: `https://s.example${t(i)}/a`,
        static: { html: text, browser_ms: 1000 },
        rendered: { html: text, browser_ms: 1000 },
      })),
      ...[t(29), '/shell'].flatMap((template) =>
        [1, 2].map((k) => ({
          provenance: 'r5',
          url: shellAt(template, k),
          static: { html: empty, browser_ms: 500 },
          rendered: { html: text, browser_ms: 900 },
        })),
      ),
    ];
    const candidates: RenderCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      url: `https://s.example${t(i)}/a`,
      template_key: t(i),
      kind: 'content',
      status_code: 200,
      is_html: true,
      pagerank_share: 0.01,
      fetched_under_our_robots: true,
    }));
    const ers: EmptyRootCandidate[] = [t(29), '/shell'].flatMap((template) =>
      [1, 2].map((k) => ({
        url: shellAt(template, k),
        template_key: template,
        kind: 'thin' as const,
        status_code: 200,
        is_html: true,
        pagerank_share: 0.001,
        fetched_under_our_robots: true,
        client_rendered: true,
      })),
    );
    // the pool is every crawled page, as renderCandidates passes it
    const pool = [...candidates.map((c) => ({ ...c, client_rendered: false })), ...ers];
    const out = await renderCheck(
      input({
        candidates,
        client: fakeClient(replies),
        caps: { perCheckMs: 2_250_000, perDayMs: 36_000_000 },
        inFlight: 2,
        emptyRootCandidates: pool,
      }),
    );
    const er = emptyRootPart(out);
    expect(out.pages.length - er.length).toBe(25);
    expect(er.map((p) => [p.template_key, p.rendered])).toEqual([
      ['/shell', true],
      ['/shell', true],
    ]);
    const measured = new Map(
      out.pages.flatMap((p) => (p.rendered ? [[p.url, p.without_js] as const] : [])),
    );
    const pages = [...candidates, ...ers].map((c) => ({
      ...c,
      without_js: measured.get(c.url) ?? null,
    }));
    const records = detectRendered(pages, { emptyRoots: new Set(ers.map((e) => e.url)) });
    const r29 = records.find((x) => x.template_key === t(29))!;
    expect(r29).toMatchObject({
      state: 'indeterminate',
      reason: 'not_rendered',
      extent: { pages: 3, graded: 1, rendered: 0 },
      affected_urls: [],
    });
    expect(renderedConfidence(r29)).toBe('likely');
    expect(records.find((x) => x.template_key === '/shell')).toMatchObject({
      state: 'detected',
      extent: { pages: 2, graded: 0, rendered: 2 },
    });
  });
});
