/**
 * What `diffCheck` reads and returns. The records are the v2 contract's (`@crawlmouse/types/v2`);
 * the rest is what the pipeline knows about a check that the contract does not store.
 */
import type { Change, Check, DetectionState, Fix, FixEvent, FixType } from '@crawlmouse/types/v2';

/** A check, with what the pipeline knows about it beyond the Check record. */
export interface CheckSide {
  check: Check;
  /** The most pages the crawl was allowed to fetch. Coverage does not carry it. */
  page_cap: number;
  /**
   * robots.txt as it was read: the empty string when the site has none, null when it could not be
   * read (so it was not measured). The Check record does not carry it.
   */
  robots_txt: string | null;
  /** The fix types whose detectors ran on this check. */
  detectors: readonly FixType[];
}

/** The fields of a fix a detector measures each time it finds the problem. */
export type FixDraft = Pick<
  Fix,
  | 'type'
  | 'section'
  | 'title'
  | 'detail'
  | 'recommendation_class'
  | 'confidence'
  | 'affected_pages'
  | 'template_key'
  | 'crawler_uas'
  | 'effect'
  | 'effort'
  | 'before_after'
  | 'packet'
> & {
  /** Its order of impact among the site's live fixes on this check (FixSchema: 1 or more). */
  rank: number;
};

/**
 * One detector's result for one fingerprint on this check. A fingerprint with no outcome was not
 * measured: its detector did not run, or did not report it.
 */
export type DetectorOutcome =
  | { fingerprint: string; state: Extract<DetectionState, 'detected'>; fix: FixDraft }
  | { fingerprint: string; state: Exclude<DetectionState, 'detected'> };

export interface DiffInput {
  /** The last check of the site that was graded (finished or partial); null if there is none. */
  previous: CheckSide | null;
  current: CheckSide;
  /** The site's fixes as they stand before this check. */
  fixes: readonly Fix[];
  /** Every event of those fixes. */
  events: readonly FixEvent[];
  outcomes: readonly DetectorOutcome[];
}

export interface DiffResult {
  /** Fixes this check created or changed, whole, in `number` order. Unchanged fixes are absent. */
  fixes: Fix[];
  /** Events this check appended, in the order of the fixes they belong to. */
  events: FixEvent[];
  changes: Change[];
}
