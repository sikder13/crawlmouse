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
import { canonicalizeUrl } from './url-canonical.js';
import { validateUrlOrThrow } from './ssrf-guard.js';
import { MAX_HEALTHY_DEPTH, ANCHOR_HHI_ALERT, GENERIC_ANCHOR_ALERT } from './constants.js';

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
  const isExcluded = (u: string) => adjust.excludeFromOrphans(u);
  const orphanResult = detectOrphans(graph, homepageUrl);
  const rawOrphanSet = new Set(orphanResult.orphans);
  const filteredOrphans = orphanResult.orphans.filter((u) => !isExcluded(u));
  const filteredOrphanSet = new Set(filteredOrphans);
  const orphanRatio = graph.order > 0 ? filteredOrphans.length / graph.order : 0;

  // Depth + reachability. Count "too deep" and "unreachable" only over pages that
  // actually count toward the score: skip CMS utility paths (/cart, /wp-admin)
  // entirely, and skip raw orphans from the unreachable tally because an orphan is
  // unreachable by definition and is already penalized via orphanRatio — counting
  // it in both dimensions would double-penalize the same defect.
  const depths = computeDepth(graph, homepageUrl);
  let beyond3 = 0;
  let unreachable = 0;
  for (const node of graph.nodes()) {
    if (isExcluded(node)) continue;
    const d = depths.get(node);
    if (d === undefined) {
      if (!rawOrphanSet.has(node)) unreachable += 1;
    } else if (d > MAX_HEALTHY_DEPTH) {
      beyond3 += 1;
    }
  }
  const denom = graph.order > 0 ? graph.order : 1;
  const pagesBeyondDepth3Fraction = beyond3 / denom;
  const unreachableFraction = unreachable / denom;

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
    isOrphan: filteredOrphanSet.has(p.url),
  }));

  const links: Link[] = crawlOut.links.map((l) => ({
    fromUrl: l.fromUrl,
    toUrl: l.toUrl,
    anchorText: l.anchorText,
    isGenericAnchor: l.isGenericAnchor,
  }));

  const findings: Finding[] = [];
  for (const u of filteredOrphans) findings.push({ category: 'orphan', severity: 'critical', pageUrl: u });
  for (const [url, d] of depths.entries())
    if (d > MAX_HEALTHY_DEPTH && !isExcluded(url))
      findings.push({ category: 'deep_page', severity: 'medium', pageUrl: url, payload: { depth: d } });
  // A raw orphan is already reported as 'orphan'; only flag pages unreachable for
  // some OTHER reason (e.g. reachable only via an orphan chain), and never a CMS
  // utility path — otherwise CMS-excluded orphans resurface as critical findings.
  for (const p of pages)
    if (p.depth === null && !rawOrphanSet.has(p.url) && !isExcluded(p.url))
      findings.push({ category: 'unreachable_page', severity: 'critical', pageUrl: p.url });
  for (const [url, hhi] of hhiMap.entries())
    if (hhi > ANCHOR_HHI_ALERT)
      findings.push({ category: 'over_optimized_anchor', severity: 'medium', pageUrl: url, payload: { hhi } });
  if (genericFrac > GENERIC_ANCHOR_ALERT)
    findings.push({ category: 'generic_anchor_overuse', severity: 'minor', payload: { fraction: genericFrac } });

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
