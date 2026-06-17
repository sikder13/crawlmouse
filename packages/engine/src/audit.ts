import type { AuditOptions, AuditResult, Page, Link, Finding, CmsMetadata } from '@crawlmouse/types';
import { runCrawl } from './crawler.js';
import { buildGraph } from './graph.js';
import { detectOrphans } from './analysis/orphans.js';
import { computeDepth } from './analysis/depth.js';
import { perTargetHHI, genericAnchorFraction } from './analysis/anchor.js';
import { computePageRank } from './analysis/pagerank.js';
import { hubConcentrationScore, hubReachabilityScore } from './analysis/structure.js';
import { looksJsRendered } from './analysis/js-detect.js';
import { computeGrade } from './grade.js';
import { detectCms } from './cms-detection/index.js';
import { getAdjustments } from './cms-adjustments/index.js';
import { discoverSitemaps, parseSitemapUrls } from './sitemap.js';
import { canonicalizeUrl } from './url-canonical.js';
import { validateUrlOrThrow } from './ssrf-guard.js';
import { safeFetch } from './safe-fetch.js';
import { homepageFetchTimeoutMs, crawlWallClockMs, engineV2Enabled } from './audit-config.js';
import { MAX_HEALTHY_DEPTH, ANCHOR_HHI_ALERT, GENERIC_ANCHOR_ALERT, MIN_COVERAGE_PAGES } from './constants.js';

export interface InternalAuditFlags {
  allowPrivateIpsForTesting?: boolean;
  /**
   * Force the engine-v2 path (SPEC 01 §1 node-eligibility + retired unreachable_page) on or
   * off, overriding the `ENGINE_V2` env flag. For tests that exercise the v2 contract without
   * mutating the process env; prod resolves the flag from the environment.
   */
  engineV2?: boolean;
}

