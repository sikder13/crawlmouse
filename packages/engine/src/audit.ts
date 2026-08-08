import type { AuditOptions, AuditResult, Page, Link, Finding, CmsMetadata, CrawlHealth, ConfidenceBand, ProjectedGrade, FixPrescription, FreeFix, CrawlActivity, LlmsTxtStatus, AiReadinessScore } from '@crawlmouse/types';
import { runCrawl, type CrawlOutput } from './crawler.js';
import { buildGraph } from './graph.js';
import { deriveGradeInputs, gradeInputsFrom } from './grade-inputs.js';
import { decideRefusal } from './refusal.js';
import { computeCoverageAccounting } from './coverage.js';
import { looksJsRendered } from './analysis/js-detect.js';
import { sameHostIgnoringWww } from './extract.js';
import { computeGrade } from './grade.js';
import { computeCrawlHealth, classifyFetchOutcome } from './crawl-health.js';
import { computeConfidenceBand, estimateSiteTotal } from './confidence-band.js';
import { buildCorpus } from './projection/relevance.js';
import { enumerateFixes } from './projection/ledger.js';
import { buildConversionCore } from './projection/projection.js';
import { detectCms, type DetectionResult } from './cms-detection/index.js';
import { classifyPages } from './analysis/classify-pages.js';
import { getAdjustments } from './cms-adjustments/index.js';
import { discoverSitemaps, parseSitemapUrls } from './sitemap.js';
import { isUrlAllowed, type ParsedRobots } from './robots.js';
import { detectWaf, parseLlmsTxt, assembleAiReadiness, LLMS_TXT_MAX_BYTES, LLMS_TXT_FETCH_TIMEOUT_MS } from './analysis/ai-readiness/index.js';
import { canonicalizeUrl, type CanonicalizeOptions } from './url-canonical.js';
import { isCrawlTrap } from './crawl-traps.js';
import { validateUrlOrThrow } from './ssrf-guard.js';
import { safeFetch } from './safe-fetch.js';
import { homepageFetchTimeoutMs, crawlWallClockMs, engineV2Enabled, aiReadinessExtractionEnabled } from './audit-config.js';
import { MAX_HEALTHY_DEPTH, ANCHOR_HHI_ALERT, GENERIC_ANCHOR_ALERT, MIN_COVERAGE_PAGES, FREE_FIX_COUNT, LEDGER_LINKS_PER_FIX, LEDGER_MAX_FIXES } from './constants.js';

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
  /**
   * §2 count of distinct same-origin URLs the sitemap claimed (pre page-cap), or null when no usable
   * sitemap. Feeds the "based on N of ~M pages" site-total estimate. v2 metadata; absent on v1.
   */
  sitemapUrlCount?: number | null;
  /**
   * §7.2 — the same-origin URLs the sitemap DECLARED, for orphan triangulation. Null when there is no
   * usable sitemap; an empty array would claim a sitemap that declared nothing.
   */
  sitemapDeclaredUrls?: string[] | null;
  /**
   * §4.1 — sitemap-declared URLs the owner disallowed in robots.txt. Never fetched. Carried into the
   * pure half because §7's orphan triangulation must report "excluded by the owner" separately from
   * "declared but unreachable": the first is a choice and the second is a defect, and conflating them
   * turns an ordinary `Disallow: /cart` into a finding against the site.
   */
  robotsExcludedSitemapUrls?: string[];
  /**
   * SPEC 05 (Amendment §1) — network-half inputs the AI-readiness assembly needs, gathered ONLY in
   * `crawlForAudit` (the network half) so `analyzeCrawl` stays pure/network-free. `robots` = the already-
   * parsed robots (the access matrix reads it, zero new fetches); `wafDetected`/`wafNote` = disclosure-only
   * WAF from the homepage headers (never scored); `llmsTxt` = the ONE authorized new fetch (informational,
   * zero weight). All optional so the v1 path / non-AI callers are unaffected.
   */
  robots?: ParsedRobots | null;
  wafDetected?: boolean;
  wafNote?: string | null;
  llmsTxt?: LlmsTxtStatus;
}

