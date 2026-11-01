/**
 * Properties of every structure detector over generated sites (fast-check).
 *
 * Truncation is modelled as the crawl a smaller budget makes: the first `k` pages in fetch order, the
 * links those pages carry, the same URLs discovered, and the cap reached. What must hold:
 *
 * - On the truncated crawl, a verdict (`detected` or `not_detected`) cites only pages that were
 *   crawled, and a per-page fingerprint is never decided for a page outside the crawl. So shrinking
 *   the crawl cannot turn a page's `indeterminate` into `not_detected` once the page falls outside it.
 * - A truncated crawl never detects an orphan, or a deep page.
 * - The output does not depend on the order of the input.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coverageOf, site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectStructure, DETECTORS } from './index.js';
import { KEY_PREFIX } from './fingerprint.js';
import type { DetectorInput, HreflangLink, PageFacts } from './types.js';

const PATHS = [
  '/',
  '/a',
  '/b',
  '/c',
  '/d',
  '/e',
  '/blog',
  '/blog/page/2',
  '/blog/page/3',
  '/f',
  '/g',
  '/h',
];
const PER_PAGE = new Set(['orphan', 'depth', 'canonical', 'redirect']);
const HASHES = ['0000000000000000', '0000000000000007', '00000000000000ff', 'ffffffffffffffff'];

const pathArb = fc.constantFrom(...PATHS);
const urlArb = fc.oneof(pathArb.map(u), fc.constant('https://other.test/x'));
const hreflangArb: fc.Arbitrary<HreflangLink[] | null> = fc.option(
  fc.array(
    fc.record({
      lang: fc.constantFrom('en', 'fr', 'de', 'x-default', 'en-UK'),
      href: pathArb.map(u),
    }),
    { maxLength: 4 },
  ),
);
const factsArb: fc.Arbitrary<Partial<Omit<PageFacts, 'url'>>> = fc.record({
  final_url: fc.option(urlArb),
  redirect: fc.option(fc.record({ hops: fc.integer({ min: 0, max: 4 }), loop: fc.boolean() })),
  canonical: fc.option(fc.record({ href: fc.option(urlArb) })),
  simhash: fc.option(fc.constantFrom(...HASHES)),
  hreflang: hreflangArb,
});

const pageArb = (path: string): fc.Arbitrary<PageSpec> =>
  fc
    .record({
      path: fc.constant(path),
      status: fc.constantFrom(200, 200, 200, 200, 301, 404, 410, 500),
      pr: fc.double({ min: 0, max: 1, noNaN: true }),
      links: fc
        .uniqueArray(fc.record({ to: pathArb, generic: fc.boolean() }), {
          maxLength: 8,
          selector: (l) => l.to,
        })
        .map((ls) => ls.filter((l) => l.to !== path)),
      extra: fc.integer({ min: 0, max: 2 }),
      facts: fc.option(factsArb, { nil: undefined }),
    })
    .map(
      ({ extra, ...p }) =>
        ({
          ...p,
          kind:
            p.status === 200 ? (p.path.includes('/page/') ? 'pagination' : 'content') : 'status',
          links: p.status === 200 ? p.links : [],
          links_out: p.status === 200 ? p.links.length + (extra === 2 ? 1 : 0) : 0,
        }) as PageSpec,
    );

/** A whole site in fetch order (the homepage first), and the share of it a smaller budget crawls. */
const siteArb = fc
  .tuple(
    fc.shuffledSubarray(PATHS.slice(1), { minLength: 1 }),
    fc.boolean(),
    fc.option(fc.uniqueArray(pathArb.map(u), { maxLength: 3 })),
  )
  .chain(([rest, homeFirst, robots]) => {
    const order = homeFirst ? ['/', ...rest] : [...rest, '/'];
    return fc.tuple(
      fc.tuple(...order.map(pageArb)),
      fc.integer({ min: 1, max: order.length - 1 }),
      fc.constant(robots),
    );
  });

