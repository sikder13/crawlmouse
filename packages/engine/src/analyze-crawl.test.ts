import { describe, it, expect } from 'vitest';
import { analyzeCrawl, type AnalysisContext } from './audit.js';
import { hashUrl } from './url-canonical.js';
import type { CrawlOutput, CrawledPage, CrawledLink } from './crawler.js';
import type { DetectionResult } from './cms-detection/index.js';
import type { PageAiSignals } from '@crawlmouse/types';

// SPEC 01 v2 §8 cutover gate (item 2) at the analysis layer. The backtest must "crawl once, grade
// twice": grade ONE crawl output under BOTH v1 and v2 so a delta is attributable to the ENGINE, not
// crawl-to-crawl drift. `analyzeCrawl` is the pure (network-free) grading half of `runAudit`; these
// tests pin that seam by grading hand-built crawl outputs under both engines and asserting the
// node-eligibility (§1) + retired-`unreachable_page` (§3) differences the gate diffs. Complements
// `audit-fetch-outcome.test.ts`, which drives the same contract end-to-end through a live crawl.

const HOME = 'https://ex.com';

function page(url: string, statusCode = 200): CrawledPage {
  return { url, urlHash: hashUrl(url), title: url, statusCode };
}
function link(fromUrl: string, toUrl: string): CrawledLink {
  return { fromUrl, toUrl, anchorText: 'a descriptive internal anchor', isGenericAnchor: false };
}
function makeCtx(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  const detection: DetectionResult = { cms: 'custom', confidence: 0 };
  return {
    url: HOME,
    homepageUrl: HOME,
    jsRendered: false,
    detection,
    cmsMetadata: {},
    startedAt: new Date('2026-06-17T00:00:00.000Z'),
    ...overrides,
  };
}
function orphanUrls(findings: { category: string; pageUrl?: string }[]): Set<string> {
  return new Set(findings.filter((f) => f.category === 'orphan').map((f) => f.pageUrl!));
}
function countByCategory(findings: { category: string }[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1;
    return acc;
  }, {});
}

describe('analyzeCrawl — per-page pagerank exposure (SPEC 02 v1.2 graph)', () => {
  const graphCrawl = (): CrawlOutput => ({
    pages: [page(HOME), page(`${HOME}/a`), page(`${HOME}/b`)],
    links: [link(HOME, `${HOME}/a`), link(HOME, `${HOME}/b`), link(`${HOME}/a`, HOME), link(`${HOME}/b`, HOME)],
  });

  it('v2 sets a numeric pagerank on each page; the hub (homepage) outranks a leaf', () => {
    const v2 = analyzeCrawl(graphCrawl(), makeCtx(), true);
    const home = v2.pages.find((p) => p.url === HOME)!;
    const leaf = v2.pages.find((p) => p.url === `${HOME}/a`)!;
    expect(typeof home.pagerank).toBe('number');
    expect(typeof leaf.pagerank).toBe('number');
    expect(home.pagerank!).toBeGreaterThan(leaf.pagerank!);
  });

  it('v1 leaves pagerank undefined (prod byte-identical)', () => {
    const v1 = analyzeCrawl(graphCrawl(), makeCtx(), false);
    expect(v1.pages.every((p) => p.pagerank === undefined)).toBe(true);
  });

  it('is deterministic — same crawl yields the same pagerank values', () => {
    const a = analyzeCrawl(graphCrawl(), makeCtx(), true).pages.map((p) => p.pagerank);
    const b = analyzeCrawl(graphCrawl(), makeCtx(), true).pages.map((p) => p.pagerank);
    expect(a).toEqual(b);
  });
});

