/**
 * Generative properties of the AI readability components, over synthetic inputs: every score lies
 * within its component's bounds, no input moves a score the wrong way, and the grade is withheld
 * exactly when the rule in SPEC 17 says. The exact values are pinned by formula-table.test.ts.
 */
import { AiReadabilitySchema, type ContentCheck, type DetectionState } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accessScore, type CrawlerTally } from './access.js';
import { aiReadability } from './ai-readability.js';
import type { Measure } from './numbers.js';
import { quotableScore, type QuotableInput } from './quotable.js';
import { readableScore, type ReadablePage } from './readable.js';
import { signalsScore } from './signals.js';

const RUNS = { numRuns: 400, seed: 1717 };
const VERDICTS = [
  'allowed',
  'allowed_thin',
  'blocked_by_ua_rule',
  'disallowed_by_robots',
  'challenged_ua',
  'refused_unverified',
  'rate_limited',
  'edge_blocks_automation',
  'not_measured',
] as const;
type Counts = Partial<Record<(typeof VERDICTS)[number], number>>;

const countsArb: fc.Arbitrary<Counts> = fc.record(
  Object.fromEntries(VERDICTS.map((v) => [v, fc.nat({ max: 6 })])) as Record<
    (typeof VERDICTS)[number],
    fc.Arbitrary<number>
  >,
);

function tally(ua: string, counts: Counts): CrawlerTally {
  const read = Object.entries(counts)
    .filter(([v]) => v !== 'not_measured')
    .reduce((n, [, k]) => n + (k ?? 0), 0);
  return {
    ua,
    scored: true,
    counts,
    extent: {
      robots: { disallowed: counts.disallowed_by_robots ?? 0, read },
      edge: { blocked: 0, served: 0, answered: 0 },
    },
  };
}
const n = (max: number) => fc.nat({ max });
/** Pages out of the denominator, in any mix. */
const outside = fc.record({
  challenged_ua: n(3),
  refused_unverified: n(3),
  rate_limited: n(3),
  edge_blocks_automation: n(3),
  not_measured: n(3),
});
/** A crawler of each standing: measured (2+ weighted pages), unmeasured (under 2), blocked by choice. */
const measuredCounts = fc
  .record({
    allowed: n(6),
    allowed_thin: n(6),
    blocked_by_ua_rule: n(6),
    disallowed_by_robots: n(2),
  })
  .filter((c) => c.allowed + c.allowed_thin + c.blocked_by_ua_rule >= 2);
const unmeasuredCounts = fc
  .constantFrom({}, { allowed: 1 }, { allowed_thin: 1 }, { blocked_by_ua_rule: 1 })
  .chain((one) => outside.map((o) => ({ ...o, ...one }) as Counts));
const byChoiceCounts = fc
  .record({ disallowed_by_robots: fc.integer({ min: 1, max: 5 }), not_measured: n(2) })
  .map((c) => c as Counts);
const crawlerCountsArb: fc.Arbitrary<Counts> = fc.oneof(
  measuredCounts.chain((m) => outside.map((o) => ({ ...o, ...m }) as Counts)),
  unmeasuredCounts,
  byChoiceCounts,
);
const crawlersArb = fc
  .array(fc.oneof(crawlerCountsArb, countsArb), { minLength: 4, maxLength: 4 })
  .map((cs) => cs.map((c, i) => tally(`c${i}`, c)));

/** The rule, restated from SPEC 17 independently of access.ts: which crawlers count as measured. */
function measuredByRule(c: CrawlerTally): boolean {
  const n = c.counts;
  const pages = (n.allowed ?? 0) + (n.allowed_thin ?? 0) + (n.blocked_by_ua_rule ?? 0);
  const byChoice = c.extent.robots.read > 0 && c.extent.robots.disallowed === c.extent.robots.read;
  return !byChoice && pages >= 2;
}

function within(m: Measure, max: number): boolean {
  if (m.score !== null) return m.score >= 0 && m.score <= max && m.range === null;
  return m.range.min >= 0 && m.range.max <= max && m.range.min <= m.range.max;
}

