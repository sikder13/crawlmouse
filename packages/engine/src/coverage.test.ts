import { describe, it, expect } from 'vitest';
import type { PageClassification } from '@crawlmouse/types';
import { computeCoverageAccounting, linkReachableUrls, sitemapDeltaSeverity, type CoverageInput, sitemapUnreachedFinding } from './coverage.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §7 — COVERAGE ACCOUNTING & ORPHAN TRIANGULATION.
//
// §7.1 THE THREE COUNTS, ALWAYS DISTINGUISHED. `fetched`, `gradeable` and `estimatedTotal` are
// different numbers about different sets, and one production report showed 550 / 796 / ~878 with no
// labelling at all — which reads as inconsistency to anyone who checks, and is indistinguishable from
// a bug. Each now carries its own name, and the estimate carries its PROVENANCE.
//
// §7.2 ORPHAN TRIANGULATION. A URL the owner DECLARED in their sitemap but which nothing links to is
// an orphan by the industry-standard definition, and crawl-only orphan detection misses it entirely:
// we seed from the sitemap, so we fetch the page, so it is not "missing" — it simply has no inbound
// link. Robots-disallowed sitemap URLs are counted SEPARATELY, because the owner chose those; folding
// them in would turn an ordinary `Disallow: /cart` into a finding against the site.
//
// §7.3 EXCLUSIONS ARE SURFACED, NEVER HIDDEN. "We excluded 412 tag-archive pages" is honest and
// useful; silently shrinking the denominator is not.
// ─────────────────────────────────────────────────────────────────────────────

const cls = (kind: PageClassification['kind'], gradeable: boolean): PageClassification => ({
  kind,
  gradeable,
  reason: `test:${kind}`,
  templateKey: '/{slug}',
  simhash: null,
  duplicateOf: null,
});

const base = (over: Partial<CoverageInput> = {}): CoverageInput => ({
  fetchedCount: 10,
  gradeableCount: 8,
  classifications: [cls('content', true)],
  sitemapDeclaredUrls: null,
  robotsExcludedSitemapUrls: [],
  linkReachableUrls: new Set<string>(),
  estimate: { estimatedTotal: null, method: 'none' },
  ...over,
});

describe('§7.1 — the three counts are distinguished, and the estimate carries provenance', () => {
  it('keeps fetched, gradeable and estimatedTotal as three separate numbers', () => {
    const c = computeCoverageAccounting(base({
      fetchedCount: 550,
      gradeableCount: 796 - 300,
      estimate: { estimatedTotal: 878, method: 'sitemap' },
    }));
    expect(c.fetched).toBe(550);
    expect(c.gradeable).toBe(496);
    expect(c.estimatedTotal).toBe(878);
    // The provenance is the point: "878" alone is a number someone has to trust, "878, from the
    // sitemap" is a number they can check.
    expect(c.estimateSource).toBe('sitemap');
  });

  it('REUSES the estimate rather than re-deriving it — one source of truth for site size', () => {
    // A second derivation of a shared value is the gradeInputsFrom defect class: it agrees until it
    // doesn't, and nothing is watching. Whatever estimateSiteTotal decided is what appears here,
    // including its method, verbatim.
    for (const method of ['sitemap', 'frontier', 'none'] as const) {
      const c = computeCoverageAccounting(base({ estimate: { estimatedTotal: method === 'none' ? null : 42, method } }));
      expect(c.estimateSource).toBe(method);
      expect(c.estimatedTotal).toBe(method === 'none' ? null : 42);
    }
  });

  it('reports coverageRatio as gradeable / estimatedTotal, and NULL when the total is unknowable', () => {
    expect(computeCoverageAccounting(base({ gradeableCount: 50, estimate: { estimatedTotal: 200, method: 'sitemap' } })).coverageRatio).toBeCloseTo(0.25, 6);
    // Unknowable is not 1.0. Reporting full coverage because we cannot see past our own crawl is
    // precisely the absence-of-evidence-as-evidence-of-quality failure this spec exists to remove.
    expect(computeCoverageAccounting(base({ estimate: { estimatedTotal: null, method: 'none' } })).coverageRatio).toBeNull();
  });

  it('never reports a ratio above 1, even when we graded more than the sitemap declared', () => {
    // A link-discovered site can legitimately exceed its own sitemap. "We covered 130% of your site"
    // is not a coherent claim, so it clamps — and the estimate, not the ratio, is what was wrong.
    const c = computeCoverageAccounting(base({ gradeableCount: 130, estimate: { estimatedTotal: 100, method: 'sitemap' } }));
    expect(c.coverageRatio).toBe(1);
  });
});

