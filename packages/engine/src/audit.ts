import type { AuditOptions, AuditResult, Page, Link, Finding, CmsMetadata, CrawlHealth } from '@crawlmouse/types';
import { runCrawl, type CrawlOutput } from './crawler.js';
import { buildGraph } from './graph.js';
import { detectOrphans } from './analysis/orphans.js';
import { computeDepth } from './analysis/depth.js';
import { perTargetHHI, genericAnchorFraction } from './analysis/anchor.js';
import { computePageRank } from './analysis/pagerank.js';
import { hubConcentrationScore, hubReachabilityScore } from './analysis/structure.js';
import { looksJsRendered } from './analysis/js-detect.js';
import { computeGrade } from './grade.js';
import { computeCrawlHealth, classifyFetchOutcome } from './crawl-health.js';
import { detectCms, type DetectionResult } from './cms-detection/index.js';
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
  /**
   * Test-only override of the crawl wall-clock budget (ms), bypassing `crawlWallClockMs()` and its
   * 30s clamp floor. Lets a test drive the §5 budget-exhaustion path (graceful partial under v2,
   * timeout-throw under v1) in ~1s. Mirrors `allowPrivateIpsForTesting`; never set in prod.
   */
  maxCrawlMsForTesting?: number;
}

/**
 * Pure (network-free) inputs the grading half of an audit needs from the crawl half. Produced by
 * `crawlForAudit`, consumed by `analyzeCrawl`. This seam is what lets the backtest harness "crawl
 * once, grade twice" (SPEC 01 v2 §8): one crawl output graded under both v1 and v2 so a grade delta
 * is attributable to the engine, not crawl-to-crawl drift.
 */
export interface AnalysisContext {
  /** Originally-requested URL, echoed to AuditResult.url. */
  url: string;
  /** Canonical homepage identity — the BFS root for depth and the orphan seed. */
  homepageUrl: string;
  /** A4 JS/SPA homepage detection (suppresses false orphans on client-rendered shells). */
  jsRendered: boolean;
  detection: DetectionResult;
  cmsMetadata: CmsMetadata;
  startedAt: Date;
}

/**
 * Crawl half of an audit: SSRF-checked homepage fetch, CMS detection, and the sitemap-seeded crawl.
 * `v2` (resolved by the caller) selects the §2 identity options + §5 polite/adaptive crawl + §3
 * deterministic seed truncation. Returns the raw crawl output plus the pure context `analyzeCrawl`
 * needs — kept separate so the backtest can grade one crawl output under both engines.
 */
export async function crawlForAudit(
  opts: AuditOptions,
  flags: InternalAuditFlags,
  v2: boolean,
): Promise<{ crawlOut: CrawlOutput; ctx: AnalysisContext }> {
  const startedAt = new Date();
  const origin = new URL(opts.url).origin;
  const initialHomepageUrl = canonicalizeUrl(origin);

  const bypassSsrf = !!flags.allowPrivateIpsForTesting;

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
  const canonicalHost = new URL(homepageRes.finalUrl).hostname;
  // §2 identity options: pin the scheme (A1b) and, under v2, also strip tracking params and unify
  // www/non-www to the homepage's RESOLVED host. Shared by the homepage, the sitemap seeds, and the
  // crawler's stored identities so they all dedupe identically. (rel=canonical is applied per-page
  // in the crawler from each page's own <link rel="canonical">.)
  const identityOpts = {
    forceScheme: canonicalScheme,
    stripTrackingParams: v2,
    unifyHost: v2 ? canonicalHost : undefined,
  };
  const homepageUrl = canonicalizeUrl(homepageRes.finalUrl, identityOpts);
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
      return canonicalizeUrl(u, identityOpts);
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
    stripTrackingParams: v2,
    unifyHost: v2 ? canonicalHost : undefined,
    respectRelCanonical: v2,
    // §5 polite, adaptive crawl (robots crawl-delay + Retry-After floors, AIMD concurrency,
    // graceful-partial-on-budget). v2-only; v1 keeps the static-concurrency, throw-on-budget crawl.
    politeCrawl: v2,
    // Hard overall crawl deadline: under v2 a pathological/slow site stops GRACEFULLY (partial) at
    // this budget; under v1 it fails as a clean classified timeout (Issue 2b) instead of running
    // until the serverless function is killed at maxDuration. `maxCrawlMsForTesting` is a test seam.
    maxCrawlMs: flags.maxCrawlMsForTesting ?? crawlWallClockMs(),
  });

  return {
    crawlOut,
    ctx: { url: opts.url, homepageUrl, jsRendered, detection, cmsMetadata, startedAt },
  };
}

/**
 * Grading half of an audit: builds the link graph from a crawl output and computes the grade,
 * crawl-health and findings. PURE — no network — so the backtest can run it twice (v1 and v2) over a
 * single crawl output (SPEC 01 v2 §8). `v2` selects node-eligibility (§1: 200-only graph) + retired
 * `unreachable_page` (§3) + crawl-health/confidence (§6); v1 keeps the legacy "every fetched URL is a
 * node" behavior. Apart from the `v2`/`ctx` plumbing, every line below is the pre-split runAudit.
 */
