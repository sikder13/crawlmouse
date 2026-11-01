/**
 * The thresholds the structure detectors decide on. The spec's threshold table
 * (docs/specs/v2/16-structure-detectors.md) is rendered from this module, and spec.test.ts fails
 * when the file and the render differ.
 */
import { TOP_HUB_FRACTION } from '../../analysis/structure.js';
import { SIMHASH_HAMMING_K } from '../../analysis/simhash.js';
import { MAX_HEALTHY_DEPTH } from '../../constants.js';

/** A crawl that fetched less than this share of the URLs it discovered is truncated. */
export const MIN_CRAWL_COVERAGE = 0.9;

/** More clicks than this from the homepage is deep (v1's constant). */
export { MAX_HEALTHY_DEPTH };

/** Template-weighted overlap with the previous check's sample below which depth is not compared. */
export const MIN_STRATA_OVERLAP = 0.9;

/** The share of crawled pages, by PageRank, that are hubs (v1's constant). */
export { TOP_HUB_FRACTION };

/** A hub with fewer outbound links than this is not judged on its anchors. */
export const MIN_HUB_OUTLINKS = 5;

/** A hub with a generic-anchor share above this is detected. */
export const GENERIC_DETECT_ABOVE = 0.5;

/** A hub with a generic-anchor share at or below this is clear. Between the two: indeterminate. */
export const GENERIC_CLEAR_AT_OR_BELOW = 0.3;

/** A link target reached through this many redirects or more is a chain. */
export const REDIRECT_CHAIN_MIN_HOPS = 2;

/** Pages whose content simhashes differ in at most this many bits are near-duplicates (v1's k). */
export { SIMHASH_HAMMING_K };

/** The answers that say a page is no longer there. */
export const GONE_STATUSES: readonly (404 | 410)[] = [404, 410];