/**
 * Crawl half of an audit: SSRF-checked homepage fetch, CMS detection, and the sitemap-seeded crawl.
 * `v2` (resolved by the caller) selects the §2 identity options + §5 polite/adaptive crawl + §3
 * deterministic seed truncation. Returns the raw crawl output plus the pure context `analyzeCrawl`
 * needs — kept separate so the backtest can grade one crawl output under both engines.
 */
/**
 * SPEC 04 §2 — best-effort activity emission from AuditOptions.onProgress. Swallows listener
 * errors; a no-op when the listener is absent, so the seam adds zero behavior (mutation-pinned).
 */
function progressEmitter(opts: AuditOptions): (a: CrawlActivity) => void {
  const listener = opts.onProgress;
  if (!listener) return () => {};
  return (a) => {
    try {
      listener(a);
    } catch {
      /* emission is best-effort; never let a listener break the audit */
    }
  };
}

export interface SitemapSeedOptions {
  /** Post-redirect canonical origin (scheme + host [+ port]) the audit is scoped to. */
  canonicalOrigin: string;
  /** Canonical homepage identity; always seeded, always first. */
  homepageUrl: string;
  /** Parsed robots.txt, or null when the site has none. */
  robots: ParsedRobots | null;
  /** The §2 identity options every URL in this audit is canonicalised under. */
  identityOpts: CanonicalizeOptions;
  /** v2 selects the §3 deterministic (canonical URL ASC) seed ordering. */
  v2: boolean;
  pageCap: number;
}

export interface SitemapSeedSelection {
  /** URLs to hand to the crawler, homepage first, capped. */
  seeds: string[];
  /** Distinct same-origin URLs the sitemap DECLARED, before robots, traps or the cap. */
  sitemapUrlCount: number;
  /**
   * §7.2 — the DECLARED URLs themselves, not just how many. Kept as a SET rather than a count because
   * the §7 accounting differences it against the owner's robots exclusions, and a count cannot be
   * differenced against anything. (The reachability difference that also consumed this set was D4,
   * cut from 5.1a — see coverage.ts.)
   */
  declaredUrls: string[];
  /** Same-origin sitemap URLs the owner disallowed — recorded, never fetched (§4.1). */
  robotsExcluded: string[];
}

/**
 * §4.1/§4.2/§4.4 — choose the crawl's sitemap seeds. Extracted from `crawlForAudit` and made PURE so
 * the admission rules can be pinned directly, which is what the E8 defect needed and did not have:
 * the rules lived inline in a network function and only the enqueue path was ever tested.
 *
 * THE DEFECT THIS REPLACES. Seeds went into `startUrls` with no robots check at all, so any
 * sitemap-listed URL the owner disallowed was fetched and graded. Measured in production: `Disallow:
 * /search` + `/cart` over a 419-page crawl dropped all 14 AI bots to 98% and emitted six spurious HIGH
 * findings — so it corrupted the diagnosis as well as the compliance story.
 *
 * The same-origin test was `c.startsWith(canonicalOrigin)` against an origin with no trailing slash,
 * so `https://a.com.evil.com/x` passed as same-origin and was handed to `crawler.run()`. It is now
 * host equality (with explicit www-equivalence) plus port and scheme, which fails that closed.
 *
 * ORDER IS LOAD-BEARING and is asserted by the tests: count what the sitemap DECLARED first, then
 * filter, then order, then cap. Counting after filtering would understate the site's size and quietly
 * flatter our own coverage ratio — the honest denominator is what the owner published, not what we
 * chose to visit.
 */