describe('analyzeCrawl — crawl-once-grade-twice seam (SPEC 01 §8 gate)', () => {
  it('grades one crawlOut under both engines; v2 drops blocked/dead from the node set, v1 keeps them', () => {
    const crawlOut: CrawlOutput = {
      pages: [page(HOME), page(`${HOME}/good`), page(`${HOME}/throttled`, 403), page(`${HOME}/dead`, 404)],
      links: [
        link(HOME, `${HOME}/good`),
        link(`${HOME}/good`, HOME),
        link(HOME, `${HOME}/throttled`),
        link(HOME, `${HOME}/dead`),
      ],
    };

    const v1 = analyzeCrawl(crawlOut, makeCtx(), false);
    const v2 = analyzeCrawl(crawlOut, makeCtx(), true);

    const v1Throttled = v1.pages.find((p) => p.url === `${HOME}/throttled`)!;
    const v2Throttled = v2.pages.find((p) => p.url === `${HOME}/throttled`)!;

    // v1: a blocked fetch is still a graph node (inbound edge from home present) and carries no v2 columns.
    expect(v1Throttled.inDegree).toBe(1);
    expect(v1Throttled.fetchOutcome).toBeUndefined();
    expect(v1Throttled.excludedFromGrade).toBeUndefined();
    expect(v1.crawlHealth).toBeUndefined();

    // v2: blocked/dead fetches are crawl OUTCOMES, not nodes — excluded from the graph, tagged as such.
    expect(v2Throttled.inDegree).toBe(0);
    expect(v2Throttled.fetchOutcome).toBe('blocked');
    expect(v2Throttled.excludedFromGrade).toBe(true);
    const v2Dead = v2.pages.find((p) => p.url === `${HOME}/dead`)!;
    expect(v2Dead.fetchOutcome).toBe('dead');
    expect(v2Dead.excludedFromGrade).toBe(true);
    expect(v2.crawlHealth).toBeDefined();

    // §0 guarantee under v2: no finding may point at an excluded (blocked/dead) URL.
    const excluded = new Set(v2.pages.filter((p) => p.excludedFromGrade).map((p) => p.url));
    expect(v2.findings.every((f) => !f.pageUrl || !excluded.has(f.pageUrl))).toBe(true);
  });

  it('v2 removes the FALSE orphan on a blocked node while keeping a REAL 200 orphan (the §0 fix)', () => {
    // /throttled: sitemap-seeded, blocked, zero inbound -> a FALSE orphan if treated as a node (v1).
    // /trueorphan: a genuine 200 page with zero inbound -> a legitimate orphan under BOTH engines.
    const crawlOut: CrawlOutput = {
      pages: [page(HOME), page(`${HOME}/good`), page(`${HOME}/throttled`, 403), page(`${HOME}/trueorphan`)],
      links: [link(HOME, `${HOME}/good`), link(`${HOME}/good`, HOME)],
    };

    const v1Orphans = orphanUrls(analyzeCrawl(crawlOut, makeCtx(), false).findings);
    const v2Orphans = orphanUrls(analyzeCrawl(crawlOut, makeCtx(), true).findings);

    // v1 manufactures a false orphan on the blocked fetch; v2 does not (it is not a node).
    expect(v1Orphans.has(`${HOME}/throttled`)).toBe(true);
    expect(v2Orphans.has(`${HOME}/throttled`)).toBe(false);
    // The genuine 200 orphan is reported by BOTH — v2 preserves real signal, never suppresses it.
    expect(v1Orphans.has(`${HOME}/trueorphan`)).toBe(true);
    expect(v2Orphans.has(`${HOME}/trueorphan`)).toBe(true);
  });

  it('retires unreachable_page in v2; v1 still emits it on a 200 island with inbound links but no path from home', () => {
    const A = `${HOME}/island-a`;
    const B = `${HOME}/island-b`;
    // A<->B link mutually (each has inbound, so neither is an orphan) but neither is reachable from home
    // -> null BFS depth -> the v1 `unreachable_page` finding (the §0 symptom). v2 retires it (§3).
    const crawlOut: CrawlOutput = {
      pages: [page(HOME), page(`${HOME}/good`), page(A), page(B)],
      links: [link(HOME, `${HOME}/good`), link(`${HOME}/good`, HOME), link(A, B), link(B, A)],
    };

    const v1Counts = countByCategory(analyzeCrawl(crawlOut, makeCtx(), false).findings);
    const v2Counts = countByCategory(analyzeCrawl(crawlOut, makeCtx(), true).findings);

    expect(v1Counts.unreachable_page ?? 0).toBeGreaterThanOrEqual(1);
    expect(v2Counts.unreachable_page ?? 0).toBe(0);
  });
});

