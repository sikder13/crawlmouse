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
