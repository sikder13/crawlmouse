import { describe, it, expect } from 'vitest';
import { analyzeCrawl, type AnalysisContext } from './audit.js';
import { hashUrl } from './url-canonical.js';
import type { CrawlOutput, CrawledPage, CrawledLink } from './crawler.js';
import type { DetectionResult } from './cms-detection/index.js';

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
