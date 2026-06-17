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