describe('§7.3 — exclusions are surfaced, never hidden', () => {
  it('tallies excluded pages BY KIND so the shrunk denominator is explainable', () => {
    const c = computeCoverageAccounting(base({
      classifications: [
        cls('content', true), cls('content', true),
        cls('archive', false), cls('archive', false), cls('archive', false),
        cls('auth', false),
      ],
    }));
    // Sorted by count desc so the biggest exclusion leads — "we excluded 3 archive pages" is the
    // sentence a user needs first.
    expect(c.excluded).toEqual([
      { kind: 'archive', count: 3 },
      { kind: 'auth', count: 1 },
    ]);
  });

  it('never lists a gradeable kind as an exclusion', () => {
    const c = computeCoverageAccounting(base({ classifications: [cls('content', true)] }));
    expect(c.excluded).toEqual([]);
  });
});

describe('§7.2 — orphan triangulation: sitemap-declared but not link-reachable', () => {
  it('counts a declared URL that nothing links to, which crawl-only orphan detection misses', () => {
    // We SEED from the sitemap, so this page was fetched — it is not missing, it simply has no
    // inbound link. That is exactly why the crawl alone cannot see it.
    const c = computeCoverageAccounting(base({
      sitemapDeclaredUrls: ['https://x.test/', 'https://x.test/a', 'https://x.test/b'],
      linkReachableUrls: new Set(['https://x.test/', 'https://x.test/a']),
    }));
    expect(c.sitemapDeclared).toBe(3);
    expect(c.sitemapUnreached).toBe(1);
  });

  it('counts robots-disallowed sitemap URLs SEPARATELY — the owner chose those', () => {
    // Conflating them turns an ordinary `Disallow: /cart` into a finding against the site. A choice
    // is not a defect, and we never fetched these, so we cannot claim anything about their links.
    const c = computeCoverageAccounting(base({
      sitemapDeclaredUrls: ['https://x.test/', 'https://x.test/cart', 'https://x.test/b'],
      robotsExcludedSitemapUrls: ['https://x.test/cart'],
      linkReachableUrls: new Set(['https://x.test/']),
    }));
    expect(c.sitemapRobotsExcluded).toBe(1);
    // /b is unreached (a defect); /cart is excluded (a choice) and must NOT be counted as unreached.
    expect(c.sitemapUnreached).toBe(1);
  });

  it('reports NULL, not 0, when the site published no usable sitemap', () => {
    // Zero would assert "every declared page is reachable" about a declaration we never received.
    const c = computeCoverageAccounting(base({ sitemapDeclaredUrls: null }));
    expect(c.sitemapDeclared).toBeNull();
    expect(c.sitemapUnreached).toBeNull();
  });

  it('reports 0 unreached on a fully link-reachable sitemap — the negative control', () => {
    const c = computeCoverageAccounting(base({
      sitemapDeclaredUrls: ['https://x.test/', 'https://x.test/a'],
      linkReachableUrls: new Set(['https://x.test/', 'https://x.test/a']),
    }));
    expect(c.sitemapUnreached).toBe(0);
  });
});

