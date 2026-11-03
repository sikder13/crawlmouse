/**
 * Properties of the matrix and the access detectors over generated checks (fast-check). Each check
 * is a set of sampled pages with any verdict, cause and status for each crawler on each, under any
 * template keys, so the claims below are not proven from a fixture's handful of shapes. The registry
 * tokens are varied too: the detectors key on them, so renaming every testable crawler must change nothing
 * but the names.
 */
import fc from 'fast-check';
import {
  UNMEASURED_VERDICTS,
  VerdictSchema,
  type AccessCause,
  type CrawlerRegistryEntry,
  type EvidenceClass,
  type Verdict,
} from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { row, searchRobots, TESTABLE, u } from '../../../fixtures/v2/access/builders.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { CAUSES, EVIDENCE } from './cells.js';
import { detectAccess } from './index.js';
import type { AccessInput, AccessResult } from './types.js';

const SERVED: readonly Verdict[] = ['allowed', 'allowed_thin'];

/**
 * Any verdict and status, with any cause and evidence class the worker's table gives that verdict
 * (CAUSES, EVIDENCE): the detectors refuse any other (matrix.test.ts).
 */
const cellArb = fc.constantFrom(...VerdictSchema.options).chain((verdict) =>
  fc.record({
    verdict: fc.constant(verdict),
    cause: fc.constantFrom(...CAUSES[verdict]),
    evidence: fc.constantFrom(...EVIDENCE[verdict]),
    status: fc.option(fc.integer({ min: 100, max: 599 }), { nil: null }),
  }),
);
type GenCell = {
  verdict: Verdict;
  cause: AccessCause | null;
  evidence: EvidenceClass;
  status: number | null;
};

const checkArb = fc
  .array(fc.constantFrom('/', '/a/{slug}', '/B/{n}', '/a/{n}'), { minLength: 1, maxLength: 6 })
  .chain((templates) =>
    fc.record({
      templates: fc.constant(templates),
      cells: fc.array(
        fc.array(cellArb, { minLength: templates.length, maxLength: templates.length }),
        {
          minLength: TESTABLE.length,
          maxLength: TESTABLE.length,
        },
      ),
    }),
  );

function build(
  g: { templates: string[]; cells: GenCell[][] },
  tokens: readonly string[] = TESTABLE,
): AccessInput {
  const paths = g.templates.map((_, i) => `/page-${i}`);
  const access_tests = paths.flatMap((path, i) => [
    row(null, path, 'allowed', g.templates[i]),
    ...tokens.map((ua, k) =>
      row(ua, path, g.cells[k]![i] as Parameters<typeof row>[2], g.templates[i]),
    ),
  ]);
  const pages = paths.map((path, i) => ({
    url: u(path),
    template_key: g.templates[i]!,
    robots_search: searchRobots(),
  }));
  return { access_tests, pages };
}

const cellsOf = (g: { cells: GenCell[][] }, ua: string) => g.cells[TESTABLE.indexOf(ua)]!;
const measured = (c: GenCell) => !UNMEASURED_VERDICTS.includes(c.verdict);

/** The verdicts that say how the site answered the crawler's own request, written out here. */
const ANSWERED: readonly Verdict[] = [
  'allowed',
  'allowed_thin',
  'blocked_by_ua_rule',
  'challenged_ua',
  'refused_unverified',
  'rate_limited',
  'payment_required',
  'redirected_away',
];

/** The counts the rules are stated in, computed here from the generated cells. */
function tally(cells: readonly GenCell[]) {
  const count = (vs: readonly Verdict[]) => cells.filter((c) => vs.includes(c.verdict)).length;
  return {
    read: cells.filter((c) => c.verdict !== 'not_measured').length,
    disallowed: count(['disallowed_by_robots']),
    answered: count(ANSWERED),
    served: count(SERVED),
    blocked: count(['blocked_by_ua_rule']),
    uncertain: count(['challenged_ua', 'refused_unverified']),
  };
}

