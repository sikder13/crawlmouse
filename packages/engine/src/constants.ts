/**
 * Scoring and finding thresholds, centralized so the product's grading contract
 * lives in one place. These literals were previously duplicated across grade.ts,
 * audit.ts and anchor.ts (e.g. the depth-3 cutoff and the 0.2 generic-anchor
 * threshold appeared in two files each), which made tuning error-prone.
 */

/** A page more than this many clicks from the homepage is considered "too deep". */
export const MAX_HEALTHY_DEPTH = 3;

/**
 * Inbound-anchor concentration (Herfindahl–Hirschman Index, 0..1) at or above
 * which a page is flagged for over-optimized / manipulative anchor text.
 */
export const ANCHOR_HHI_ALERT = 0.5;

/**
 * Site-wide fraction of generic ("click here", "read more") anchors above which
 * we both penalize the anchor-diversity score and emit a finding.
 */
export const GENERIC_ANCHOR_ALERT = 0.2;

/** Score penalty applied to anchor diversity once GENERIC_ANCHOR_ALERT is exceeded. */
export const GENERIC_ANCHOR_PENALTY = 0.2;

/** Weight of unreachable pages relative to too-deep pages within the depth score. */
export const UNREACHABLE_DEPTH_WEIGHT = 0.5;

/** Minimum inbound links before a page's anchor HHI is statistically meaningful. */
export const ANCHOR_MIN_SAMPLES = 3;

/**
 * Minimum crawled pages before the structural grade is trustworthy. Below this, a tiny
 * or broken crawl (e.g. a JS-rendered site, a failed crawl, or a 1-2 page brochure) does
 * not have enough of a link graph to certify — so we emit a `incomplete_crawl` finding and
 * cap the grade (A3). An empty/2-page crawl previously scored a confident 97-100 "A".
 */
export const MIN_COVERAGE_PAGES = 5;

/**
 * Ceiling applied to the score when coverage is below MIN_COVERAGE_PAGES. A ceiling, not a
 * floor: a thin crawl that also scores badly stays bad. 60 maps to "C" — "incomplete, can't
 * be certified higher" — and the accompanying finding explains why.
 */
export const LOW_CONFIDENCE_SCORE_CAP = 60;

/** Grade dimension weights. Must sum to 100. */
export const GRADE_WEIGHTS = {
  orphanRatio: 40,
  depth: 20,
  anchorDiversity: 20,
  structure: 20,
} as const;

/**
 * Crawl-health confidence thresholds (§6). Confidence is `low` when the crawl was too blocked or
 * reached too little of the discovered site to certify a grade; `medium` when it's borderline;
 * `high` otherwise. A `low`-confidence audit must never present as a confident verdict — that is
 * the "we crawled 412/500 — confidence: high" trust signal. block_rate = blocked / attempted;
 * coverage_pct = fetched_ok / discovered (both 0..1). The comparisons are strict `>` / `<`, so the
 * exact threshold value sits in the better bucket.
 */
export const BLOCK_RATE_LOW_CONFIDENCE = 0.15;
export const BLOCK_RATE_MEDIUM_CONFIDENCE = 0.05;
export const COVERAGE_LOW_CONFIDENCE = 0.7;
export const COVERAGE_MEDIUM_CONFIDENCE = 0.9;

/**
 * §2 confidence-band half-widths (± points on the 0..100 scale), keyed by crawl-health confidence.
 * They REPLACE the blunt `LOW_CONFIDENCE_SCORE_CAP` for low-confidence-but-substantial crawls: the
 * point estimate stays the real computed score and the band communicates uncertainty instead of
 * slamming a well-structured large site to C/60 (the §2 nginx A/91→C/60 evidence). high ±2 (coverage
 * ≥0.9, block ≤0.05 — measurement noise, reads as a verdict); medium ±5 (one sub-grade band —
 * `scoreToLetter`'s letter buckets are 5 pts wide); low ±12 (coverage <0.7 or block >0.15 — the
 * unseen ≥30% could genuinely move the grade, rendered "estimate, re-crawl recommended"). Bounds are
 * clamped to [0, 100]. The <5-page thin-crawl floor (A3) is unaffected — that cap stays in grade.ts.
 */
