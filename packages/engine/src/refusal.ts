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
 * Measured on the live corpus (212 completed audits, 2026-08-04): 39 too few pages · 4 nothing read ·
 * 34 zero observed edges · 22 high confidence on unknown coverage. 51 lose their letter; 64 (30.2%)
 * change verdict.
 *
 * A SITE WE COULD NOT READ IS NOT A BAD SITE. Refusal is not an F. Three triggers withhold the letter
 * because there was nothing to grade; the fourth caps confidence, because unknown coverage still
 * describes a real measurement of an unknown fraction of the site — erasing that would overcorrect,
 * while calling it HIGH confidence is the defect.
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
  /** How the site total was derived. `'none'` means coverage is unknowable, so confidence cannot be high. */
  estimateSource: 'sitemap' | 'frontier' | 'none';
}

/**
 * Pure function of the evidence. No clock, no network, no thresholds beyond the categorical floor —
 * so the same audit always yields the same decision, and the decision is explainable from its inputs.
 */
export function decideRefusal(evidence: RefusalEvidence): RefusalDecision {
  const triggers: RefusalTrigger[] = [];
  const unevaluable: RefusalTrigger[] = [];

  if (evidence.gradeablePageCount < MIN_GRADEABLE_PAGES) triggers.push('too_few_gradeable_pages');

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