describe('the site verdict', () => {
  it('is disallowed by robots.txt exactly when robots.txt disallows it on half the pages read or more', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const t = tally(cellsOf(g, ua));
          const v = out.crawlers.find((c) => c.ua === ua)!.verdict;
          expect(v === 'disallowed_by_robots').toBe(t.read > 0 && 2 * t.disallowed >= t.read);
        }
      }),
    );
  });

  it('is never blocked by a user-agent rule unless blocks are half the answered pages and outnumber the uncertain ones', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          if (out.crawlers.find((c) => c.ua === ua)!.verdict !== 'blocked_by_ua_rule') continue;
          const t = tally(cellsOf(g, ua));
          expect(2 * t.blocked).toBeGreaterThanOrEqual(t.answered);
          expect(t.blocked).toBeGreaterThan(t.uncertain);
        }
      }),
    );
  });

  it('is never allowed unless served pages are half the answered pages', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          if (!SERVED.includes(out.crawlers.find((c) => c.ua === ua)!.verdict)) continue;
          const t = tally(cellsOf(g, ua));
          expect(2 * t.served).toBeGreaterThanOrEqual(t.answered);
        }
      }),
    );
  });

  it('is never allowed when no page was measured: it is unmeasured, and counts no page', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const cells = cellsOf(g, ua);
          if (cells.some(measured)) continue;
          const r = out.crawlers.find((c) => c.ua === ua)!;
          const edge = cells.some((c) => c.verdict === 'edge_blocks_automation');
          expect(r.verdict).toBe(edge ? 'edge_blocks_automation' : 'not_measured');
          expect(r.pages_measured).toBe(0);
        }
      }),
    );
  });

  it('carries its extent: the robots.txt and edge counts the verdict was decided on', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const t = tally(cellsOf(g, ua));
          expect(out.crawlers.find((c) => c.ua === ua)!.extent).toEqual({
            robots: { disallowed: t.disallowed, read: t.read },
            edge: { blocked: t.blocked, served: t.served, answered: t.answered },
          });
        }
      }),
    );
  });

  it('a robots.txt site verdict comes with a detected robots.txt record', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          if (out.crawlers.find((c) => c.ua === ua)!.verdict !== 'disallowed_by_robots') continue;
          const d = out.detections.find((x) => x.key === `robots:${ua.toLowerCase()}`)!;
          expect(d.state).toBe('detected');
        }
      }),
    );
  });

  it('a user-agent block site verdict comes with an edge record detected, or one with too few pages', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          if (out.crawlers.find((c) => c.ua === ua)!.verdict !== 'blocked_by_ua_rule') continue;
          const d = out.detections.find((x) => x.key === `edge:${ua.toLowerCase()}`)!;
          expect(d.state === 'detected' || d.reason === 'insufficient_sample').toBe(true);
        }
      }),
    );
  });

  it('counts the measured pages, and each template is judged by the same rules', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const r = out.crawlers.find((c) => c.ua === ua)!;
          expect(r.pages_measured).toBe(cellsOf(g, ua).filter(measured).length);
          for (const t of r.by_template) {
            const n = tally(cellsOf(g, ua).filter((_, i) => g.templates[i] === t.template_key));
            if (SERVED.includes(t.verdict)) expect(2 * n.served).toBeGreaterThanOrEqual(n.answered);
            if (t.verdict === 'blocked_by_ua_rule')
              expect(2 * n.blocked).toBeGreaterThanOrEqual(n.answered);
            if (t.verdict === 'disallowed_by_robots')
              expect(2 * n.disallowed).toBeGreaterThanOrEqual(n.read);
          }
        }
      }),
    );
  });
});