describe('analyzeCrawl — SPEC 02 §2 confidence band (replaces the blunt low-confidence cap)', () => {
  // The SAME 5-node hub graph (home <-> a/b/c/d) under two coverage scenarios. The grade graph is
  // built from 200-only nodes, so the unfetched link targets below are DROPPED from the graph
  // (identical structure, identical raw grade) and only lower coverage → low confidence.
  function hubLinks(): CrawledLink[] {
    const links: CrawledLink[] = [];
    for (const u of [`${HOME}/a`, `${HOME}/b`, `${HOME}/c`, `${HOME}/d`]) {
      links.push(link(HOME, u));
      links.push(link(u, HOME));
    }
    return links;
  }
  const hubPages = () => [HOME, `${HOME}/a`, `${HOME}/b`, `${HOME}/c`, `${HOME}/d`].map((u) => page(u));

  function fullCoverageCrawl(): CrawlOutput {
    return { pages: hubPages(), links: hubLinks() };
  }
  function lowCoverageCrawl(): CrawlOutput {
    // 15 distinct link targets the crawl never fetched → discovered ≫ fetchedOk → coverage ≈ 0.25.
    const links = hubLinks();
    for (let i = 0; i < 15; i++) links.push(link(HOME, `${HOME}/unfetched-${i}`));
    return { pages: hubPages(), links };
  }

  it('no longer caps a low-confidence crawl: identical graph → identical grade regardless of coverage', () => {
    const low = analyzeCrawl(lowCoverageCrawl(), makeCtx(), true);
    const high = analyzeCrawl(fullCoverageCrawl(), makeCtx(), true);
    expect(low.crawlHealth?.confidence).toBe('low');
    expect(high.crawlHealth?.confidence).toBe('high');
    // §2: the point estimate is the REAL computed grade. The two graphs are identical, so the grades
    // must match — low confidence no longer clamps the well-structured site to C/60.
    expect(low.score).toBe(high.score);
    expect(low.score).toBeGreaterThan(60);
  });

  it('carries a band whose point estimate equals the uncapped score, framed as an estimate', () => {
    const v2 = analyzeCrawl(lowCoverageCrawl(), makeCtx(), true);
    expect(v2.confidenceBand).toBeDefined();
    expect(v2.confidenceBand!.pointEstimate).toBe(v2.score);
    expect(v2.confidenceBand!.grade).toBe(v2.grade);
    expect(v2.confidenceBand!.confidence).toBe('low');
    expect(v2.confidenceBand!.isEstimate).toBe(true);
    expect(v2.confidenceBand!.basis.crawled).toBe(5);
    expect(v2.confidenceBand!.basis.method).toBe('frontier');
    expect(v2.confidenceBand!.basis.estimatedTotal).toBeGreaterThan(5);
  });

  it('uses the sitemap count for the site-total estimate when it is threaded through the context', () => {
    const v2 = analyzeCrawl(lowCoverageCrawl(), makeCtx({ sitemapUrlCount: 1200 }), true);
    expect(v2.confidenceBand!.basis.method).toBe('sitemap');
    expect(v2.confidenceBand!.basis.estimatedTotal).toBe(1200);
  });

  it('a fully-covered crawl is a clean verdict: high confidence, not an estimate, no "of ~M"', () => {
    const v2 = analyzeCrawl(fullCoverageCrawl(), makeCtx(), true);
    expect(v2.confidenceBand!.confidence).toBe('high');
    expect(v2.confidenceBand!.isEstimate).toBe(false);
    expect(v2.confidenceBand!.basis.method).toBe('none');
    expect(v2.confidenceBand!.basis.estimatedTotal).toBeNull();
  });

  it('emits NO band on the v1 path (v2-only; prod stays byte-identical until the flip)', () => {
    expect(analyzeCrawl(lowCoverageCrawl(), makeCtx(), false).confidenceBand).toBeUndefined();
  });
});