export const CONFIDENCE_BAND_HIGH = 2;
export const CONFIDENCE_BAND_MEDIUM = 5;
export const CONFIDENCE_BAND_LOW = 12;

/**
 * Polite, adaptive crawl (SPEC 01 §5, ENGINE_V2). AIMD = additive-increase /
 * multiplicative-decrease concurrency. Start gentle (2), ramp by 1 after a streak of clean
 * 200s, halve on any throttle (429/5xx). The ceiling is clamped to the caller's tier
 * `perHostConcurrency` so free crawls stay sequential (cost control #5) — see crawler.ts.
 */
export const AIMD_START_CONCURRENCY = 2; // initial parallelism
export const AIMD_MIN_CONCURRENCY = 1; // pool floor + halving floor (a fragile host → serial)
export const AIMD_CEILING_CONCURRENCY = 5; // ceiling before the tier clamp
export const AIMD_SUCCESS_STEP = 5; // consecutive 200s before a +1 step up

/** Crawlee retry budget for blocked requests (SPEC 01 §5 "3–4"). */
export const MAX_REQUEST_RETRIES = 4;
/**
 * Status codes treated as `blocked` → made retryable (Crawlee `additionalHttpErrorStatusCodes`,
 * which forces these to throw so they enter the retry+backoff path). 404/410 stay `dead`
 * (non-throwing, no block-retry); 5xx and network/timeout already throw by default.
 */
export const BLOCKED_RETRY_STATUS_CODES = [403, 429, 503] as const;

/**
 * Reactive backoff base (ms) for exponential full jitter on a throttle: delay = rand(0, base·2^n).
 * This is the §5 "750ms" — applied ONLY after a host pushes back, never as a steady-state
 * per-request delay (that would re-collapse single-host throughput and blow the crawl budget;
 * a healthy crawl runs with zero added delay). Robots `crawl-delay` and `Retry-After` are honored
 * as hard minimums on top of this.
 */
export const BACKOFF_BASE_MS = 750;
/** Absolute cap on any single backoff delay, so a hostile `Retry-After: 3600` can't stall a slot. */
export const MAX_BACKOFF_MS = 30_000;
/** Never delay to within this of the wall-clock deadline — the crawl stops gracefully instead. */
export const BACKOFF_BUDGET_SLACK_MS = 2_000;

/**
 * No-budget settlement floor (ms) for the v2 polite/deterministic crawl (SPEC 01 §5). The
 * deterministic-frontier path re-invokes `crawler.run()` per BFS level; with no usable wall-clock
 * budget it would take `runWithWallClock`'s no-deadline branch (no timer), so a single stalled upstream
 * socket (an origin that accepts but never responds) could leave a per-level `run()` pending forever and
 * the whole crawl never settles (Node exit 13 offline / a hung serverless function past maxDuration).
 * `runCrawl` clamps a non-positive/missing `maxCrawlMs` UP to this floor on the v2 path so `crawlDeadline`
 * is always finite and the per-level timer always arms. Mirrors `MIN_CRAWL_WALL_CLOCK_MS` (audit-config).
 * Prod always passes `crawlWallClockMs()` (≥30s) explicitly, so this is a safety net for tests / future
 * no-budget callers (e.g. the v1.2 CLI), never the prod path; a positive caller budget — even sub-floor —
 * is honored unchanged.
 */
export const V2_NO_BUDGET_FLOOR_MS = 30_000;

/**
 * Per-request navigation (fetch) timeout (secs), pinned EXPLICITLY to crawlee 3.16's own default so a
 * single stalled upstream socket is aborted instead of stalling a crawl level. Set symmetrically on the
 * v1 and v2 crawler configs. 30s is the value crawlee already used implicitly, so pinning it changes NO
 * page on any site (grade-neutral / v1 byte-identical) — its only effect is making the bound explicit so
 * a crawlee minor bump can't silently change it (PROJECT_OVERVIEW §11: crawlee is caret-pinned). 30s is
 * well above a normal page response and the ~10s per-page handler budget, so it clips only genuine
 * stalls, never a slow-but-completing page.
 */
export const NAVIGATION_TIMEOUT_SECS = 30;
