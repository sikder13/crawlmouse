/**
 * The thresholds the access detectors decide on. The spec (docs/specs/v2/15-access-detectors.md) is
 * rendered from this module, and spec.test.ts fails when the file and the render differ.
 */

/** A crawler blocked by a user-agent rule on at least this share of the pages judged is detected (ENGINE-GAP §5). */
export const EDGE_DETECT_SHARE = 0.5;

/** A crawler served on at least this share of the pages judged is clear (ENGINE-GAP §5). */
export const EDGE_CLEAR_SHARE = 0.95;

/**
 * Fewer scored crawlers measured than this withholds the access score (FACTS I4). The contract's
 * Check rules `i4_withheld` and `i4_given` hold the same number; contract-fit.test.ts parses checks on
 * both sides of it with those rules.
 */
export const MIN_SCORED_MEASURED = 2;