describe('the edge detector', () => {
  it('never names robots.txt, and never cites a robots.txt row', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const input = build(g);
        const declared = new Set(
          input.access_tests.filter((t) => t.verdict === 'disallowed_by_robots').map((t) => t.id),
        );
        for (const d of detectAccess(input).detections) {
          if (d.type !== 'edge_rule_blocks_crawler') continue;
          expect(d.evidence.causes).not.toContain('robots_txt_disallow');
          for (const id of d.evidence.access_test_ids) expect(declared.has(id)).toBe(false);
        }
      }),
    );
  });

  it('is detected exactly when there are two answered pages or more, blocks are half of them and outnumber the uncertain ones', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const t = tally(cellsOf(g, ua));
          const d = out.detections.find((x) => x.key === `edge:${ua.toLowerCase()}`)!;
          expect(d.state === 'detected').toBe(
            t.answered >= 2 && 2 * t.blocked >= t.answered && t.blocked > t.uncertain,
          );
          if (t.answered === 1) expect(d.reason).toBe('insufficient_sample');
        }
      }),
    );
  });

  it('the robots.txt record is detected exactly when robots.txt disallows it on a page read', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const t = tally(cellsOf(g, ua));
          const d = out.detections.find((x) => x.key === `robots:${ua.toLowerCase()}`)!;
          expect(d.state === 'detected').toBe(t.disallowed > 0);
          expect(d.extent).toEqual(t.read === 0 ? null : { matching: t.disallowed, of: t.read });
        }
      }),
    );
  });

  it('never says the real crawler may pass beside a site verdict of blocked', () => {
    const mayPass = ['challenge_real_crawler_may_pass', 'refusal_unverified'];
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          if (out.crawlers.find((c) => c.ua === ua)!.verdict !== 'blocked_by_ua_rule') continue;
          const d = out.detections.find((x) => x.key === `edge:${ua.toLowerCase()}`)!;
          expect(mayPass).not.toContain(d.reason);
        }
      }),
    );
  });

  it('never opens a fix on a challenge or an unverified refusal', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          if (cellsOf(g, ua).some((c) => c.verdict === 'blocked_by_ua_rule')) continue;
          const d = out.detections.find(
            (x) => x.type === 'edge_rule_blocks_crawler' && x.crawler === ua,
          )!;
          expect(d.state).not.toBe('detected');
          expect(d.opens_fix).toBe(false);
        }
      }),
    );
  });
});

describe('every detector', () => {
  it('does not depend on the order of the rows', () => {
    fc.assert(
      fc.property(checkArb, fc.integer(), (g, seed) => {
        const input = build(g);
        const shuffled = [...input.access_tests].sort(
          (a, b) => ((hash(a.id) ^ seed) >>> 0) - ((hash(b.id) ^ seed) >>> 0),
        );
        expect(detectAccess({ ...input, access_tests: shuffled })).toEqual(detectAccess(input));
      }),
    );
  });

  it('a respected-intent record never opens a fix, and only a detected record opens one', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        for (const d of detectAccess(build(g)).detections) {
          if (d.intent === 'respected') expect(d.opens_fix).toBe(false);
          if (d.opens_fix) expect(d.state).toBe('detected');
          expect(d.reason === null).toBe(d.state !== 'indeterminate');
        }
      }),
    );
  });

  it('keys on the registry’s tokens: renaming every testable crawler changes only the names', () => {
    const others = new Set(
      CRAWLER_REGISTRY_V2.filter((e) => !e.testable).map((e) => e.token.toLowerCase()),
    );
    const renamed = fc.uniqueArray(
      fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,11}$/).filter((s) => !others.has(s.toLowerCase())),
      { minLength: TESTABLE.length, maxLength: TESTABLE.length, selector: (s) => s.toLowerCase() },
    );
    fc.assert(
      fc.property(checkArb, renamed, (g, names) => {
        const to = new Map(TESTABLE.map((t, i) => [t, names[i]!]));
        const registry: CrawlerRegistryEntry[] = CRAWLER_REGISTRY_V2.map((e) =>
          to.has(e.token) ? { ...e, token: to.get(e.token)!, robots_token: to.get(e.token)! } : e,
        );
        const original = detectAccess(build(g));
        const moved = detectAccess({ ...build(g, names), registry });
        expect(strip(moved, names)).toEqual(strip(original, TESTABLE));
      }),
    );
  });
});

/** A result with each crawler named by its place in `tokens`, ids and fingerprints dropped. */
function strip(r: AccessResult, tokens: readonly string[]) {
  const name = (t: string) => (tokens.includes(t) ? `#${tokens.indexOf(t)}` : t);
  return {
    ...r,
    crawlers: r.crawlers.map((c) => ({ ...c, ua: name(c.ua), supporting: c.supporting.pages })),
    detections: r.detections
      .map((d) => ({
        ...d,
        crawler: name(d.crawler),
        key: `${d.type}:${name(d.crawler)}`,
        fingerprint: '',
        evidence: { ...d.evidence, access_test_ids: d.evidence.access_test_ids.length },
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h;
}
