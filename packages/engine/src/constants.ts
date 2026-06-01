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

/** Minimum inbound links before a page's anchor HHI is statistically meaningful. */
export const ANCHOR_MIN_SAMPLES = 3;

/** Grade dimension weights. Must sum to 100. */
export const GRADE_WEIGHTS = {
  orphanRatio: 40,
  depth: 20,
  anchorDiversity: 20,
  structure: 20,
} as const;