describe('Access', () => {
  it('lies in 0..40, and has a score exactly when two or more crawlers are measured', () => {
    fc.assert(
      fc.property(crawlersArb, (cs) => {
        const a = accessScore(cs);
        expect(within(a, 40)).toBe(true);
        expect(a.score !== null).toBe(cs.filter(measuredByRule).length >= 2);
        expect(a.reason === null).toBe(a.score !== null);
      }),
      RUNS,
    );
  });

  it('serving a crawler on a page it was blocked on never lowers the score', () => {
    fc.assert(
      fc.property(crawlersArb, fc.nat({ max: 3 }), (cs, i) => {
        const c = cs[i]!;
        fc.pre((c.counts.blocked_by_ua_rule ?? 0) > 0);
        const after = cs.map((x, j) =>
          j === i
            ? tally(x.ua, {
                ...x.counts,
                blocked_by_ua_rule: x.counts.blocked_by_ua_rule! - 1,
                allowed: (x.counts.allowed ?? 0) + 1,
              })
            : x,
        );
        const [b, a] = [accessScore(cs), accessScore(after)];
        if (b.score !== null && a.score !== null) expect(a.score).toBeGreaterThanOrEqual(b.score);
        if (b.range && a.range) expect(a.range.max).toBeGreaterThanOrEqual(b.range.max);
      }),
      RUNS,
    );
  });

  it('a robots.txt disallow added on any page never changes a given score', () => {
    fc.assert(
      fc.property(crawlersArb, fc.nat({ max: 3 }), (cs, i) => {
        const after = cs.map((x, j) =>
          j === i
            ? tally(x.ua, {
                ...x.counts,
                disallowed_by_robots: (x.counts.disallowed_by_robots ?? 0) + 1,
              })
            : x,
        );
        const [b, a] = [accessScore(cs), accessScore(after)];
        if (b.score !== null && a.score !== null) expect(a.score).toBe(b.score);
      }),
      RUNS,
    );
  });
});

const pagesArb: fc.Arbitrary<ReadablePage[]> = fc.array(
  fc.record({
    template_key: fc.constantFrom('/', '/a/{slug}', '/b/{slug}'),
    text_share: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  }),
  { maxLength: 30 },
);

describe('Access and respected intent', () => {
  it('a crawler blocked by robots.txt on every page read scores no lower than the same pages blocked by a user-agent rule', () => {
    fc.assert(
      fc.property(
        crawlersArb,
        fc.nat({ max: 3 }),
        fc.integer({ min: 2, max: 6 }),
        (cs, i, pages) => {
          const byChoice = cs.map((c, j) =>
            j === i ? tally(c.ua, { disallowed_by_robots: pages }) : c,
          );
          const blocked = cs.map((c, j) =>
            j === i ? tally(c.ua, { blocked_by_ua_rule: pages }) : c,
          );
          const [a, b] = [accessScore(byChoice), accessScore(blocked)];
          if (a.score !== null && b.score !== null) expect(a.score).toBeGreaterThanOrEqual(b.score);
        },
      ),
      RUNS,
    );
  });

  it('the generator makes crawlers of each standing, so the properties above see blocked by choice', () => {
    const standings = new Set<string>();
    fc.assert(
      fc.property(crawlersArb, (cs) => {
        for (const c of cs) {
          const byChoice =
            c.extent.robots.read > 0 && c.extent.robots.disallowed === c.extent.robots.read;
          standings.add(byChoice ? 'by_choice' : measuredByRule(c) ? 'measured' : 'unmeasured');
        }
      }),
      RUNS,
    );
    expect(standings).toEqual(new Set(['by_choice', 'measured', 'unmeasured']));
  });
});

