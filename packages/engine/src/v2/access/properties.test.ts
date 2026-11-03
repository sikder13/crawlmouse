/**
 * Properties of the matrix and the access detectors over generated checks (fast-check). Each check
 * is a set of sampled pages with any verdict, cause and status for each crawler on each, under any
 * template keys, so the claims below are not proven from a fixture's handful of shapes. The registry
 * tokens are varied too: the detectors key on them, so renaming every crawler must change nothing
 * but the names.
 */
import fc from 'fast-check';
import {
  AccessCauseSchema,
  UNMEASURED_VERDICTS,
  VerdictSchema,
  type CrawlerRegistryEntry,
  type Verdict,
} from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { row, searchRobots, TESTABLE, u } from '../../../fixtures/v2/access/builders.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { detectAccess } from './index.js';
import type { AccessInput, AccessResult } from './types.js';

const SERVED: readonly Verdict[] = ['allowed', 'allowed_thin'];
const BLOCKED: readonly Verdict[] = ['disallowed_by_robots', 'blocked_by_ua_rule'];

/** Any verdict, cause and status, except a robots.txt cause on a verdict that is not a robots.txt disallow, which the detectors refuse (matrix.test.ts). */
const cellArb = fc
  .record({
    verdict: fc.constantFrom(...VerdictSchema.options),
    cause: fc.option(fc.constantFrom(...AccessCauseSchema.options), { nil: null }),
    status: fc.option(fc.integer({ min: 100, max: 599 }), { nil: null }),
  })
  .map((c) =>
    c.cause === 'robots_txt_disallow' && c.verdict !== 'disallowed_by_robots'
      ? { ...c, cause: null }
      : c,
  );
type GenCell = { verdict: Verdict; cause: string | null; status: number | null };

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
  return { access_tests, pages, disallowed: [] };
}

const cellsOf = (g: { cells: GenCell[][] }, ua: string) => g.cells[TESTABLE.indexOf(ua)]!;
const measured = (c: GenCell) => !UNMEASURED_VERDICTS.includes(c.verdict);

describe('the site verdict', () => {
  it('is never blocked when any sampled page served the crawler', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const served = cellsOf(g, ua).some((c) => SERVED.includes(c.verdict));
          if (served) expect(BLOCKED).not.toContain(out.crawlers.find((c) => c.ua === ua)!.verdict);
        }
      }),
    );
  });

  it('is never allowed when no page was measured, and then counts no page', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          if (cellsOf(g, ua).some(measured)) continue;
          const r = out.crawlers.find((c) => c.ua === ua)!;
          expect(SERVED).not.toContain(r.verdict);
          expect(r.pages_measured).toBe(0);
        }
      }),
    );
  });

  it('is blocked only when some page carried that very block', () => {
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const v = out.crawlers.find((c) => c.ua === ua)!.verdict;
          if (BLOCKED.includes(v)) expect(cellsOf(g, ua).map((c) => c.verdict)).toContain(v);
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
            const served = cellsOf(g, ua).some(
              (c, i) => g.templates[i] === t.template_key && SERVED.includes(c.verdict),
            );
            if (served) expect(BLOCKED).not.toContain(t.verdict);
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

  it('is detected exactly when at least half the pages it judged were a user-agent block', () => {
    const judged: readonly Verdict[] = [
      ...SERVED,
      'blocked_by_ua_rule',
      'challenged_ua',
      'refused_unverified',
    ];
    fc.assert(
      fc.property(checkArb, (g) => {
        const out = detectAccess(build(g));
        for (const ua of TESTABLE) {
          const cells = cellsOf(g, ua).filter((c) => judged.includes(c.verdict));
          const blocked = cells.filter((c) => c.verdict === 'blocked_by_ua_rule').length;
          const d = out.detections.find(
            (x) => x.type === 'edge_rule_blocks_crawler' && x.crawler === ua,
          )!;
          expect(d.state === 'detected').toBe(cells.length > 0 && 2 * blocked >= cells.length);
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

  it('keys on the registry’s tokens: renaming every crawler changes only the names', () => {
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