function truncate(full: DetectorInput, k: number): DetectorInput {
  const pages = full.pages.slice(0, k);
  const kept = new Set(pages.map((p) => p.url));
  return {
    ...full,
    check: { status: 'finished', coverage: coverageOf(pages, full.pages.length) },
    page_cap: k,
    pages,
    edges: full.edges.filter((e) => kept.has(e.from_url)),
    facts: full.facts.filter((f) => kept.has(f.url)),
  };
}

const subjectOf = (key: string) => key.slice(key.indexOf(':') + 1);

describe('structure detector properties', () => {
  it('on a truncated crawl, no verdict rests on a page outside it, and no orphan or deep page is detected', () => {
    fc.assert(
      fc.property(siteArb, ([specs, k, robots]) => {
        const full = site(specs, { robots });
        const cut = truncate(full, k);
        const crawled = new Set(cut.pages.map((p) => p.url));
        for (const d of detectStructure(cut)) {
          const prefix = d.key.slice(0, d.key.indexOf(':'));
          if (d.state === 'indeterminate') continue;
          for (const p of d.evidence.pages)
            expect(crawled.has(p), `${d.key} cites ${p}`).toBe(true);
          if (PER_PAGE.has(prefix)) expect(crawled.has(subjectOf(d.key)), d.key).toBe(true);
          if (d.type === 'orphan_pages' || d.type === 'deep_pages')
            expect(d.state, d.key).not.toBe('detected');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('shrinking the crawl never turns indeterminate into not_detected for a page that left it', () => {
    fc.assert(
      fc.property(siteArb, ([specs, k, robots]) => {
        const full = site(specs, { robots });
        const cut = truncate(full, k);
        const crawled = new Set(cut.pages.map((p) => p.url));
        const before = new Map(detectStructure(full).map((d) => [d.key, d.state]));
        for (const d of detectStructure(cut)) {
          if (before.get(d.key) !== 'indeterminate') continue;
          const perPage = PER_PAGE.has(d.key.slice(0, d.key.indexOf(':')));
          const outside =
            d.evidence.pages.some((p) => !crawled.has(p)) ||
            (perPage && !crawled.has(subjectOf(d.key)));
          if (outside) expect(d.state, d.key).not.toBe('not_detected');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic: reordering the input does not change the output', () => {
    fc.assert(
      fc.property(siteArb, fc.integer(), ([specs, , robots], seed) => {
        const input = site(specs, { robots });
        const shuffle = <T>(xs: readonly T[]) =>
          xs
            .map((x, i) => [((i + 1) * 2654435761 + seed) % 4294967296, x] as const)
            .sort((a, b) => a[0] - b[0])
            .map(([, x]) => x);
        const reordered = {
          ...input,
          pages: shuffle(input.pages),
          edges: shuffle(input.edges),
          facts: shuffle(input.facts),
        };
        expect(detectStructure(reordered)).toEqual(detectStructure(input));
      }),
      { numRuns: 200 },
    );
  });

  it('every record is well formed', () => {
    fc.assert(
      fc.property(siteArb, ([specs, , robots]) => {
        for (const d of detectStructure(site(specs, { robots }))) {
          expect(d.reason === null, d.key).toBe(d.state !== 'indeterminate');
          expect(d.page_gone === null || d.reason === 'page_gone', d.key).toBe(true);
          expect(d.key.startsWith(`${KEY_PREFIX[d.type as keyof typeof KEY_PREFIX]}:`), d.key).toBe(
            true,
          );
          expect([...d.affected_urls].sort(), d.key).toEqual(d.affected_urls);
          expect([...d.evidence.pages].sort(), d.key).toEqual(d.evidence.pages);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('runs every structure detector', () => {
    expect(DETECTORS.map((d) => d.type).sort()).toEqual(Object.keys(KEY_PREFIX).sort());
  });
});
