/**
 * Properties of every structure detector over generated sites (fast-check).
 *
 * Truncation is modelled as the crawl a smaller budget makes: the first `k` pages in fetch order, the
 * links those pages carry, the same URLs discovered, and the cap reached. Asserted below:
 *
 * - On a crawl that cannot prove absence (truncated, or one discovered URL not fetched): a verdict
 *   cites only pages that were read; a per-page fingerprint is decided only for a page that was read;
 *   no orphan or deep page is detected; no pagination list or hreflang cluster is clear; a canonical
 *   is clear only when self-consistent.
 * - Shrinking the crawl does not turn a page's `indeterminate` into `not_detected` once the page
 *   falls outside it.
 * - The generator reaches the verdicts these guard, on whole crawls.
 * - The output does not depend on the order of the input.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  coverageOf,
  site,
  u,
  type DisallowedSpec,
  type PageSpec,
} from '../../../fixtures/v2/detectors/builders.js';
import { detectStructure, DETECTORS } from './index.js';
import { scopeOf, SEARCH_ENGINES } from './scope.js';
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
const factsArb: fc.Arbitrary<Partial<Omit<PageFacts, 'url'>>> = fc.record(
  {
    final_url: fc.option(urlArb),
    links_read: fc.boolean(),
    redirect: fc.option(
      fc.oneof(
        fc.record({ hops: fc.integer({ min: 0, max: 4 }), loop: fc.constant(false) }),
        fc.record({ hops: fc.integer({ min: 1, max: 4 }), loop: fc.constant(true) }),
      ),
    ),
    canonical: fc.option(fc.record({ href: fc.option(urlArb) })),
    simhash: fc.option(fc.constantFrom(...HASHES)),
    hreflang: hreflangArb,
  },
  { requiredKeys: [] },
);

const pageArb = (path: string): fc.Arbitrary<PageSpec> =>
  fc
    .record({
      path: fc.constant(path),
      status: fc.constantFrom(200, 200, 200, 200, 200, 301, 403, 404, 410, 500),
      pr: fc.double({ min: 0, max: 1, noNaN: true }),
      links: fc
        .uniqueArray(fc.record({ to: pathArb, generic: fc.boolean() }), {
          maxLength: 8,
          selector: (l) => l.to,
        })
        .map((ls) => ls.filter((l) => l.to !== path)),
      extra: fc.integer({ min: 0, max: 3 }),
      facts: fc.option(factsArb, { nil: undefined }),
    })
    .map(
      ({ extra, ...p }) =>
        ({
          ...p,
          kind:
            p.status === 200 ? (p.path.includes('/page/') ? 'pagination' : 'content') : 'status',
          links: p.status === 200 ? p.links : [],
          links_out: p.status === 200 ? p.links.length + (extra === 3 ? 1 : 0) : 0,
        }) as PageSpec,
    );

/**
 * Overlays that make the absence-dependent verdicts reachable: a consistent hreflang cluster over
 * /a, /b, /c, and a pagination list /blog, /blog/page/2, /blog/page/3 whose later pages are clear.
 * Without them a random generator almost never produces a clean cluster or a clean list.
 */
const LANGS = ['en', 'fr', 'de'];
function overlay(specs: PageSpec[], cluster: boolean, list: boolean): PageSpec[] {
  const members = ['/a', '/b', '/c'];
  const alternates = [
    ...members.map((m, i) => ({ lang: LANGS[i]!, href: u(m) })),
    { lang: 'x-default', href: u('/a') },
  ];
  const listHash: Record<string, string> = {
    '/blog': '0000000000000000',
    '/blog/page/2': '00000000000000ff',
    '/blog/page/3': 'ffffffffffffffff',
  };
  return specs.map((s) => {
    const read = { status: 200, kind: 'content' as const };
    if (cluster && members.includes(s.path)) {
      return { ...s, ...read, facts: { ...s.facts, final_url: u(s.path), hreflang: alternates } };
    }
    if (list && s.path in listHash) {
      return {
        ...s,
        ...read,
        kind: s.path === '/blog' ? 'content' : 'pagination',
        facts: {
          ...s.facts,
          final_url: u(s.path),
          simhash: listHash[s.path]!,
          canonical: { href: u(s.path) },
        },
      };
    }
    return s;
  });
}

/**
 * A crawl the detectors can prove absence on: every page read (a 200, a redirect or gone), links only
 * to pages of the site, each page's links all recorded and known read.
 */