describe('analyzeCrawl — SPEC 02 §3-§5 conversion core (ledger + free-fix + action-packet)', () => {
  // A reachable hub with one real 200 orphan → a prescribable orphan fix.
  function withOrphan(): CrawlOutput {
    return {
      pages: [page(HOME), page(`${HOME}/a`), page(`${HOME}/b`), page(`${HOME}/c`), page(`${HOME}/orphan`)],
      links: [link(HOME, `${HOME}/a`), link(HOME, `${HOME}/b`), link(`${HOME}/a`, `${HOME}/c`), link(`${HOME}/b`, `${HOME}/c`)],
    };
  }

  it('produces a projected grade + a complete free fix + prescriptions on v2', () => {
    const v2 = analyzeCrawl(withOrphan(), makeCtx(), true);
    expect(v2.projectedGrade).toBeDefined();
    expect(v2.projectedGrade!.current.score).toBe(v2.score); // current is the audit's actual grade
    expect(v2.projectedGrade!.ledger.some((f) => f.category === 'orphan')).toBe(true);

    expect(v2.freeFix).toBeTruthy();
    expect(v2.freeFix!.rank).toBe(1);
    expect(v2.freeFix!.prescription.suggestedLinks.length).toBeGreaterThan(0);
    expect(v2.freeFix!.prescription.actionPacket.body.length).toBeGreaterThan(0);
    expect(Array.isArray(v2.prescriptions)).toBe(true);
  });

  it('emits NO ledger/free-fix/prescriptions on v1 (v2-only; prod byte-identical until the flip)', () => {
    const v1 = analyzeCrawl(withOrphan(), makeCtx(), false);
    expect(v1.projectedGrade).toBeUndefined();
    expect(v1.prescriptions).toBeUndefined();
    expect(v1.freeFix).toBeUndefined();
  });

  it('on a JS-rendered site emits the band but NO projection (false orphans → no bogus cures)', () => {
    const v2 = analyzeCrawl(withOrphan(), makeCtx({ jsRendered: true }), true);
    expect(v2.confidenceBand).toBeDefined();
    expect(v2.projectedGrade).toBeUndefined();
    expect(v2.freeFix).toBeUndefined();
    expect(v2.prescriptions).toBeUndefined();
  });

  it('is deterministic: identical crawl output → identical projection + free fix', () => {
    const a = analyzeCrawl(withOrphan(), makeCtx(), true);
    const b = analyzeCrawl(withOrphan(), makeCtx(), true);
    expect(JSON.stringify(b.projectedGrade)).toBe(JSON.stringify(a.projectedGrade));
    expect(JSON.stringify(b.freeFix)).toBe(JSON.stringify(a.freeFix));
  });
});

describe('analyzeCrawl — cross-host node-eligibility (§0 doctrine; off-site share pages are not nodes)', () => {
  const EXT = 'https://api.whatsapp.com/send';
  function withCrossHost(): CrawlOutput {
    // EXT is a fetched 200 cross-host page with zero inbound (a WP/Shopify share button) — pre-fix it
    // becomes a false orphan that drags the grade and pollutes the ledger.
    return {
      pages: [page(HOME), page(`${HOME}/a`), page(`${HOME}/b`), page(EXT)],
      links: [link(HOME, `${HOME}/a`), link(HOME, `${HOME}/b`), link(`${HOME}/a`, `${HOME}/b`)],
    };
  }

  it('excludes a cross-host fetched page from the grade + crawl-health and never flags it an orphan (v2)', () => {
    const v2 = analyzeCrawl(withCrossHost(), makeCtx(), true);
    expect(v2.pages.find((p) => p.url === EXT)!.excludedFromGrade).toBe(true);
    expect(v2.findings.every((f) => f.pageUrl !== EXT)).toBe(true);
    expect(v2.findings.some((f) => f.category === 'orphan')).toBe(false); // no false orphan from EXT
    expect(v2.crawlHealth!.fetchedOk).toBe(3); // only the 3 same-host pages count as the site
  });

  it('never lets the cross-host page into the projection ledger or a prescription (v2)', () => {
    const v2 = analyzeCrawl(withCrossHost(), makeCtx(), true);
    expect((v2.projectedGrade?.ledger ?? []).every((f) => f.targetUrl !== EXT)).toBe(true);
    for (const p of v2.prescriptions ?? []) for (const s of p.suggestedLinks) expect(s.fromUrl).not.toBe(EXT);
  });

  it('v1 is unchanged: cross-host pages stay nodes (the fix is v2-only / flip-gated)', () => {
    const v1 = analyzeCrawl(withCrossHost(), makeCtx(), false);
    expect(v1.pages.find((p) => p.url === EXT)!.excludedFromGrade).toBeUndefined();
  });
});