export async function runAudit(opts: AuditOptions, flags: InternalAuditFlags = {}): Promise<AuditResult> {
  const startedAt = new Date();
  const origin = new URL(opts.url).origin;
  const initialHomepageUrl = canonicalizeUrl(origin);

  const bypassSsrf = !!flags.allowPrivateIpsForTesting;
  // §1 node-eligibility cutover. v2 = blocked/dead fetches are crawl outcomes, not gradeable
  // nodes (kills the §0 false-orphan/unreachable bug). Off by default until the backtest flip.
  const v2 = flags.engineV2 ?? engineV2Enabled();

  // Validate the homepage URL against SSRF before fetching. safeFetch re-validates
  // and pins the connection on top of this; the explicit check keeps the early
  // error message clear. The test/internal flag bypasses for loopback fixtures only.
  if (!bypassSsrf) {
    await validateUrlOrThrow(initialHomepageUrl);
  }
  // Fetch homepage HTML for CMS detection (also seeds the crawl). safeFetch routes
  // through the SSRF guard, follows redirects safely, caps the body and handles gzip.
  // This is the FIRST network call and gates the whole run (it precedes Crawlee), so give it
  // the env-tunable homepage budget (default 15s) instead of safeFetch's generic per-page 10s
  // default — a momentarily-slow homepage must not fail the entire audit as a timeout (Issue 2).
  const homepageRes = await safeFetch(initialHomepageUrl, { bypassSsrf, timeoutMs: homepageFetchTimeoutMs() });

  // The homepage's ACTUAL scheme after any redirect. Every crawled identity is pinned to
  // it (A1b) so a site that downgrades deep paths https->http produces one identity per
  // page, not two — otherwise the in-degree graph splits and real pages look orphaned.
  const canonicalScheme = new URL(homepageRes.finalUrl).protocol;
  const canonicalOrigin = new URL(homepageRes.finalUrl).origin;
  const homepageUrl = canonicalizeUrl(homepageRes.finalUrl, { forceScheme: canonicalScheme });
  const html = homepageRes.body;

  // A4 JS/SPA false-orphan FLOOR. The crawler reads STATIC HTML only (CheerioCrawler does
  // not run JavaScript), so a client-rendered SPA returns a near-empty shell with no links,
  // and every real page comes back looking like a critical orphan — a trust-killer. When the
  // homepage looks JS-rendered we keep the rest of the analysis but SUPPRESS the orphan
  // signal: orphanRatio is forced to 0 for the grade, no orphan/unreachable findings are
  // emitted, no page is marked isOrphan, and we lead with one honest `js_rendered` banner so
  // the user understands why orphan detection was withheld. This is a v1.0 floor; rendering
  // the page (Playwright) to see the real link graph is a later upgrade.
  const jsRendered = looksJsRendered(html);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(homepageRes.headers)) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
    else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ');
  }
  const detection = detectCms(html, headers);
  const cmsMetadata: CmsMetadata = {};

  // Sitemap discovery. The fetcher routes through safeFetch so attacker-controlled
  // robots `Sitemap:` / sitemap `<loc>` URLs cannot be used as an SSRF egress.
  const fetcher = async (u: string) => {
    const r = await safeFetch(u, { bypassSsrf });
    return { status: r.status, body: r.body };
  };
  const safeCanonicalize = (u: string): string | null => {
    try {
      return canonicalizeUrl(u, { forceScheme: canonicalScheme });
    } catch {
      return null;
    }
  };
  // Discover from the post-redirect canonical origin (consistent with seed filtering below),
  // so robots/sitemap are read from the host the site actually resolved to.
  const discovered = await discoverSitemaps(canonicalOrigin, { fetcher });
  let seedUrls: string[];
  if (discovered.sitemapUrls.length > 0) {
    const collected: string[] = [];
    for (const sm of discovered.sitemapUrls) {
      await parseSitemapUrls(sm, { fetcher }, 0, collected);
    }
    // Only seed same-origin URLs: sitemaps can legitimately list cross-subdomain
    // URLs, but a v1.0 audit is single-origin and a sitemap host is attacker-
    // influenceable. Skip anything that won't canonicalize (e.g. empty/malformed).
    const sameOrigin: string[] = [];
    for (const u of collected) {
      const c = safeCanonicalize(u);
      if (c && c.startsWith(canonicalOrigin)) sameOrigin.push(c);
    }
    const uniqueSeeds = Array.from(new Set([homepageUrl, ...sameOrigin]));
    // §3 deterministic seed truncation (v2): when the sitemap lists more URLs than the page cap,
    // sort the non-homepage seeds (canonicalUrl ASC) before the slice so the SAME cap selects the
    // SAME subset run-to-run, independent of the sitemap's own ordering. The homepage stays first
    // (always seeded). v1 keeps the legacy sitemap-order slice. NOTE this covers only the SEED
    // frontier; deterministic ordering of the LINK-discovered crawl frontier is a separate,
    // higher-risk crawler change tracked with T4.
    const orderedSeeds = v2
      ? [homepageUrl, ...uniqueSeeds.filter((u) => u !== homepageUrl).sort()]
      : uniqueSeeds;
    seedUrls = orderedSeeds.slice(0, opts.pageCap ?? 500);
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
    robots: discovered.robots ?? undefined,
    canonicalScheme,
    // Hard overall crawl deadline (Issue 2b): a pathological site fails as a clean classified
    // timeout instead of running until the serverless function is killed at maxDuration.
    maxCrawlMs: crawlWallClockMs(),
  });

  // Build graph. §1 node-eligibility (v2): only `ok` (HTTP 200) fetches become gradeable
  // nodes. Blocked/dead fetches — 4xx kept by the request handler with their real code, plus
  // the statusCode-0 rows failedRequestHandler adds for 5xx/network/timeout — are crawl
  // outcomes, never nodes, so a throttled fetch can no longer be flagged a false orphan/
  // unreachable or dilute the grade denominator (the §0 bug). Edges to/from an excluded URL
  // drop automatically in buildGraph (it skips edges whose endpoints aren't nodes). v1 (flag
  // off) keeps the legacy "every fetched URL is a node" behavior until the backtest flip.
  const gradeablePages = v2 ? crawlOut.pages.filter((p) => p.statusCode === 200) : crawlOut.pages;
  const graph = buildGraph(gradeablePages, crawlOut.links);

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

  // PageRank + structure (A5). Structure rewards a healthy authority topology: PageRank
  // concentrated on a small hub tier, and those hubs reachable from the homepage within
  // the healthy click budget. This replaces the old `giniCoefficient`-based structure
  // score, which scored a flat (hub-less) PageRank spread as good — backwards.
  const ranks = computePageRank(graph);
  const hubConcentration = hubConcentrationScore(ranks);
  const hubReachability = hubReachabilityScore(ranks, depths, MAX_HEALTHY_DEPTH);

  // Grade. Pass the count of SUCCESSFULLY-fetched pages so a thin OR errored crawl is capped
  // (A3): too little real content means too little of a link graph to certify a confident
  // grade. Counting only 2xx/3xx excludes both the statusCode-0 rows failedRequestHandler adds
  // (5xx / network failures) AND 4xx pages (kept by the normal handler with their real code),
  // so "homepage OK + N broken links" is correctly treated as incomplete.
  const pageCount = crawlOut.pages.filter((p) => p.statusCode >= 200 && p.statusCode < 400).length;
  // A4: on a JS-rendered homepage the static crawl can't see the real link graph, so the
  // measured orphanRatio is a false positive. Feed the grade a 0 orphan ratio so suppressed
  // orphans don't drag the score; depth/anchor/structure are left unchanged.
  const orphanRatioForGrade = jsRendered ? 0 : orphanRatio;
  const grade = computeGrade({
    orphanRatio: orphanRatioForGrade,
    pagesBeyondDepth3Fraction,
    unreachableFraction,
    meanAnchorHHI: meanHHI,
    genericAnchorFraction: genericFrac,
    hubConcentration,
    hubReachability,
    pageCount,
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
    // A4: never mark a page an orphan on a JS-rendered site — the missing inbound links are
    // an artifact of static crawling, not a real defect.
    isOrphan: jsRendered ? false : filteredOrphanSet.has(p.url),
  }));

  const links: Link[] = crawlOut.links.map((l) => ({
    fromUrl: l.fromUrl,
    toUrl: l.toUrl,
    anchorText: l.anchorText,
    isGenericAnchor: l.isGenericAnchor,
  }));

  const findings: Finding[] = [];
  // A4: lead with the honest JS-rendering banner so the user reads the rest in context —
  // we tell them orphan detection was withheld because the page renders its links with
  // JavaScript and the v1.0 crawler only sees static HTML. Medium severity: it's an
  // important caveat about the verdict, not a defect on the user's site.
  if (jsRendered) {
    findings.push({ category: 'js_rendered', severity: 'medium' });
  }
  // A3: when coverage is below the floor, lead with an honest "incomplete crawl" finding so
  // the (capped) grade is read as provisional, not as a confident verdict on a tiny graph.
  if (pageCount < MIN_COVERAGE_PAGES) {
    findings.push({
      category: 'incomplete_crawl',
      severity: 'medium',
      payload: { pagesFetched: pageCount, minPages: MIN_COVERAGE_PAGES },
    });
  }
  // A4: suppress orphan + unreachable findings entirely on a JS-rendered site — every such
  // finding would be a false positive (the static crawl never saw the client-built links).
  if (!jsRendered) {
    for (const u of filteredOrphans) findings.push({ category: 'orphan', severity: 'critical', pageUrl: u });
  }
  for (const [url, d] of depths.entries())
    if (d > MAX_HEALTHY_DEPTH && !isExcluded(url))
      findings.push({ category: 'deep_page', severity: 'medium', pageUrl: url, payload: { depth: d } });
  // `unreachable_page` is RETIRED in v2 (SPEC 01 §3): the only legitimate case (a 200 node with
  // no inbound internal links) is already an `orphan`, and the old null-BFS-depth signal was the
  // §0 bug's primary symptom — a blocked intermediate fetch left real pages with null depth and
  // manufactured a critical finding. v2 emits none (the FindingCategory enum keeps the value so
  // historical rows still render). v1 (flag off) preserves the legacy emission: a raw orphan is
  // already reported as 'orphan', so only flag pages unreachable for some OTHER reason, never a
  // CMS utility path, and skip wholesale on a JS-rendered site (A4).
  if (!jsRendered && !v2) {
    for (const p of pages)
      if (p.depth === null && !rawOrphanSet.has(p.url) && !isExcluded(p.url))
        findings.push({ category: 'unreachable_page', severity: 'critical', pageUrl: p.url });
  }
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