export function selectSitemapSeeds(collected: string[], opts: SitemapSeedOptions): SitemapSeedSelection {
  const { canonicalOrigin, homepageUrl, robots, identityOpts, v2, pageCap } = opts;
  const originUrl = new URL(canonicalOrigin);

  // Only seed same-origin URLs: sitemaps can legitimately list cross-subdomain URLs, but a v1.0 audit
  // is single-origin and a sitemap host is attacker-influenceable. Anything that will not canonicalise
  // (empty, malformed) is dropped here rather than throwing downstream.
  const sameOrigin: string[] = [];
  for (const u of collected) {
    let c: string;
    try {
      c = canonicalizeUrl(u, identityOpts);
    } catch {
      continue;
    }
    try {
      const candidate = new URL(c);
      if (!sameHostIgnoringWww(candidate, originUrl)) continue;
      if (candidate.port !== originUrl.port || candidate.protocol !== originUrl.protocol) continue;
    } catch {
      continue;
    }
    sameOrigin.push(c);
  }

  const declared = Array.from(new Set([homepageUrl, ...sameOrigin]));
  // Captured BEFORE any filter or cap, so "of ~M" reflects the whole sitemap (see the note above).
  const sitemapUrlCount = declared.length;

  const robotsExcluded: string[] = [];
  const admitted: string[] = [];
  for (const u of declared) {
    if (u === homepageUrl) continue; // the homepage is always seeded, and is re-added first below
    if (!isUrlAllowed(robots, u)) {
      robotsExcluded.push(u);
      continue;
    }
    if (isCrawlTrap(u).trapped) continue;
    admitted.push(u);
  }
  robotsExcluded.sort();

  // §3 deterministic seed truncation (v2): sort the non-homepage seeds (canonical URL ASC) before the
  // slice so the SAME cap selects the SAME subset run-to-run, independent of the sitemap's own
  // ordering. v1 keeps the legacy sitemap-order slice. NOTE this covers only the SEED frontier;
  // deterministic ordering of the LINK-discovered frontier is SPEC 5.1 §6.
  const ordered = v2 ? [...admitted].sort() : admitted;
  return { seeds: [homepageUrl, ...ordered].slice(0, pageCap), sitemapUrlCount, declaredUrls: declared, robotsExcluded };
}

