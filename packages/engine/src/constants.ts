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
