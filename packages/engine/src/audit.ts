import type { AuditOptions, AuditResult, Page, Link, Finding, CmsMetadata } from '@crawlmouse/types';
import { runCrawl } from './crawler.js';
import { buildGraph } from './graph.js';
import { detectOrphans } from './analysis/orphans.js';
import { computeDepth } from './analysis/depth.js';
import { perTargetHHI, genericAnchorFraction } from './analysis/anchor.js';
import { computePageRank, giniCoefficient } from './analysis/pagerank.js';
import { computeGrade } from './grade.js';
import { detectCms } from './cms-detection/index.js';
import { getAdjustments } from './cms-adjustments/index.js';
import { discoverSitemaps, parseSitemapUrls } from './sitemap.js';
import { hashUrl, canonicalizeUrl } from './url-canonical.js';
import { validateUrlOrThrow } from './ssrf-guard.js';

export interface InternalAuditFlags {
  allowPrivateIpsForTesting?: boolean;
}

export async function runAudit(opts: AuditOptions, flags: InternalAuditFlags = {}): Promise<AuditResult> {
  const startedAt = new Date();
  const origin = new URL(opts.url).origin;
  const homepageUrl = canonicalizeUrl(origin);

  // Validate the homepage URL against SSRF before fetching.
  // The test/internal flag bypasses for localhost-loopback test fixtures only.
  if (!flags.allowPrivateIpsForTesting) {
    await validateUrlOrThrow(homepageUrl);
  }
  // Fetch homepage HTML for CMS detection (also seeds the crawl)
  const homepageRes = await fetch(homepageUrl);
  const html = await homepageRes.text();
  const headers: Record<string, string> = {};
  homepageRes.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const detection = detectCms(html, headers);
  const cmsMetadata: CmsMetadata = {};

  // Sitemap discovery
  const fetcher = async (u: string) => {
    const r = await fetch(u);
    return { status: r.status, body: await r.text() };
  };
  const discovered = await discoverSitemaps(origin, { fetcher });
  let seedUrls: string[];
  if (discovered.sitemapUrls.length > 0) {
    const all: string[] = [];
    for (const sm of discovered.sitemapUrls) {
      const urls = await parseSitemapUrls(sm, { fetcher });
      for (const u of urls) all.push(u);
    }
    seedUrls = Array.from(new Set([homepageUrl, ...all.map(canonicalizeUrl)])).slice(0, opts.pageCap ?? 500);
  } else {
    seedUrls = [homepageUrl];
  }

  // Crawl
  const crawlOut = await runCrawl({
    startUrls: seedUrls,
    pageCap: opts.pageCap ?? 500,
    perHostConcurrency: opts.perHostConcurrency ?? 8,
    staggerMs: opts.staggerMs ?? 250,
    pageTimeoutMs: opts.pageTimeoutMs ?? 10000,
    basicAuth: opts.basicAuth,
    extraHeaders: opts.extraHeaders,
    allowPrivateIpsForTesting: flags.allowPrivateIpsForTesting,
  });

  // Build graph
  const graph = buildGraph(crawlOut.pages, crawlOut.links);

  // CMS-aware exclusions for orphan detection
  const adjust = getAdjustments(detection.cms);
  const orphanResult = detectOrphans(graph, homepageUrl);
  const filteredOrphans = orphanResult.orphans.filter((u) => !adjust.excludeFromOrphans(u));
  const orphanRatio = graph.order > 0 ? filteredOrphans.length / graph.order : 0;

  // Depth
  const depths = computeDepth(graph, homepageUrl);
  const beyond3 = Array.from(depths.values()).filter((d) => d > 3).length;
  const unreachable = graph.order - depths.size;
  const pagesBeyondDepth3Fraction = graph.order > 0 ? beyond3 / graph.order : 0;
  const unreachableFraction = graph.order > 0 ? unreachable / graph.order : 0;

  // Anchor analysis
  const hhiMap = perTargetHHI(graph);
  const meanHHI = hhiMap.size > 0 ? Array.from(hhiMap.values()).reduce((a, b) => a + b, 0) / hhiMap.size : 0;
  const genericFrac = genericAnchorFraction(graph);

  // PageRank
  const ranks = computePageRank(graph);
  const gini = giniCoefficient(Array.from(ranks.values()));

  // Grade
  const grade = computeGrade({
    orphanRatio,
    pagesBeyondDepth3Fraction,
    unreachableFraction,
    meanAnchorHHI: meanHHI,
    genericAnchorFraction: genericFrac,
    pageRankGini: gini,
  });

  // Build outputs
  const pages: Page[] = crawlOut.pages.map((p) => ({
    url: p.url,
    urlHash: p.urlHash,
    title: p.title,
    statusCode: p.statusCode,
    depth: depths.get(p.url) ?? null,
    inDegree: graph.hasNode(p.url) ? graph.inDegree(p.url) : 0,
    outDegree: graph.hasNode(p.url) ? graph.outDegree(p.url) : 0,
    isOrphan: filteredOrphans.includes(p.url),
  }));

  const links: Link[] = crawlOut.links.map((l) => ({
    fromUrl: l.fromUrl,
    toUrl: l.toUrl,
    anchorText: l.anchorText,
    isGenericAnchor: l.isGenericAnchor,
  }));

  const findings: Finding[] = [];
  for (const u of filteredOrphans) findings.push({ category: 'orphan', severity: 'critical', pageUrl: u });
  for (const [url, d] of depths.entries()) if (d > 3) findings.push({ category: 'deep_page', severity: 'medium', pageUrl: url, payload: { depth: d } });
  for (const p of pages) if (p.depth === null && !filteredOrphans.includes(p.url)) findings.push({ category: 'unreachable_page', severity: 'critical', pageUrl: p.url });
  for (const [url, hhi] of hhiMap.entries()) if (hhi > 0.5) findings.push({ category: 'over_optimized_anchor', severity: 'medium', pageUrl: url, payload: { hhi } });
  if (genericFrac > 0.2) findings.push({ category: 'generic_anchor_overuse', severity: 'minor', payload: { fraction: genericFrac } });

  void hashUrl;

  return {
    url: opts.url,
    cms: detection.cms,
    cmsConfidence: detection.confidence,
    cmsMetadata,
    pages,
    links,
    findings,
    score: grade.score,
    grade: grade.grade,
    breakdown: grade.breakdown,
    startedAt,
    completedAt: new Date(),
  };
}