function tidy(specs: PageSpec[]): PageSpec[] {
  const present = new Set(specs.map((s) => s.path));
  return specs.map((s) => {
    const status = [200, 301, 404, 410].includes(s.status ?? 200) ? s.status : 200;
    const ok = status === 200;
    const links = ok
      ? (s.links ?? []).filter((l) => present.has(typeof l === 'string' ? l : l.to))
      : [];
    return {
      ...s,
      status,
      kind: ok ? (s.kind === 'status' ? 'content' : s.kind) : 'status',
      links,
      links_out: links.length,
      facts: { ...s.facts, links_read: true },
    };
  });
}

/** A whole site in fetch order, and how much of it a smaller budget crawls. */
const siteArb = fc
  .tuple(fc.shuffledSubarray(PATHS, { minLength: 2 }), fc.boolean(), fc.boolean(), fc.boolean())
  .chain(([order, cluster, list, complete]) =>
    fc.tuple(
      fc
        .tuple(...order.map(pageArb))
        .map((specs) => overlay(specs, cluster, list))
        .map((specs) => (complete ? tidy(specs) : specs)),
      fc.integer({ min: 1, max: order.length - 1 }),
    ),
  );

/** The crawl a budget of `k` pages makes: the first `k` pages and their links; the cap reached. */
function truncate(full: DetectorInput, k: number): DetectorInput {
  const pages = full.pages.slice(0, k);
  const kept = new Set(pages.map((p) => p.url));
  return {
    ...full,
    check: { status: 'finished', coverage: coverageOf(pages, full.pages.length) },
    page_cap: k,
    pages,
    edges: full.edges.filter((e) => kept.has(e.from_url)),
  };
}

/** The whole site crawled, but one more URL discovered than fetched. */
const withUnfetched = (full: DetectorInput): DetectorInput => ({
  ...full,
  check: { status: 'finished', coverage: coverageOf(full.pages, full.pages.length + 1) },
});

const subjectOf = (key: string) => key.slice(key.indexOf(':') + 1);
const prefixOf = (key: string) => key.slice(0, key.indexOf(':'));

/** URLs the crawl read: its pages, and where a page's request landed (scope.ts `resolve`). */
function readUrls(input: DetectorInput): (url: string) => boolean {
  const s = scopeOf(input);
  return (url) => s.page.has(url) || s.page.has(s.resolve(url));
}

/** What no crawl that cannot prove absence may claim. */
function assertNoAbsenceClaims(input: DetectorInput) {
  const read = readUrls(input);
  for (const d of detectStructure(input)) {
    if (d.state === 'indeterminate') continue;
    for (const p of d.evidence.pages) expect(read(p), `${d.key} cites ${p}`).toBe(true);
    if (PER_PAGE.has(prefixOf(d.key))) expect(read(subjectOf(d.key)), d.key).toBe(true);
    if (d.type === 'orphan_pages' || d.type === 'deep_pages') {
      expect(d.state, d.key).not.toBe('detected');
    }
    if (d.type === 'duplicate_pagination' || d.type === 'hreflang_gap') {
      expect(d.state, d.key).not.toBe('not_detected');
    }
    // A canonical is clear here only when self-consistent, which needs no absence.
    if (d.type === 'canonical_mismatch' && d.state === 'not_detected') {
      expect(d.measured, d.key).toBeNull();
    }
  }
}