export async function crawlForAudit(
  opts: AuditOptions,
  flags: InternalAuditFlags,
  v2: boolean,
): Promise<{ crawlOut: CrawlOutput; ctx: AnalysisContext }> {
  const emit = progressEmitter(opts);
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
  if (detection.cms !== 'custom') {
    emit({ kind: 'cms_detected', label: `Platform detected: ${detection.cms}` });
  }
  // SPEC 05 §3: WAF/CDN disclosure from the SAME homepage headers the CMS detector consumes (no new fetch).
  // Disclosure-only — never moves the score (§2). Gated on v2 AND the AI kill-switch: the switch must turn
  // OFF every SPEC 05 input-gathering path, not just the per-page extraction (see the llms.txt note below).
  const aiInputsEnabled = v2 && aiReadinessExtractionEnabled();
  const waf: { wafDetected: boolean; wafNote: string | null } = aiInputsEnabled ? detectWaf(headers) : { wafDetected: false, wafNote: null };

  // Sitemap discovery. The fetcher routes through safeFetch so attacker-controlled
  // robots `Sitemap:` / sitemap `<loc>` URLs cannot be used as an SSRF egress.
  const fetcher = async (u: string) => {
    const r = await safeFetch(u, { bypassSsrf });
    return { status: r.status, body: r.body };
  };
  // Discover from the post-redirect canonical origin (consistent with seed filtering below),
  // so robots/sitemap are read from the host the site actually resolved to.
  const discovered = await discoverSitemaps(canonicalOrigin, { fetcher });
  // SPEC 05 §8: the ONE authorized new fetch — llms.txt, through `safeFetch` (the SAME SSRF-guarded egress
  // as robots/sitemap), off the post-redirect canonical origin. SIZE-CAPPED (LLMS_TXT_MAX_BYTES) so a
  // hostile multi-MB body can't burn CPU (the parse is also scan-capped + linear). Informational, zero
  // weight; absence (404 / network error / cap / timeout) is normal.
  //
  // Gated on `aiInputsEnabled`, NOT on v2 alone: this is the only NEW network egress SPEC 05 adds, so the
  // AI kill-switch must be able to stop it. Gating it on v2 alone would mean the switch silences the
  // score while the extra per-audit request still fires in production — leaving ENGINE_V2=0 (which moves
  // every user's grade) as the only lever if this egress ever destabilises a crawl.
  //
  // Explicitly short timeout: this runs in the PRELUDE, which shares the ~40s of headroom left by the
  // 240s crawl budget under the 300s maxDuration. safeFetch's 10s default would let one tarpitting host
  // spend a quarter of that headroom on an informational, zero-weight file.
  let llmsTxt: LlmsTxtStatus = parseLlmsTxt(0, '');
  if (aiInputsEnabled) {
    try {
      const r = await safeFetch(`${canonicalOrigin}/llms.txt`, {
        bypassSsrf,
        maxBytes: LLMS_TXT_MAX_BYTES,
        timeoutMs: LLMS_TXT_FETCH_TIMEOUT_MS,
      });
      llmsTxt = parseLlmsTxt(r.status, r.body);
    } catch {
      llmsTxt = parseLlmsTxt(0, '');
    }
  }
  let seedUrls: string[];
  // §2: distinct same-origin URLs the sitemap lists (pre page-cap), for the honest site-total estimate.
  let sitemapUrlCount: number | null = null;
  // §4.1: sitemap URLs the owner disallowed. Never fetched, but RECORDED — §7's sitemap-delta needs to
  // tell "the owner excluded this" apart from "we failed to reach it", and they are opposite verdicts.
  let robotsExcludedSitemapUrls: string[] = [];
  let sitemapDeclaredUrls: string[] | null = null;
  if (discovered.sitemapUrls.length > 0) {
    const collected: string[] = [];
    for (const sm of discovered.sitemapUrls) {
      await parseSitemapUrls(sm, { fetcher }, 0, collected);
    }
    const selected = selectSitemapSeeds(collected, {
      canonicalOrigin,
      homepageUrl,
      robots: discovered.robots,
      identityOpts,
      v2,
      pageCap: opts.pageCap ?? 500,
    });
    seedUrls = selected.seeds;
    sitemapUrlCount = selected.sitemapUrlCount;
    robotsExcludedSitemapUrls = selected.robotsExcluded;
    sitemapDeclaredUrls = selected.declaredUrls;
    // Honest site-total signal: exactly what the sitemap listed (pre-cap), never inflated.
    emit({ kind: 'sitemap_seeded', label: `Sitemap found — ${sitemapUrlCount} URLs`, estimatedTotal: sitemapUrlCount });
  } else {
    seedUrls = [homepageUrl];
  }

  // Crawl
  emit({ kind: 'phase', label: 'Crawling your site', phase: 'crawling' });
  const crawlOut = await runCrawl({
    onActivity: opts.onProgress ? emit : undefined,
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
    // §3 / T4 deterministic (depth, url) crawl frontier: a site larger than the page cap yields the
    // SAME subset (hence the same grade) run-to-run. v2-only; v1 keeps the legacy FIFO enqueueLinks crawl.
    deterministicFrontier: v2,
    excludeCrossHost: v2,
    // Hard overall crawl deadline: under v2 a pathological/slow site stops GRACEFULLY (partial) at
    // this budget; under v1 it fails as a clean classified timeout (Issue 2b) instead of running
    // until the serverless function is killed at maxDuration. `maxCrawlMsForTesting` is a test seam.
    maxCrawlMs: flags.maxCrawlMsForTesting ?? crawlWallClockMs(),
  });

  return {
    crawlOut,
    ctx: {
      url: opts.url,
      homepageUrl,
      jsRendered,
      detection,
      cmsMetadata,
      startedAt,
      sitemapUrlCount,
      sitemapDeclaredUrls,
      robotsExcludedSitemapUrls,
      robots: discovered.robots ?? null,
      wafDetected: waf.wafDetected,
      wafNote: waf.wafNote,
      llmsTxt,
    },
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
  // SPEC 02 (§1 node-eligibility, extended): a cross-host fetched page — an off-site share/social URL
  // that slipped past the same-host enqueue and got recorded as a page — is NOT a page of the user's
  // site, so it must not become a gradeable node (it would be a false orphan that drags the grade and
  // pollutes the ledger). Exclude it the same way blocked/dead fetches are excluded, reusing the
  // SPEC 01 §2 canonical-host predicate. v2-only; v1 keeps every fetched URL as a node (prod unchanged).
  const sameHost = (u: string): boolean => {
    try {
      return sameHostIgnoringWww(new URL(u), new URL(homepageUrl));
    } catch {
      return false;
    }
  };
  const sitePages = v2 ? crawlOut.pages.filter((p) => sameHost(p.url)) : crawlOut.pages;
  const gradeablePages = v2 ? sitePages.filter((p) => p.statusCode === 200) : crawlOut.pages;
  const graph = buildGraph(gradeablePages, crawlOut.links);

  // §6 crawl-health (v2): how much of the site we reached and how blocked the crawl was, derived
  // from the crawl output (no crawler change). `discovered` = unique internal URLs seen (fetched
  // pages ∪ link targets); a page-cap-truncated site reports coverage < 1 and partial = true.
  // Computed BEFORE grading so a low-confidence crawl can cap the grade (§4/§6) and caveat it.
  let crawlHealth: CrawlHealth | undefined;
  if (v2) {
    const discoveredSet = new Set<string>();
    for (const p of sitePages) discoveredSet.add(p.url);
    for (const l of crawlOut.links) discoveredSet.add(l.toUrl);
    crawlHealth = computeCrawlHealth(sitePages, discoveredSet.size);
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
  // finding below. We CAVEAT, never SUPPRESS, the structural findings, because suppressing them
  // would lose real signal.
  //
  // ⚠ THIS COMMENT USED TO CLAIM "post node-eligibility the orphan/deep-page findings are
  // trustworthy". THAT IS FALSE UNDER A BUDGET CUT, and it is measured (gate 7 / B5). On a WordPress
  // shape with ZERO orphans by construction — sitemap declares the posts, the `/page/N` archives that
  // link them are undeclared, every post is linked from its archive — 5,501 pages grade **C/62.97
  // with 105 critical `orphan` findings at cap 500**, and **B/79.28 with 0 at cap 2000**. The
  // archives are what get cut, so their targets lose every inbound link and are reported as orphans
  // that do not exist. Sixteen grade points out of our own budget.
  //
  // This PRE-DATES 5.1a and is not made worse by it — stratification reaches hubs the old frontier
  // did not, and the refusal gate catches the worst cases — so it is not a 5.1a blocker. It is the
  // TOP 5.1b item: `docs/tickets/2026-08-07-orphan-under-cap.md`. Do not read the caveat above as a
  // claim that a capped crawl's orphan findings are sound.
  const lowConfidence = crawlHealth?.confidence === 'low';

  // SPEC 5.1a §5 — page classification, and the M9 population/graph split it feeds. The CMS profile is
  // consulted THROUGH the classifier (one entry point, not two overlapping rule sets), and
  // `classification.gradeable` becomes the single source of truth for the population, so the persisted
  // per-page flag can never drift from the rule the grade was actually computed over.
  const adjust = getAdjustments(detection.cms);
  const classifications = classifyPages(
    gradeablePages.map((p) => ({
      url: p.url,
      urlHash: p.urlHash,
      mainTextChars: p.classificationSignals?.mainTextChars,
      simhash: p.classificationSignals?.simhash ?? null,
      noindex: !!(p.classificationSignals?.metaNoindex || p.classificationSignals?.headerNoindex),
    })),
    { homepageUrl, isCmsExcluded: (u) => adjust.excludeFromOrphans(u) },
  );
  // Default TRUE for a URL the classifier never saw: a page missing from the map is a bug in our
  // bookkeeping, and the conservative failure is to keep grading it rather than to silently delete it
  // from the site.
  const isGradeable = (u: string) => classifications.get(u)?.gradeable ?? true;
  const isExcluded = (u: string) => !isGradeable(u);

  // §3 single source of truth for the graph → GradeInputs derivation. Extracted so the base grade
  // and the SPEC 02 projection re-grade run the IDENTICAL derivation (no marginal-delta drift); it
  // also returns the orphan/depth/rank/HHI intermediates the findings emission + the ledger reuse.
  const ga = deriveGradeInputs(graph, { homepageUrl, isGradeable, jsRendered });

  // Grade. Pass the count of SUCCESSFULLY-fetched pages so a thin OR errored crawl is capped
  // (A3): too little real content means too little of a link graph to certify a confident
  // grade. Counting only 2xx/3xx excludes both the statusCode-0 rows failedRequestHandler adds
  // (5xx / network failures) AND 4xx pages (kept by the normal handler with their real code),
  // so "homepage OK + N broken links" is correctly treated as incomplete.
  const pageCount = crawlOut.pages.filter((p) => p.statusCode >= 200 && p.statusCode < 400).length;
  const grade = computeGrade(gradeInputsFrom(ga, pageCount));

  // SPEC 5.1a Stage 4 — THE REFUSAL GATE, decided at the SOURCE.
  //
  // Withheld here rather than at each render, because a letter is carried by PAYLOAD BYTES long
  // before anything draws it: the SSE stream, the minted snapshot, the OG image, the CSV export and
  // the completed email all serialise this value independently. Gating thirteen surfaces by hand is
  // the same hand-synchronised-derivation class that made the projection disagree with the grade it
  // projects from, so there is ONE gate and everything downstream inherits a null.
  //
  // §7 — the site-size estimate is derived ONCE and shared. It previously ran twice (the refusal
  // gate's `estimateSource` and the confidence band), which is the same hand-synchronised-derivation
  // class this stage exists to remove: two calls agree until one of them is changed.
  const siteEstimate = crawlHealth ? estimateSiteTotal(crawlHealth, ctx.sitemapUrlCount ?? null) : null;

  // §7 COVERAGE ACCOUNTING (v2 only — v1 is the backtest's base engine, pinned byte-identical).
  //
  // Built from the SAME `ga.gradeableCount` every grade ratio divides by and the SAME `siteEstimate`
  // the band reports, so the coverage a user reads and the denominator the grade used cannot drift
  // apart.
  //
  const coverage = v2
    ? computeCoverageAccounting({
        fetchedCount: crawlOut.pages.length,
        gradeableCount: ga.gradeableCount,
        classifications: classifications.values(),
        sitemapDeclaredUrls: ctx.sitemapDeclaredUrls ?? null,
        robotsExcludedSitemapUrls: ctx.robotsExcludedSitemapUrls ?? [],
        estimate: siteEstimate ?? { estimatedTotal: null, method: 'none' },
      })
    : undefined;

  // v2 only: v1 is the backtest's base engine and is pinned byte-identical.
  const refusal = v2
    ? decideRefusal({
        gradeablePageCount: ga.gradeableCount,
        observedEdgeCount: ga.observedEdgeCount,
        // UNKNOWN IS NOT ZERO: no crawl-health means the crawl was never instrumented, which is not
        // evidence of a dead host and must not refuse.
        fetchedOkCount: crawlHealth ? crawlHealth.fetchedOk : null,
        // Σ`coverage.excluded` — NOT `coverage.fetched`. `fetched` counts every URL fetched at any
        // status including off-host, while `excluded` is tallied only over same-host-200 pages; feeding
        // the gate the first made the printed numbers irreconcilable and told a brochure with broken
        // links that we had excluded pages we never saw. `gradeable + excluded` is the population the
        // tally accounts for.
        excludedPageCount: coverage ? coverage.excluded.reduce((n, e) => n + e.count, 0) : null,
        crawlTruncated: crawlHealth ? crawlHealth.partial : null,
        estimateSource: siteEstimate ? siteEstimate.method : 'none',
      })
    : undefined;

  // §2 confidence band (v2 only): keep the real (uncapped) point estimate and communicate crawl
  // uncertainty as a band + an honest site-total estimate, instead of the old blunt C/60 cap. Built
  // from the already-computed crawl-health, so v1 (no crawlHealth) emits none — prod stays unchanged.
  let confidenceBand: ConfidenceBand | undefined;
  if (v2 && crawlHealth && siteEstimate) {
    confidenceBand = computeConfidenceBand(grade.score, grade.grade, crawlHealth, siteEstimate);
  }

  // §3-§5 conversion core (v2 & NOT jsRendered): the projected-grade ledger (the gap), every cure, and
  // the one free fix. Skipped on a JS-rendered site — its "orphans" are static-crawl false positives so
  // prescriptions would be bogus (the band still emits). The web layer gates which cures reach a viewer.
  let projectedGrade: ProjectedGrade | undefined;
  let prescriptions: FixPrescription[] | undefined;
  let freeFix: FreeFix | null | undefined;
  if (v2 && !jsRendered) {
    const corpus = buildCorpus(graph);
    const fixes = enumerateFixes(graph, ga, { homepageUrl, isExcluded, corpus, linksPerFix: LEDGER_LINKS_PER_FIX });
    const core = buildConversionCore({
      baseGraph: graph,
      current: { score: grade.score, grade: grade.grade },
      analysisOpts: { homepageUrl, isGradeable, jsRendered },
      pageCount,
      corpus,
      fixes,
      freeFixCount: FREE_FIX_COUNT,
      maxFixes: LEDGER_MAX_FIXES,
    });
    projectedGrade = core.projectedGrade;
    prescriptions = core.prescriptions;
    freeFix = core.freeFix;
  }

  // Build outputs. §1/§7 (v2): the gradeable node set (200-only graph input) is the single source
  // of truth for excluded_from_grade, so the persisted page flag can never drift from the eligibility
  // rule the grade was actually computed over. Null on v1 -> the two fields are omitted (see below).
  const gradeableUrlSet = v2 ? new Set(gradeablePages.map((p) => p.url)) : null;
  const pages: Page[] = crawlOut.pages.map((p) => ({
    url: p.url,
    urlHash: p.urlHash,
    title: p.title,
    statusCode: p.statusCode,
    depth: ga.depths.get(p.url) ?? null,
    inDegree: graph.hasNode(p.url) ? graph.inDegree(p.url) : 0,
    outDegree: graph.hasNode(p.url) ? graph.outDegree(p.url) : 0,
    // A4: never mark a page an orphan on a JS-rendered site — the missing inbound links are
    // an artifact of static crawling, not a real defect.
    isOrphan: jsRendered ? false : ga.filteredOrphanSet.has(p.url),
    // §1/§7 (v2 only; omitted on v1 so the persisted columns stay NULL/default and prod is unchanged
    // until the ENGINE_V2 flip): per-page fetch outcome + whether the page was excluded from the grade.
    ...(gradeableUrlSet
      ? {
          fetchOutcome: classifyFetchOutcome(p.statusCode),
          excludedFromGrade: !gradeableUrlSet.has(p.url),
          // SPEC 02 v1.2: expose the already-computed internal PageRank per node for the live graph
          // (raw 0..1; 0 for a non-graph page). v2-only, so v1 rows stay byte-identical.
          pagerank: ga.ranks.get(p.url) ?? 0,
          // SPEC 05 §4: carry the per-page AI-legibility signals (computed in extractPage) onto the
          // output page for persistence + the What-AI-Sees view. Additive observation — never affects
          // the grade. v2-only (same gate as the fields above) so v1 rows stay byte-identical.
          aiSignals: p.aiSignals,
          // SPEC 5.1a §5: the classification the grade was actually computed over. Persisted so §7.3
          // can surface exclusions ("we excluded 412 tag archives") rather than silently shrinking the
          // denominator behind the user's back.
          classification: classifications.get(p.url),
        }
      : {}),
  }));

  const links: Link[] = crawlOut.links.map((l) => ({
    fromUrl: l.fromUrl,
    toUrl: l.toUrl,
    anchorText: l.anchorText,
    isGenericAnchor: l.isGenericAnchor,
  }));

  const findings: Finding[] = [];
  // D4 — THE SITEMAP DELTA WAS EMITTED HERE, FIRST, AND IS CUT FROM 5.1a. Its count was a function of
  // our own page cap (see coverage.ts), so it led the findings at critical severity with a claim about
  // the site that measured our crawl budget. 5.1b inherits it with the constraint it must satisfy.
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
    for (const u of ga.filteredOrphans) findings.push({ category: 'orphan', severity: 'critical', pageUrl: u });
  }
  for (const [url, d] of ga.depths.entries())
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
      if (p.depth === null && !ga.rawOrphanSet.has(p.url) && !isExcluded(p.url))
        findings.push({ category: 'unreachable_page', severity: 'critical', pageUrl: p.url });
  }
  for (const [url, hhi] of ga.hhiMap.entries())
    if (hhi > ANCHOR_HHI_ALERT)
      findings.push({ category: 'over_optimized_anchor', severity: 'medium', pageUrl: url, payload: { hhi } });
  if (ga.genericAnchorFraction > GENERIC_ANCHOR_ALERT)
    findings.push({ category: 'generic_anchor_overuse', severity: 'minor', payload: { fraction: ga.genericAnchorFraction } });

  // SPEC 05 §7: assemble the sibling AI-readiness score. v2-only, but NOT gated on jsRendered — the score
  // MUST compute on a JS-rendered site (on a depth-only retrieval basis; that is the site that most needs
  // the JS-blind message). Amendment §2 null-assembly rule: when NO eligible page carries signals
  // (extraction disabled or every page's extraction degraded), the result is null → the feature is hidden
  // end-to-end (never a score over missing signals). Additive: the grade above is untouched.
  let aiReadiness: AiReadinessScore | undefined;
  if (v2) {
    const eligible = pages
      .filter((p) => !p.excludedFromGrade && p.aiSignals)
      .map((p) => ({ url: p.url, title: p.title ?? null, aiSignals: p.aiSignals! }));
    const assembled =
      eligible.length === 0
        ? null
        : assembleAiReadiness({
            pages: eligible,
            depths: ga.depths,
            orphanSet: ga.filteredOrphanSet,
            jsRendered,
            robots: ctx.robots ?? null,
            wafDetected: ctx.wafDetected ?? false,
            wafNote: ctx.wafNote ?? null,
            llmsTxt: ctx.llmsTxt ?? parseLlmsTxt(0, ''),
            confidence: crawlHealth?.confidence ?? 'high',
            partial: crawlHealth?.partial ?? false,
            homepageUrl,
          });
    aiReadiness = assembled ?? undefined;
  }

  return {
    url,
    // §6.7 — carried straight through from the crawl half. It is computed in `crawler.ts` and was
    // dropped here until 2026-08-08, which is why no audit ever persisted one.
    ...(crawlOut.fingerprint ? { fingerprint: crawlOut.fingerprint } : {}),
    cms: detection.cms,
    cmsConfidence: detection.confidence,
    cmsMetadata,
    pages,
    links,
    findings,
    // A refused audit carries NO letter and NO score — an absence, never an F. `breakdown` stays:
    // the components are already ceilinged by the absence-of-evidence rule and they are the
    // evidence the user is shown INSTEAD of a verdict.
    score: refusal?.refused ? null : grade.score,
    grade: refusal?.refused ? null : grade.grade,
    breakdown: grade.breakdown,
    refusal,
    crawlHealth,
    // §7 — coverage accounting SURVIVES a refusal, deliberately. It is evidence about what we read,
    // not a verdict about the site, and on a refused audit it is most of what we have to offer.
    coverage,
    // EVERY STRUCTURE THAT PRESUPPOSES A SCORE GOES WITH IT. Nulling `score`/`grade` alone does NOT
    // stop a refused audit asserting a verdict: `confidenceBand` carries the point estimate and its
    // band, and `projectedGrade` carries both a current AND a projected letter. Caught by a test that
    // compared the band's point against the score and found 41.42 next to null — the leak was already
    // in the payload while the headline field was empty, which is precisely why this is gated on the
    // SERIALISED result rather than at each render.
    //
    // `prescriptions` and `freeFix` go too: a projected gain in points is incoherent without a score to
    // gain them from. What SURVIVES is the evidence — findings, the ceilinged breakdown, crawl-health,
    // pages and links — plus `aiReadiness`, which is a sibling score with its own independent evidence
    // and was never blended into the linking letter.
    confidenceBand: refusal?.refused ? undefined : confidenceBand,
    projectedGrade: refusal?.refused ? undefined : projectedGrade,
    prescriptions: refusal?.refused ? undefined : prescriptions,
    freeFix: refusal?.refused ? undefined : freeFix,
    aiReadiness,
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
  // SPEC 04 §2: a real phase transition — the crawl is done, the (fast, pure) analysis begins.
  progressEmitter(opts)({ kind: 'phase', label: 'Analyzing your link graph', phase: 'analyzing' });
  return analyzeCrawl(crawlOut, ctx, v2);
}