export function analyzeCrawl(crawlOut: CrawlOutput, ctx: AnalysisContext, v2: boolean): AuditResult {
  const { url, homepageUrl, jsRendered, detection, cmsMetadata, startedAt } = ctx;

  // Build graph. §1 node-eligibility (v2): only `ok` (HTTP 200) fetches become gradeable
  // nodes. Blocked/dead fetches — 4xx kept by the request handler with their real code, plus
  // the statusCode-0 rows failedRequestHandler adds for 5xx/network/timeout — are crawl
  // outcomes, never nodes, so a throttled fetch can no longer be flagged a false orphan/
  // unreachable or dilute the grade denominator (the §0 bug). Edges to/from an excluded URL
  // drop automatically in buildGraph (it skips edges whose endpoints aren't nodes). v1 (flag
  // off) keeps the legacy "every fetched URL is a node" behavior until the backtest flip.
  const gradeablePages = v2 ? crawlOut.pages.filter((p) => p.statusCode === 200) : crawlOut.pages;
  const graph = buildGraph(gradeablePages, crawlOut.links);

  // §6 crawl-health (v2): how much of the site we reached and how blocked the crawl was, derived
  // from the crawl output (no crawler change). `discovered` = unique internal URLs seen (fetched
  // pages ∪ link targets); a page-cap-truncated site reports coverage < 1 and partial = true.
  // Computed BEFORE grading so a low-confidence crawl can cap the grade (§4/§6) and caveat it.
  let crawlHealth: CrawlHealth | undefined;
  if (v2) {
    const discoveredSet = new Set<string>();
    for (const p of crawlOut.pages) discoveredSet.add(p.url);
    for (const l of crawlOut.links) discoveredSet.add(l.toUrl);
    crawlHealth = computeCrawlHealth(crawlOut.pages, discoveredSet.size);
    // §5/§6: a crawl cut short by the wall-clock budget is INCOMPLETE — and coverage alone can't see
    // it. A deep link chain (A→B→C…) is fetched in order, so the un-crawled tail is never even
    // DISCOVERED and coverage (fetchedOk/discovered) looks ~1.0. Such a crawl must NEVER be certified a
    // confident grade (§6; reproducibility/trust is conversion prerequisite #1), so force it to low
    // confidence + partial — which both caps the score (computeGrade) and emits the incomplete_crawl
    // caveat below. (A budget hit means we genuinely could not finish; "estimate, re-audit" is honest.)
    if (crawlOut.budgetExhausted) {
      crawlHealth.partial = true;
      crawlHealth.confidence = 'low';
    }
  }
  // §6 grade-gating (v2): a low-confidence crawl (heavily blocked / poorly reached) must not be
  // certified a confident grade — it drives both the score cap (computeGrade) and the caveat
  // finding below. We CAVEAT, never SUPPRESS, the structural findings: post node-eligibility the
  // orphan/deep-page findings are trustworthy, so hiding them would lose real signal.
  const lowConfidence = crawlHealth?.confidence === 'low';

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
    lowConfidence,
  });

  // Build outputs. §1/§7 (v2): the gradeable node set (200-only graph input) is the single source
  // of truth for excluded_from_grade, so the persisted page flag can never drift from the eligibility
  // rule the grade was actually computed over. Null on v1 -> the two fields are omitted (see below).
  const gradeableUrlSet = v2 ? new Set(gradeablePages.map((p) => p.url)) : null;
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
    // §1/§7 (v2 only; omitted on v1 so the persisted columns stay NULL/default and prod is unchanged
    // until the ENGINE_V2 flip): per-page fetch outcome + whether the page was excluded from the grade.
    ...(gradeableUrlSet
      ? { fetchOutcome: classifyFetchOutcome(p.statusCode), excludedFromGrade: !gradeableUrlSet.has(p.url) }
      : {}),
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
  if (pageCount < MIN_COVERAGE_PAGES || lowConfidence) {
    findings.push({
      category: 'incomplete_crawl',
      severity: 'medium',
      payload: {
        pagesFetched: pageCount,
        minPages: MIN_COVERAGE_PAGES,
        // v2: surface WHY the grade is capped/provisional (thin crawl vs. blocked/low-coverage).
        ...(crawlHealth
          ? { confidence: crawlHealth.confidence, blockRate: crawlHealth.blockRate, coveragePct: crawlHealth.coveragePct }
          : {}),
      },
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
    url,
    cms: detection.cms,
    cmsConfidence: detection.confidence,
    cmsMetadata,
    pages,
    links,
    findings,
    score: grade.score,
    grade: grade.grade,
    breakdown: grade.breakdown,
    crawlHealth,
    startedAt,
    completedAt: new Date(),
  };
}

/**
 * Full audit = crawl once, then grade. The `ENGINE_V2` cutover flag (SPEC 01 §8; default off until the
 * backtest gate flips it) is resolved once and passed to BOTH halves so a single audit is internally
 * consistent. Behavior is identical to the pre-split implementation. Tests force the path via
 * `flags.engineV2`; prod reads `engineV2Enabled()`.
 */
export async function runAudit(opts: AuditOptions, flags: InternalAuditFlags = {}): Promise<AuditResult> {
  const v2 = flags.engineV2 ?? engineV2Enabled();
  const { crawlOut, ctx } = await crawlForAudit(opts, flags, v2);
  return analyzeCrawl(crawlOut, ctx, v2);
}
