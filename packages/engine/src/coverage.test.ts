import { describe, it, expect } from 'vitest';
import type { PageClassification } from '@crawlmouse/types';
import { computeCoverageAccounting, type CoverageInput } from './coverage.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// §7.2 — WHAT REMAINS OF THE SITEMAP ACCOUNTING AFTER THE D4 CUT.
//
// `sitemapUnreached`, `sitemapDeltaSeverity` and `sitemapUnreachedFinding` are gone, with the tests
// that certified them. They counted declared URLs not reachable by following links, which reads as a
// property of the site and was a property of OUR PAGE CAP: 400 / 400 / 400 / 230 / 0 unreached across
// caps 5 / 10 / 25 / 60 / 441 on a site with zero orphans by any definition.
//
// Two facts survive because neither moves with our budget: what the sitemap DECLARED (we received the
// declaration) and what the owner DISALLOWED (they wrote the rule). These pin that both stay, and
// that nothing reintroduces a reachability claim alongside them.
// ─────────────────────────────────────────────────────────────────────────────
describe('§7.2 — the sitemap accounting states only what we hold', () => {
  const base = (over: Partial<CoverageInput> = {}): CoverageInput => ({
    fetchedCount: 10,
    gradeableCount: 8,
    classifications: [],
    sitemapDeclaredUrls: null,
    robotsExcludedSitemapUrls: [],
    estimate: { estimatedTotal: null, method: 'none' },
    ...over,
  });

  it('reports what the sitemap declared, and what the OWNER excluded, separately', () => {
    const cov = computeCoverageAccounting(base({
      sitemapDeclaredUrls: ['https://s/', 'https://s/a', 'https://s/cart', 'https://s/checkout'],
      robotsExcludedSitemapUrls: ['https://s/cart', 'https://s/checkout'],
    }));
    expect(cov.sitemapDeclared).toBe(4);
    expect(cov.sitemapRobotsExcluded).toBe(2);
  });

  it('counts owner exclusions over the DECLARED set — robots cannot inflate them', () => {
    // A robots.txt naming paths the sitemap never listed says nothing about the sitemap.
    const cov = computeCoverageAccounting(base({
      sitemapDeclaredUrls: ['https://s/', 'https://s/a'],
      robotsExcludedSitemapUrls: ['https://s/never-declared', 'https://s/also-not'],
    }));
    expect(cov.sitemapDeclared).toBe(2);
    expect(cov.sitemapRobotsExcluded).toBe(0);
  });

  it('is NULL, never 0, when there was no usable sitemap', () => {
    // 0 would assert that every declared page is accounted for, about a declaration we never received.
    const cov = computeCoverageAccounting(base({ sitemapDeclaredUrls: null }));
    expect(cov.sitemapDeclared).toBeNull();
    expect(cov.sitemapRobotsExcluded).toBeNull();
  });

  it('emits NO reachability claim of any kind — the D4 cut, asserted on the payload bytes', () => {
    // The guard against D4 creeping back in under another name. Anything the engine says about a
    // declared URL's inbound links is a claim it cannot support at a bounded page cap.
    const cov = computeCoverageAccounting(base({
      sitemapDeclaredUrls: ['https://s/', 'https://s/a', 'https://s/b'],
    }));
    const serialized = JSON.stringify(cov);
    expect(serialized).not.toContain('nreach');   // sitemapUnreached / unreached / Unreached
    expect(serialized).not.toContain('eachable'); // linkReachable / reachable
    // Anti-vacuity: the fields that SHOULD be there are.
    expect(serialized).toContain('sitemapDeclared');
    expect(serialized).toContain('sitemapRobotsExcluded');
  });
});
