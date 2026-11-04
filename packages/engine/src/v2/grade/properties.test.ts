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
const crawlersArb = fc
  .array(countsArb, { minLength: 4, maxLength: 4 })
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
const quotableArb: fc.Arbitrary<QuotableInput> = fc.record({
  unread: fc.nat({ max: 4 }),
  checks: fc
    .array(
      fc
        .nat({ max: 12 })
        .chain((decided) =>
          fc.record({ decided: fc.constant(decided), passing: fc.nat({ max: decided }) }),
        ),
      { minLength: 5, maxLength: 5 },
    )
    .map((ts) => Object.fromEntries(CHECKS.map((c, i) => [c, ts[i]!])) as QuotableInput['checks']),
});

describe('Quotable', () => {
  it('lies in 0..20, and has a score exactly when every graded page was read and a check was decided', () => {
    fc.assert(
      fc.property(quotableArb, (q) => {
        const r = quotableScore(q);
        expect(within(r, 20)).toBe(true);
        const decided = Object.values(q.checks).some((t) => t.decided > 0);
        expect(r.score !== null).toBe(q.unread === 0 && decided);
      }),
      RUNS,
    );
  });

  it('one more passing page never lowers the score or its bounds', () => {
    fc.assert(
      fc.property(quotableArb, fc.constantFrom(...CHECKS), (q, k) => {
        const t = q.checks[k];
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