describe('structure detector properties', () => {
  it('on a truncated crawl, nothing that needs absence is decided, and no verdict rests on an unread page', () => {
    fc.assert(
      fc.property(siteArb, ([specs, k]) => {
        assertNoAbsenceClaims(truncate(site(specs), k));
      }),
      { numRuns: 300 },
    );
  });

  it('the same holds on a whole crawl that discovered one URL it did not fetch', () => {
    fc.assert(
      fc.property(siteArb, ([specs]) => {
        assertNoAbsenceClaims(withUnfetched(site(specs)));
      }),
      { numRuns: 300 },
    );
  });

  it('shrinking the crawl never turns indeterminate into not_detected for a page that left it', () => {
    fc.assert(
      fc.property(siteArb, ([specs, k]) => {
        const full = site(specs);
        const cut = truncate(full, k);
        const read = readUrls(cut);
        const before = new Map(detectStructure(full).map((d) => [d.key, d.state]));
        for (const d of detectStructure(cut)) {
          if (before.get(d.key) !== 'indeterminate') continue;
          const outside =
            d.evidence.pages.some((p) => !read(p)) ||
            (PER_PAGE.has(prefixOf(d.key)) && !read(subjectOf(d.key)));
          if (outside) expect(d.state, d.key).not.toBe('not_detected');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('reaches the verdicts it guards: absence-dependent records are decided on some whole crawls', () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(siteArb, ([specs]) => {
        for (const d of detectStructure(site(specs))) seen.add(`${d.type}:${d.state}`);
      }),
      { numRuns: 300, seed: 1 },
    );
    for (const v of [
      'orphan_pages:detected',
      'deep_pages:detected',
      'duplicate_pagination:not_detected',
      'hreflang_gap:not_detected',
      'canonical_mismatch:not_detected',
      'generic_anchor_text:detected',
      'redirect_chain:detected',
    ]) {
      expect(seen.has(v), v).toBe(true);
    }
  });

  it('is deterministic: reordering the input does not change the output', () => {
    fc.assert(
      fc.property(siteArb, fc.integer(), ([specs], seed) => {
        const input = site(specs);
        const shuffle = <T>(xs: readonly T[]) =>
          xs
            .map((x, i) => [((i + 1) * 2654435761 + seed) % 4294967296, x] as const)
            .sort((a, b) => a[0] - b[0])
            .map(([, x]) => x);
        const reordered = {
          ...input,
          pages: shuffle(input.pages),
          edges: shuffle(input.edges),
          disallowed: shuffle(input.disallowed),
        };
        expect(detectStructure(reordered)).toEqual(detectStructure(input));
      }),
      { numRuns: 1000 },
    );
  });

  it('every record is well formed', () => {
    fc.assert(
      fc.property(siteArb, ([specs]) => {
        for (const d of detectStructure(site(specs))) {
          expect(d.reason === null, d.key).toBe(d.state !== 'indeterminate');
          expect(d.page_gone === null || d.reason === 'page_gone', d.key).toBe(true);
          expect(d.key.startsWith(`${KEY_PREFIX[d.type as keyof typeof KEY_PREFIX]}:`), d.key).toBe(
            true,
          );
          expect([...d.affected_urls].sort(), d.key).toEqual(d.affected_urls);
          expect([...d.evidence.pages].sort(), d.key).toEqual(d.evidence.pages);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('runs every structure detector', () => {
    expect(DETECTORS.map((d) => d.type).sort()).toEqual(Object.keys(KEY_PREFIX).sort());
  });
});

/**
 * The robots.txt exclusion (scope.ts): a URL disallowed for our crawler and every search engine leaves
 * the crawlable site; one disallowed for fewer of them stays unfetched.
 */
const BLOCKED = ['/cart', '/wp-admin', '/checkout'];
const blockedArb = fc.uniqueArray(fc.constantFrom(...BLOCKED), { minLength: 1, maxLength: 3 });

/** `specs` with each page in `from` (by index, wrapping) also linking to the blocked URLs. */
function linkingTo(
  specs: PageSpec[],
  blocked: readonly string[],
  from: readonly number[],
): PageSpec[] {
  const ok = specs.filter((s) => (s.status ?? 200) === 200);
  const linkers = new Set(from.map((i) => ok[i % ok.length]?.path).filter(Boolean));
  return specs.map((s) =>
    linkers.has(s.path)
      ? {
          ...s,
          links: [...(s.links ?? []), ...blocked],
          links_out: (s.links_out ?? 0) + blocked.length,
        }
      : s,
  );
}

const fromArb = fc.array(fc.nat(20), { minLength: 1, maxLength: 4 });
const notBlocked = (key: string) => !BLOCKED.some((b) => key.endsWith(u(b)));

describe('URLs robots.txt excludes for every crawler', () => {
  it('adding a fully disallowed URL, and links to it, never changes any other verdict', () => {
    fc.assert(
      fc.property(siteArb, blockedArb, fromArb, ([specs], blocked, from) => {
        const without = detectStructure(site(specs));
        const disallowed = blocked.map((path) => ({ path }));
        const withIt = detectStructure(site(linkingTo(specs, blocked, from), { disallowed }));
        expect(withIt.filter((d) => notBlocked(d.key))).toEqual(without);
        expect(withIt.filter((d) => !notBlocked(d.key))).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });

  it('a URL disallowed for our crawler and not for every search engine still blocks absence verdicts', () => {
    const partly = fc.subarray([...SEARCH_ENGINES], { maxLength: SEARCH_ENGINES.length - 1 });
    fc.assert(
      fc.property(siteArb, blockedArb, fromArb, partly, ([specs], blocked, from, search) => {
        const disallowed: DisallowedSpec[] = blocked.map((path) => ({ path, search }));
        assertNoAbsenceClaims(site(linkingTo(specs, blocked, from), { disallowed }));
      }),
      { numRuns: 300 },
    );
  });

  it('does not depend on the order of the disallowed list', () => {
    fc.assert(
      fc.property(siteArb, fromArb, ([specs], from) => {
        const disallowed = BLOCKED.map((path, i) => ({ path, search: i === 1 ? [] : undefined }));
        const input = site(linkingTo(specs, BLOCKED, from), { disallowed });
        const reversed = { ...input, disallowed: [...input.disallowed].reverse() };
        expect(detectStructure(reversed)).toEqual(detectStructure(input));
      }),
      { numRuns: 200 },
    );
  });
});