describe('analyzeCrawl — per-page AI signals (SPEC 05 §4; v2-gated for prod byte-identity)', () => {
  const SIG: PageAiSignals = {
    pageClass: 'readable',
    mainTextChars: 300, title: 'Fixture Title',
    excerpt: 'a readable excerpt',
    csrSignals: [],
    frameworkMarker: null,
    hasTitle: true,
    hasMetaDescription: true,
    h1Count: 1,
    headingLevelsSkipped: false,
    hasMainLandmark: true,
    jsonLd: { present: false, valid: false, types: [], hasEntityType: false },
  };
  function crawlWithSignals(): CrawlOutput {
    return {
      pages: [
        { ...page(HOME), aiSignals: SIG },
        { ...page(`${HOME}/a`), aiSignals: { ...SIG, pageClass: 'thin' } },
      ],
      links: [link(HOME, `${HOME}/a`), link(`${HOME}/a`, HOME)],
    };
  }

  it('v2 carries the per-page aiSignals through onto each output page', () => {
    const v2 = analyzeCrawl(crawlWithSignals(), makeCtx(), true);
    expect(v2.pages.find((p) => p.url === HOME)!.aiSignals?.pageClass).toBe('readable');
    expect(v2.pages.find((p) => p.url === `${HOME}/a`)!.aiSignals?.pageClass).toBe('thin');
  });

  it('v1 leaves aiSignals undefined on the output pages (prod byte-identical until the flip)', () => {
    const v1 = analyzeCrawl(crawlWithSignals(), makeCtx(), false);
    expect(v1.pages.every((p) => p.aiSignals === undefined)).toBe(true);
  });

  it('does not affect the grade (additive observation only)', () => {
    const withSig = analyzeCrawl(crawlWithSignals(), makeCtx(), true);
    const withoutSig = analyzeCrawl(
      { pages: [page(HOME), page(`${HOME}/a`)], links: [link(HOME, `${HOME}/a`), link(`${HOME}/a`, HOME)] },
      makeCtx(),
      true,
    );
    expect(withSig.score).toBe(withoutSig.score);
    expect(withSig.grade).toBe(withoutSig.grade);
  });
});

