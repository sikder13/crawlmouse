import type { RefusalDecision, RefusalTrigger } from '@crawlmouse/types';
import { MIN_GRADEABLE_PAGES } from './constants.js';

/**
 * SPEC 5.1a Stage 4 — THE REFUSAL GATE.
 *
 * ABSENCE OF EVIDENCE MUST NEVER READ AS EVIDENCE OF QUALITY. `computeGrade`'s ceiling stops the
 * COMPONENTS claiming quality they never measured; this stops the PRODUCT asserting a letter at all.
 * The two are separate on purpose — a capped component still produces a number, and a number still
 * reads as a verdict.
 *
 * ONE GATE, FOUR CATEGORICAL TRIGGERS. Every one is a fact about the evidence we hold rather than a
 * judgement about the site, which is exactly why none needs the 5.1b calibration panel: there is no
 * threshold to tune in "we read nothing". The calibrated coverage-RATIO threshold stays in 5.1b.
 *
 * Measured on the live corpus (212 completed audits, 2026-08-04), ON THE `audits.page_count` /
 * `audits.link_count` BASIS: 39 too few pages · 4 nothing read · 34 zero observed edges · 22 high
 * confidence on unknown coverage. 51 lose their letter; 64 (30.2%) change verdict.
 *
 * ⚠ NAME THE BASIS OR THE NUMBERS DO NOT RECONCILE. `docs/OPERATING-RULES.md` §5 reports the same
 * corpus on the GRADEABLE-POPULATION basis (2026-08-08, n=215): 40 below the floor — 27 + 13 — and 36
 * zero-edge. Both are correct and they differ, because this trigger consumes `gradeablePageCount`
 * (status-200 ∧ NOT `excluded_from_grade`) and NOT pages crawled — see `RefusalEvidence` below. The
 * gradeable basis is the one the code implements and the one `evidence/2026-08-04-stage4-floor-
 * calibration.md` endorses; the `page_count` figures here are the earlier proxy, kept because the
 * floor-insensitivity argument was computed on them. Two gate-8 reviewers derived different counts
 * from these two paragraphs because neither said which basis it used. They both say so now.
 *
 * A SITE WE COULD NOT READ IS NOT A BAD SITE. Refusal is not an F. Three triggers withhold the letter
 * because there was nothing to grade; the fourth is recorded on the decision (`confidenceCapped`) and
 * is NOT yet consumed by any render path — §9.1 wires it in 5.1b. Saying it "caps confidence" today
 * would describe behaviour that does not exist: `crawlHealth.confidence` is computed from
 * blockRate/coveragePct in `crawl-health.ts` and is unaffected by `estimateSource`.
 *
 * UNKNOWN IS NOT ZERO. `fetchedOkCount: null` means the crawl was never instrumented, not that the
 * host was dead — 6 of the 212 audits are in that state. Refusing there would repeat the very
 * conflation this stage exists to remove, so it is reported as its own `unevaluable` state instead.
 */


export type { RefusalDecision, RefusalTrigger };

export interface RefusalEvidence {
  /** Size of the graded population (§5 M9), not pages crawled. */
  gradeablePageCount: number;
  /** Internal links observed INTO the graded population. Zero means nothing was measurable. */
  observedEdgeCount: number;
  /** Successful fetches. `null` = NOT INSTRUMENTED, which is not the same as zero and never refuses. */
  fetchedOkCount: number | null;
  /**
   * §7 `coverage.fetched` — every URL fetched, BEFORE the kind/thin exclusions. `null` when we do not
   * hold the accounting.
   *
   * This exists to answer a question `gradeablePageCount` cannot: when the population is below the
   * floor, was the SITE small, or did WE exclude most of it? Those are different truths and they had
   * been collapsed into one trigger. Without this number the gate can only guess, and guessing is how
   * a 214-page site got told it was too small to measure.
   */
  fetchedPageCount: number | null;
  /** How the site total was derived. `'none'` means coverage is unknowable, so confidence cannot be high. */
  estimateSource: 'sitemap' | 'frontier' | 'none';
  /**
   * Did the crawl stop before it finished discovering? CATEGORICAL — the crawl-health `partial` flag,
   * not a coverage ratio, so the split needs no threshold and no calibration panel.
   *
   * It separates two shapes that share a refusal but not a reason: a SMALL SITE we read completely
   * (`false` — the measurement is meaningless at this size) from a LARGE SITE we barely reached
   * (`true` — the evidence is insufficient). `null` when the crawl was never instrumented.
   */
  crawlTruncated: boolean | null;
}

/**
 * Pure function of the evidence. No clock, no network, no thresholds beyond the categorical floor —
 * so the same audit always yields the same decision, and the decision is explainable from its inputs.
 */
export function decideRefusal(evidence: RefusalEvidence): RefusalDecision {
  const triggers: RefusalTrigger[] = [];
  const unevaluable: RefusalTrigger[] = [];

  if (evidence.gradeablePageCount < MIN_GRADEABLE_PAGES) {
    // ONE REFUSAL, THREE DISTINCT TRUTHS. Same outcome — no letter — but the reason differs, and the
    // reason is the whole point of this gate. Categorical throughout: no threshold beyond the floor
    // that already exists, so none of this needs the 5.1b calibration panel.
    //
    //   1. crawl TRUNCATED (or unknown)   -> we may simply not have reached enough of a larger site.
    //      Unknown truncation lands here too, because claiming "your site is small" on an
    //      un-instrumented crawl asserts something we never established.
    //   2. completed, site BELOW the floor -> we hold the whole site and it is genuinely too small.
    //   3. completed, site AT OR ABOVE the floor -> the site had enough pages and OUR OWN kind/thin
    //      exclusions took the population under it. Saying "too small" here is false, and it SHIPPED:
    //      quotes.toscrape.com, 214 pages and 3,978 links, was told exactly that on 2026-08-08.
    //
    // `fetchedPageCount === null` falls back to (2) rather than (3): asserting "we excluded most of
    // your pages" without holding the count would be the same invented cause wearing a new hat.
    if (evidence.crawlTruncated !== false) {
      triggers.push('too_few_gradeable_pages');
    } else if (evidence.fetchedPageCount !== null && evidence.fetchedPageCount >= MIN_GRADEABLE_PAGES) {
      triggers.push('too_few_gradeable_after_exclusion');
    } else {
      triggers.push('site_too_small_to_measure');
    }
  }

  // The unknown-is-not-zero branch. Ordered so the null case can never fall through into the zero
  // case: an un-instrumented crawl is recorded as unevaluable and is NOT a reason to refuse.
  if (evidence.fetchedOkCount === null) unevaluable.push('nothing_read');
  else if (evidence.fetchedOkCount === 0) triggers.push('nothing_read');

  if (evidence.observedEdgeCount === 0) triggers.push('no_observed_links');

  return {
    refused: triggers.length > 0,
    triggers,
    confidenceCapped: evidence.estimateSource === 'none',
    unevaluable,
  };
}