describe('D4 — the sitemap delta LEADS when most of the declared site is unreachable', () => {
  it('THE freepltn ACCEPTANCE CASE: 1 reachable of 821 declared', () => {
    // Measured in production. Only the homepage is reachable by clicking; the other 820 exist in the
    // sitemap and nothing links to them. The approved copy: "This is the finding, not a caveat."
    const declared = ['https://freepltn.test/', ...Array.from({ length: 820 }, (_, i) => `https://freepltn.test/p/${i}`)];
    const c = computeCoverageAccounting(base({
      sitemapDeclaredUrls: declared,
      linkReachableUrls: new Set(['https://freepltn.test/']),
    }));
    expect(c.sitemapDeclared).toBe(821);
    expect(c.sitemapUnreached).toBe(820);
    // CRITICAL because more of the declared site is unreachable than reachable — a CATEGORICAL
    // comparison, deliberately not a tuned fraction. 5.1a admits no new calibrated thresholds, and
    // "we picked 60%" invites the argument that "every comparison of the two halves ends".
    expect(sitemapDeltaSeverity(c)).toBe('critical');
  });

  it('is NOT critical when the unreachable pages are the minority', () => {
    const declared = Array.from({ length: 100 }, (_, i) => `https://x.test/p/${i}`);
    const c = computeCoverageAccounting(base({
      sitemapDeclaredUrls: declared,
      linkReachableUrls: new Set(declared.slice(0, 90)),
    }));
    expect(c.sitemapUnreached).toBe(10);
    expect(sitemapDeltaSeverity(c)).toBe('medium');
  });

  it('emits no severity at all when nothing is unreached, or when there is no sitemap', () => {
    expect(sitemapDeltaSeverity(computeCoverageAccounting(base({
      sitemapDeclaredUrls: ['https://x.test/'],
      linkReachableUrls: new Set(['https://x.test/']),
    })))).toBeNull();
    expect(sitemapDeltaSeverity(computeCoverageAccounting(base({ sitemapDeclaredUrls: null })))).toBeNull();
  });

  it('is critical on an exact tie-break boundary only when unreached STRICTLY exceeds reachable', () => {
    // 50/50 is not "most of your site", so it stays medium. Pinning the boundary keeps the categorical
    // rule from drifting into an off-by-one that would silently promote half the corpus.
    const declared = Array.from({ length: 10 }, (_, i) => `https://x.test/p/${i}`);
    const half = computeCoverageAccounting(base({
      sitemapDeclaredUrls: declared,
      linkReachableUrls: new Set(declared.slice(0, 5)),
    }));
    expect(half.sitemapUnreached).toBe(5);
    expect(sitemapDeltaSeverity(half)).toBe('medium');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M9 — the robots-excluded DENOMINATOR, pinned at the two places that consume it.
//
// ADDED AFTER A SURVIVING MUTATION. Replacing `sitemapDeclared - (sitemapRobotsExcluded ?? 0)` with
// `sitemapDeclared` in BOTH `sitemapDeltaSeverity` and `sitemapUnreachedFinding` left all 826 engine
// tests green. The fixture above builds the robots-excluded case and asserts only the two COUNTS —
// right input, wrong observable. The denominator's whole job is to decide the severity and the number
// the approved copy quotes, and neither was asserted.
// ─────────────────────────────────────────────────────────────────────────────
describe('the owner’s robots exclusions sit outside the comparison, on BOTH sides', () => {
  // 100 declared, 60 owner-disallowed, 25 of the remaining 40 unreachable.
  // Correct:  considered 40, reachable 15 -> 25 > 15 -> critical, and the copy quotes 15.
  // Mutated:  considered 100, reachable 75 -> 25 < 75 -> medium,  and the copy quotes 75.
  const declared = Array.from({ length: 100 }, (_, i) => `https://x.test/p${i}`);
  const disallowed = declared.slice(0, 60);
  const reachable = new Set(declared.slice(60, 75)); // 15 of the 40 permitted pages
  const c = computeCoverageAccounting(base({
    sitemapDeclaredUrls: declared,
    robotsExcludedSitemapUrls: disallowed,
    linkReachableUrls: reachable,
  }));

  it('measures reachability against what we were ALLOWED to reach', () => {
    expect(c.sitemapDeclared).toBe(100);
    expect(c.sitemapRobotsExcluded).toBe(60);
    expect(c.sitemapUnreached).toBe(25);
  });

  it('drives the SEVERITY off that denominator — 25 unreached of 40 permitted is critical', () => {
    const finding = sitemapUnreachedFinding(c);
    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('critical');
  });

  it('quotes the PERMITTED reachable count in the payload, not the raw declared total', () => {
    // 15, not 75. This is the number the approved copy renders to the owner.
    const finding = sitemapUnreachedFinding(c);
    expect(JSON.stringify(finding!.payload)).toContain('15');
    expect(JSON.stringify(finding!.payload)).not.toContain('75');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / B-A — "reachable by following links" is answered by a LINK, not by a FETCH.
//
// `linkReachableUrls` replaced a bare `new Set(ga.depths.keys())` at the call site. `depths` is BFS
// over a graph that drops every edge whose target was not fetched, so on its own it conflates "is
// this page linked" with "did our budget stretch to fetching it" — and the sitemap delta published
// the difference as a critical claim about the owner's site. Measured before the fix, on a site where
// every page links to every other page: 36 of 41 unreached at pageCap 5, 31 at cap 10, 0 at cap 41.
// ─────────────────────────────────────────────────────────────────────────────
describe('§7.2 — link-reachability is measured one hop past the fetch boundary', () => {
  const link = (fromUrl: string, toUrl: string) => ({ fromUrl, toUrl });

  it('counts a page we NEVER FETCHED as reachable when a reachable page links to it', () => {
    // The B-A shape in miniature: /b is declared and linked from the homepage, and the page cap
    // stopped us before we fetched it. It is reachable. Our budget is not the site's problem.
    const reachable = linkReachableUrls(['https://s/'], [link('https://s/', 'https://s/b')]);
    expect(reachable.has('https://s/b')).toBe(true);
  });

  it('does NOT take a second hop — a page linked only from an unfetched page stays unreached', () => {
    // THE ANTI-GROWTH PIN. Building the set by adding to the collection being iterated would make
    // this pass, and would make membership depend on the order `links` happens to arrive in, which
    // §6.6 forbids outright. We observe outbound links only for pages we fetched, so /c is a page
    // whose inbound link we never saw and cannot claim to have seen.
    const reachable = linkReachableUrls(
      ['https://s/'],
      [link('https://s/', 'https://s/b'), link('https://s/b', 'https://s/c')],
    );
    expect(reachable.has('https://s/b')).toBe(true);
    expect(reachable.has('https://s/c')).toBe(false);
  });

  it('is a pure function of the two inputs — link ARRIVAL ORDER cannot move it (§6.6)', () => {
    const links = [
      link('https://s/', 'https://s/b'),
      link('https://s/b', 'https://s/c'),
      link('https://s/', 'https://s/d'),
      link('https://s/d', 'https://s/e'),
    ];
    const forward = [...linkReachableUrls(['https://s/'], links)].sort();
    const reversed = [...linkReachableUrls(['https://s/'], [...links].reverse())].sort();
    expect(forward).toEqual(reversed);
    // And the shape is the one-hop shape, so this is not agreeing on a wrong answer.
    expect(forward).toEqual(['https://s/', 'https://s/b', 'https://s/d']);
  });

  it('keeps every BFS-reachable page, including one nothing links to (the homepage)', () => {
    const reachable = linkReachableUrls(['https://s/', 'https://s/deep'], []);
    expect([...reachable].sort()).toEqual(['https://s/', 'https://s/deep']);
  });

  it('drives the delta to zero on a fully interlinked site whose cap bound hard', () => {
    // End to end through the accounting, at the boundary the bug lived on: 41 declared, 5 fetched.
    const declared = Array.from({ length: 41 }, (_, i) => `https://s/p${i}`);
    const fetched = declared.slice(0, 5);
    // Every fetched page links to every declared page — an ordinary site nav.
    const links = fetched.flatMap((from) => declared.filter((t) => t !== from).map((to) => link(from, to)));

    const cov = computeCoverageAccounting({
      fetchedCount: fetched.length,
      gradeableCount: fetched.length,
      classifications: [],
      sitemapDeclaredUrls: declared,
      robotsExcludedSitemapUrls: [],
      linkReachableUrls: linkReachableUrls(fetched, links),
      estimate: { estimatedTotal: 41, method: 'sitemap' },
    } satisfies CoverageInput);

    expect(cov.sitemapUnreached).toBe(0);
    expect(sitemapUnreachedFinding(cov)).toBeNull();
  });

  it('still reports the freepltn shape — declared, fetched, and linked from nowhere', () => {
    // The counterpart. These pages WERE fetched (sitemap-seeded) and nothing links to them, so the
    // fix must not silence the finding it was built for.
    const declared = ['https://s/', ...Array.from({ length: 40 }, (_, i) => `https://s/p${i}`)];
    const cov = computeCoverageAccounting({
      fetchedCount: 41,
      gradeableCount: 41,
      classifications: [],
      sitemapDeclaredUrls: declared,
      robotsExcludedSitemapUrls: [],
      linkReachableUrls: linkReachableUrls(['https://s/'], []),
      estimate: { estimatedTotal: 41, method: 'sitemap' },
    } satisfies CoverageInput);

    expect(cov.sitemapUnreached).toBe(40);
    expect(sitemapUnreachedFinding(cov)?.severity).toBe('critical');
  });
});