describe('Readable', () => {
  it('lies in 0..30, and has a score exactly when every template has a rendered page', () => {
    fc.assert(
      fc.property(pagesArb, (pages) => {
        const r = readableScore(pages);
        expect(within(r, 30)).toBe(true);
        const templates = new Set(pages.map((p) => p.template_key));
        const rendered = new Set(
          pages.filter((p) => p.text_share !== null).map((p) => p.template_key),
        );
        expect(r.score !== null).toBe(pages.length > 0 && rendered.size === templates.size);
      }),
      RUNS,
    );
  });

  it('more text served without JavaScript on any page never lowers the score', () => {
    fc.assert(
      fc.property(
        pagesArb,
        fc.nat(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (pages, k, up) => {
          fc.pre(pages.length > 0);
          const i = k % pages.length;
          const p = pages[i]!;
          fc.pre(p.text_share !== null);
          const after = pages.map((x, j) =>
            j === i ? { ...x, text_share: Math.min(1, p.text_share! + up) } : x,
          );
          const [b, a] = [readableScore(pages), readableScore(after)];
          if (b.score !== null) expect(a.score!).toBeGreaterThanOrEqual(b.score);
        },
      ),
      RUNS,
    );
  });
});

const CHECKS: ContentCheck[] = [
  'direct_answer_150',
  'question_headings',
  'schema_with_description',
  'author_and_date',
  'specs_as_text',
];
const tallyArb = fc.nat({ max: 12 }).chain((decided) =>
  fc.record({
    decided: fc.constant(decided),
    passing: fc.nat({ max: decided }),
    unread: fc.oneof(fc.constant(0), fc.nat({ max: 4 })),
  }),
);
const quotableArb: fc.Arbitrary<QuotableInput> = fc
  .array(tallyArb, { minLength: 5, maxLength: 5 })
  .map((ts) => ({
    checks: Object.fromEntries(CHECKS.map((c, i) => [c, ts[i]!])) as QuotableInput['checks'],
  }));
const tallyOf = (q: QuotableInput, c: ContentCheck) => q.checks[c]!;
const anyUnread = (q: QuotableInput) => Object.values(q.checks).some((t) => t.unread > 0);

describe('Quotable', () => {
  it('lies in 0..20, and has a score exactly when every graded page was read and a check was decided', () => {
    fc.assert(
      fc.property(quotableArb, (q) => {
        const r = quotableScore(q);
        expect(within(r, 20)).toBe(true);
        const decided = Object.values(q.checks).some((t) => t.decided > 0);
        expect(r.score !== null).toBe(!anyUnread(q) && decided);
      }),
      RUNS,
    );
  });

  it('one more passing page never lowers the score or its bounds', () => {
    fc.assert(
      fc.property(quotableArb, fc.constantFrom(...CHECKS), (q, k) => {
        const t = tallyOf(q, k);
        fc.pre(t.passing < t.decided);
        const after = { ...q, checks: { ...q.checks, [k]: { ...t, passing: t.passing + 1 } } };
        const [b, a] = [quotableScore(q), quotableScore(after)];
        if (b.score !== null) expect(a.score!).toBeGreaterThanOrEqual(b.score);
        if (b.range) {
          expect(a.range!.min).toBeGreaterThanOrEqual(b.range.min);
          expect(a.range!.max).toBeGreaterThanOrEqual(b.range.max);
        }
      }),
      RUNS,
    );
  });
});

const stateArb = fc.constantFrom<DetectionState>('detected', 'not_detected', 'indeterminate');

describe('Signals', () => {
  it('lies in 0..10, and has a score exactly when both declarations were decided', () => {
    fc.assert(
      fc.property(stateArb, stateArb, (schema_org, content_signals) => {
        const s = signalsScore({ schema_org, content_signals });
        expect(within(s, 10)).toBe(true);
        expect(s.score !== null).toBe(
          schema_org !== 'indeterminate' && content_signals !== 'indeterminate',
        );
      }),
      RUNS,
    );
  });
});

describe('the AI readability grade', () => {
  it('is a valid contract grade, withheld exactly when a component has no score, and otherwise their sum', () => {
    fc.assert(
      fc.property(
        crawlersArb,
        pagesArb,
        quotableArb,
        stateArb,
        stateArb,
        (cs, pages, q, schema_org, content_signals) => {
          const parts = {
            access: accessScore(cs),
            readable: readableScore(pages),
            quotable: quotableScore(q),
            signals: signalsScore({ schema_org, content_signals }),
          };
          const g = aiReadability(parts);
          expect(AiReadabilitySchema.safeParse(g).success).toBe(true);
          const unscored = Object.values(parts).some((m) => m.score === null);
          expect(g.withheld).toBe(unscored);
          if (!g.withheld) {
            const sum = Object.values(parts).reduce((n, m) => n + m.score!, 0);
            expect(Math.abs(g.total - sum)).toBeLessThan(0.006);
          }
        },
      ),
      RUNS,
    );
  });
});

describe('a range holds the score the unknowns turn out to give', () => {
  it('Access: give each unmeasured crawler two more pages of any verdict, and the score lies in the range', () => {
    fc.assert(
      fc.property(
        crawlersArb,
        fc.array(
          fc.constantFrom('allowed', 'allowed_thin', 'blocked_by_ua_rule') as fc.Arbitrary<
            'allowed' | 'allowed_thin' | 'blocked_by_ua_rule'
          >,
          { minLength: 8, maxLength: 8 },
        ),
        (cs, fill) => {
          const before = accessScore(cs);
          fc.pre(before.reason === 'too_few_crawlers_measured');
          const after = cs.map((c, i) => {
            if (
              measuredByRule(c) ||
              (c.extent.robots.read > 0 && c.extent.robots.disallowed === c.extent.robots.read)
            )
              return c;
            const add = { ...c.counts };
            for (const v of [fill[2 * i]!, fill[2 * i + 1]!]) add[v] = (add[v] ?? 0) + 2;
            return tally(c.ua, add);
          });
          const a = accessScore(after);
          fc.pre(a.score !== null);
          expect(a.score).toBeGreaterThanOrEqual(before.range!.min - 0.01);
          expect(a.score).toBeLessThanOrEqual(before.range!.max + 0.01);
        },
      ),
      RUNS,
    );
  });

  it('Readable: render the unrendered templates at any share, and the score lies in the range', () => {
    fc.assert(
      fc.property(pagesArb, fc.double({ min: 0, max: 1, noNaN: true }), (pages, share) => {
        const before = readableScore(pages);
        fc.pre(before.score === null && pages.length > 0);
        const a = readableScore(
          pages.map((p) =>
            pages.some((q) => q.template_key === p.template_key && q.text_share !== null)
              ? p
              : { ...p, text_share: share },
          ),
        );
        expect(a.score!).toBeGreaterThanOrEqual(before.range.min - 0.01);
        expect(a.score!).toBeLessThanOrEqual(before.range.max + 0.01);
      }),
      RUNS,
    );
  });

  it('Quotable: read the unread pages, each check passing, failing or not applying, and the score lies in the range', () => {
    fc.assert(
      fc.property(
        quotableArb,
        fc.array(fc.constantFrom('pass', 'fail', 'none'), { minLength: 20, maxLength: 20 }),
        (q, outcomes) => {
          const before = quotableScore(q);
          fc.pre(anyUnread(q));
          const checks = Object.fromEntries(
            CHECKS.map((c, k) => {
              const t = tallyOf(q, c);
              let { passing, decided } = t;
              for (let page = 0; page < t.unread; page++) {
                const o = outcomes[(k * 4 + page) % outcomes.length];
                if (o === 'pass') {
                  passing += 1;
                  decided += 1;
                } else if (o === 'fail') decided += 1;
              }
              return [c, { passing, decided, unread: 0 }];
            }),
          ) as QuotableInput['checks'];
          const a = quotableScore({ checks });
          fc.pre(a.score !== null);
          expect(a.score).toBeGreaterThanOrEqual(before.range!.min - 0.01);
          expect(a.score).toBeLessThanOrEqual(before.range!.max + 0.01);
        },
      ),
      RUNS,
    );
  });

  it('Signals: decide the undecided declaration either way, and the score lies in the range', () => {
    for (const s of ['detected', 'not_detected'] as const) {
      const before = signalsScore({ schema_org: 'detected', content_signals: 'indeterminate' });
      const a = signalsScore({ schema_org: 'detected', content_signals: s });
      expect(a.score!).toBeGreaterThanOrEqual(before.range!.min);
      expect(a.score!).toBeLessThanOrEqual(before.range!.max);
    }
  });
});