describe('analyzeCrawl — AI-readiness assembly (SPEC 05 §7; v2-gated + null-assembly rule)', () => {
  const SIG: PageAiSignals = {
    pageClass: 'readable',
    mainTextChars: 400, title: 'Fixture Title',
    excerpt: 'excerpt',
    csrSignals: [],
    frameworkMarker: null,
    hasTitle: true,
    hasMetaDescription: true,
    h1Count: 1,
    headingLevelsSkipped: false,
    hasMainLandmark: true,
    jsonLd: { present: true, valid: true, types: ['Organization'], hasEntityType: true },
  };
  const withSignals = (): CrawlOutput => ({
    pages: [{ ...page(HOME), aiSignals: SIG }, { ...page(`${HOME}/a`), aiSignals: SIG }],
    links: [link(HOME, `${HOME}/a`), link(`${HOME}/a`, HOME)],
  });

  it('assembles aiReadiness on v2 when eligible pages carry signals', () => {
    const r = analyzeCrawl(withSignals(), makeCtx(), true).aiReadiness;
    expect(r).toBeDefined();
    expect(r!.score).toBeGreaterThanOrEqual(0);
    expect(r!.score).toBeLessThanOrEqual(100);
    expect(['ready', 'partial', 'at_risk']).toContain(r!.band);
    expect(r!.basis.pagesAnalyzed).toBe(2);
  });

  it('NULL-ASSEMBLY: a v2 crawl whose pages carry NO signals → aiReadiness undefined (feature hidden)', () => {
    const noSignals: CrawlOutput = {
      pages: [page(HOME), page(`${HOME}/a`)], // page() has no aiSignals (extraction disabled/degraded)
      links: [link(HOME, `${HOME}/a`), link(`${HOME}/a`, HOME)],
    };
    expect(analyzeCrawl(noSignals, makeCtx(), true).aiReadiness).toBeUndefined();
  });

  it('v1 never assembles aiReadiness (prod byte-identical until the flip)', () => {
    expect(analyzeCrawl(withSignals(), makeCtx(), false).aiReadiness).toBeUndefined();
  });

  it('assembles on a JS-rendered site too (NOT gated on jsRendered), with a depth_only retrieval basis', () => {
    const r = analyzeCrawl(withSignals(), makeCtx({ jsRendered: true }), true).aiReadiness;
    expect(r).toBeDefined();
    expect(r!.basis.retrievalPathBasis).toBe('depth_only');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M10 — the crawlTruncated WIRE, pinned. Both endpoints were tested and the wire between them was
// not: `crawlTruncated: crawlHealth ? crawlHealth.partial : null` could be replaced with `null` and
// all 826 engine tests stayed green.
//
// This single input decides which of TWO MUTUALLY CONTRADICTORY sentences a refused owner reads:
//   truncated=false -> "We crawled all N pages — that's the whole site, not a partial read"
//   truncated=true  -> "We didn't read enough of your site to grade it"
// Telling the owner of a complete 3-page brochure that we couldn't read enough of their site is
// exactly the falsehood the small/large split exists to prevent — and mutating it to `null` sends
// EVERY refusal down the insufficient-evidence branch, because unknown truncation takes that branch
// by design.
// ─────────────────────────────────────────────────────────────────────────────
describe('the crawl-truncation signal reaches the refusal gate', () => {
  /** A complete crawl of a 2-page site: below the gradeable floor, nothing left unfetched. */
  const tinyComplete = (): CrawlOutput => ({
    pages: [page(HOME), page(`${HOME}/a`)],
    links: [link(HOME, `${HOME}/a`), link(`${HOME}/a`, HOME)],
  });
  /** The same tiny gradeable set, but with 30 discovered-and-unfetched targets → partial. */
  const tinyTruncated = (): CrawlOutput => {
    const links = [link(HOME, `${HOME}/a`), link(`${HOME}/a`, HOME)];
    for (let i = 0; i < 30; i++) links.push(link(HOME, `${HOME}/never-fetched-${i}`));
    return { pages: [page(HOME), page(`${HOME}/a`)], links, budgetExhausted: true };
  };

  it('a COMPLETE crawl below the floor refuses as "too small", not as "we read too little"', () => {
    const r = analyzeCrawl(tinyComplete(), makeCtx(), true);
    expect(r.refusal?.refused).toBe(true);
    expect(r.refusal?.triggers).toContain('site_too_small_to_measure');
    expect(r.refusal?.triggers).not.toContain('too_few_gradeable_pages');
  });

  it('a TRUNCATED crawl below the floor refuses as "we read too little", not as "too small"', () => {
    const r = analyzeCrawl(tinyTruncated(), makeCtx(), true);
    expect(r.refusal?.refused).toBe(true);
    expect(r.refusal?.triggers).toContain('too_few_gradeable_pages');
    expect(r.refusal?.triggers).not.toContain('site_too_small_to_measure');
  });
});

// S5 — the estimateSource WIRE, the line immediately after the crawlTruncated wire pinned last
// round. `estimateSource: siteEstimate ? siteEstimate.method : 'none'` -> `'sitemap'` passed all 838
// engine tests. `method: 'none'` is reachable and covers roughly a tenth of the live corpus; hardcoding
// a source makes `confidenceCapped` permanently false, so the one signal that says "coverage is
// unknowable" would silently never fire.
describe('the coverage-estimate PROVENANCE reaches the refusal gate', () => {
  it('reports estimateSource none when no estimate could be made, and caps confidence for it', () => {
    // A tiny complete crawl with no sitemap: nothing to estimate a site total from.
    const r = analyzeCrawl(
      { pages: [page(HOME), page(`${HOME}/a`)], links: [link(HOME, `${HOME}/a`), link(`${HOME}/a`, HOME)] },
      makeCtx(),
      true,
    );
    expect(r.coverage?.estimateSource).toBe('none');
    expect(r.coverage?.coverageRatio).toBeNull(); // null when unknowable, never 1.0
    expect(r.refusal?.confidenceCapped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HOTFIX H2 — §6.7's fingerprint must SURVIVE the grading half.
//
// It did not, and nothing noticed: `crawler.ts` built it and set `out.fingerprint`, `analyzeCrawl`
// never read it, and `persist-results.ts`'s `result.fingerprint ? … : {}` was therefore always false.
// **0 of 231 production audits carried one.** Every piece around it was tested — `fingerprintFor` in
// isolation, `boundFingerprintForPersist` in isolation, and the persist branch fed a fingerprint
// directly — so the missing propagation sat in the gap BETWEEN two well-tested halves.
//
// This asserts the seam itself, which is the only place that gap was visible.
// ─────────────────────────────────────────────────────────────────────────────
describe('§6.7 fingerprint propagation through analyzeCrawl', () => {
  const FP = {
    version: 1 as const,
    discoveredCount: 100,
    selectedCount: 40,
    digest: 'deadbeef',
    strata: [{ templateKey: '/p/{slug}', discovered: 90, selected: 30 }],
    seed: 'cm-frontier-v1',
    strataTotal: 1,
    strataWithheld: 0,
  };

  const crawl = (over: Partial<CrawlOutput> = {}): CrawlOutput => ({
    pages: [page(HOME), page(`${HOME}/a`), page(`${HOME}/b`)],
    links: [link(HOME, `${HOME}/a`), link(HOME, `${HOME}/b`)],
    ...over,
  });

  it('carries the crawl fingerprint onto the AuditResult', () => {
    const out = analyzeCrawl(crawl({ fingerprint: FP }), makeCtx(), true);
    expect(out.fingerprint, 'the fingerprint did not survive analyzeCrawl').toBeDefined();
    expect(out.fingerprint).toEqual(FP);
  });

  it('omits it entirely when the crawl produced none — never a fabricated empty one', () => {
    const out = analyzeCrawl(crawl(), makeCtx(), true);
    expect(out.fingerprint).toBeUndefined();
  });

  it('carries it on the v1 path too when present — the seam is not v2-gated', () => {
    // v1 never produces one today, but the propagation must not silently depend on the engine flag:
    // that would be a second place for it to be dropped.
    const out = analyzeCrawl(crawl({ fingerprint: FP }), makeCtx(), false);
    expect(out.fingerprint).toEqual(FP);
  });

  it('does not mutate or re-derive it — persistence bounds it, this seam only carries it', () => {
    const out = analyzeCrawl(crawl({ fingerprint: FP }), makeCtx(), true);
    expect(out.fingerprint!.strata).toHaveLength(1);
    expect(out.fingerprint!.discoveredCount).toBe(100);
    expect(out.fingerprint!.digest).toBe('deadbeef');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S6 — THE EXCLUSION-COUNT WIRE. `audit.ts`'s
//   `excludedPageCount: coverage ? coverage.excluded.reduce((n, e) => n + e.count, 0) : null`
// is the ONLY connection between the kind classifier and the refusal gate. `grep -rn excludedPageCount`
// finds it exactly once outside `refusal.ts`/`refusal.test.ts`.
//
// ⚠ IT SHIPPED WITH NO TEST, AND A REVIEWER PROVED IT: replacing that expression with `null` left
//   Test Files  65 passed (65)
//        Tests  849 passed (849)
// entirely green. With that one token changed, `excludedPageCount === null` always takes the fallback
// branch, `too_few_gradeable_after_exclusion` can never fire in production, and quotes.toscrape.com is
// told `site_too_small_to_measure` again — the precise defect the hotfix exists to delete — while the
// four mutations quoted in its evidence file all still reproduce.
//
// THIS IS THE SAME CLASS AS THE DROPPED FINGERPRINT, one function over and 167 lines up. Both halves
// were well tested and the WIRE BETWEEN THEM was not: `refusal.test.ts` drives `decideRefusal` with
// hand-fed evidence, and `classify-pages.test.ts` drives the classifier, and nothing asserted that
// production feeds the one from the other. A seam test was added for the fingerprint at `audit.ts:712`
// in the same commit that left this one bare.
// ─────────────────────────────────────────────────────────────────────────────
describe('the exclusion COUNT reaches the refusal gate', () => {
  /** A page with explicit classification signals, so the kind is driven rather than inferred. */
  function classified(url: string, mainTextChars: number, statusCode = 200): CrawledPage {
    return {
      url,
      urlHash: hashUrl(url),
      title: url,
      statusCode,
      classificationSignals: { mainTextChars, simhash: null, metaNoindex: false, headerNoindex: false },
    };
  }

  /**
   * quotes.toscrape.com in miniature: a site far above the floor whose graded population OUR OWN
   * classifier cut to one page. Pagination and tag archives by URL rule, exactly as production
   * recorded it (`pagination 152, archive 60, auth 1` → `gradeable 1`).
   *
   * Complete crawl — every link target is fetched — so `crawlTruncated` is false and the truncated
   * branch cannot claim this.
   */
  const excludedShape = (): CrawlOutput => {
    const pages: CrawledPage[] = [classified(HOME, 900)];
    const links: CrawledLink[] = [];
    for (let i = 2; i <= 7; i++) {
      const u = `${HOME}/page/${i}`;
      pages.push(classified(u, 900));
      links.push(link(HOME, u), link(u, HOME));
    }
    for (const t of ['humor', 'books', 'life']) {
      const u = `${HOME}/tag/${t}`;
      pages.push(classified(u, 900));
      links.push(link(HOME, u), link(u, HOME));
    }
    return { pages, links };
  };

  /** The control the wedge fix exists to protect: a genuinely small site, nothing excluded. */
  const brochure = (): CrawlOutput => {
    const pages = [classified(HOME, 900), classified(`${HOME}/about`, 900), classified(`${HOME}/contact`, 900)];
    return { pages, links: [link(HOME, `${HOME}/about`), link(HOME, `${HOME}/contact`), link(`${HOME}/about`, HOME)] };
  };

  it('a 10-page site cut to 1 gradeable refuses as OUR exclusion, not as "too small"', () => {
    const r = analyzeCrawl(excludedShape(), makeCtx(), true);

    // The precondition, asserted rather than assumed: the site really is above the floor and really
    // was cut by us. If the classifier stops excluding these URLs, this test must fail loudly rather
    // than quietly stop testing the wire.
    const excluded = r.coverage!.excluded.reduce((n, e) => n + e.count, 0);
    expect(r.coverage!.gradeable, 'gradeable').toBeLessThan(5);
    expect(r.coverage!.gradeable + excluded, 'the population must clear the floor').toBeGreaterThanOrEqual(5);
    expect(excluded, 'our classifier must actually have cut pages').toBeGreaterThan(0);

    expect(r.refusal?.refused).toBe(true);
    expect(r.refusal?.triggers).toContain('too_few_gradeable_after_exclusion');
    expect(r.refusal?.triggers).not.toContain('site_too_small_to_measure');
    expect(r.refusal?.triggers).not.toContain('too_few_gradeable_pages');
  });

  it('the composition that reaches coverage is the one the copy will name', () => {
    // The wire carries a TOTAL, but the copy renders the breakdown, so pin both: a kind that is not
    // here must not be nameable, and the total must equal the sum of the parts.
    const r = analyzeCrawl(excludedShape(), makeCtx(), true);
    const kinds = Object.fromEntries(r.coverage!.excluded.map((e) => [e.kind, e.count]));
    expect(kinds.pagination, 'six /page/N URLs').toBe(6);
    expect(kinds.archive, 'three /tag/X URLs').toBe(3);
    expect(kinds.thin, 'no page here is thin — every one carries 900 chars').toBeUndefined();
    expect(r.coverage!.gradeable).toBe(1);
  });

  it('a genuinely small site is still SMALL — the wire must not invent an exclusion', () => {
    // The regression the population fix exists to prevent, driven end to end rather than at the gate.
    const r = analyzeCrawl(brochure(), makeCtx(), true);
    expect(r.coverage!.excluded.reduce((n, e) => n + e.count, 0)).toBe(0);
    expect(r.refusal?.triggers).toContain('site_too_small_to_measure');
    expect(r.refusal?.triggers).not.toContain('too_few_gradeable_after_exclusion');
  });
});
