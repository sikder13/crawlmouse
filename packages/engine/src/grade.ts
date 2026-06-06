import type { GradeBreakdown } from '@crawlmouse/types';
import {
  GRADE_WEIGHTS,
  GENERIC_ANCHOR_ALERT,
  GENERIC_ANCHOR_PENALTY,
  UNREACHABLE_DEPTH_WEIGHT,
  MIN_COVERAGE_PAGES,
  LOW_CONFIDENCE_SCORE_CAP,
} from './constants.js';

export interface GradeInputs {
  orphanRatio: number;                  // 0..1
  pagesBeyondDepth3Fraction: number;    // 0..1
  unreachableFraction: number;          // 0..1
  meanAnchorHHI: number;                // 0..1
  genericAnchorFraction: number;        // 0..1
  /**
   * Structure signals (A5). These REPLACE the old `pageRankGini` input, which had the
   * sign backwards (it rewarded a flat, hub-less PageRank spread). Both are 0..1:
   *  - hubConcentration: how much authority concentrates on a healthy hub tier (higher
   *    is better; a flat/fragmented graph is ~0, a well-siloed site -> 1).
   *  - hubReachability: fraction of those hubs reachable from the homepage within the
   *    healthy click budget (higher is better).
   */
  hubConcentration: number;             // 0..1
  hubReachability: number;              // 0..1
  /**
   * Pages crawled. When provided and below MIN_COVERAGE_PAGES, the score is capped (A3):
   * there is not enough of a link graph to certify a high grade. Omit to skip the cap
   * (used by unit tests that exercise the scoring math in isolation).
   */
  pageCount?: number;
}

export interface GradeResult {
  score: number;          // 0..100
  grade: string;
  breakdown: GradeBreakdown;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function computeGrade(inputs: GradeInputs): GradeResult {
  const orphanRatioScore = clamp(1 - inputs.orphanRatio);
  const depthScore = clamp(
    1 - (inputs.pagesBeyondDepth3Fraction + UNREACHABLE_DEPTH_WEIGHT * inputs.unreachableFraction),
  );
  const baseAnchor = clamp(1 - inputs.meanAnchorHHI);
  const anchorDiversityScore = clamp(
    baseAnchor - (inputs.genericAnchorFraction > GENERIC_ANCHOR_ALERT ? GENERIC_ANCHOR_PENALTY : 0),
  );
  // A5: structure rewards a healthy authority topology — concentration on real hubs
  // (weighted 0.6, the primary signal) plus those hubs being reachable from the
  // homepage (weighted 0.4). This is the OPPOSITE of the old `1 - pageRankGini`, which
  // scored a flat, hub-less spread as good. Over-concentration is not penalized here
  // (it saturates at 1); the resulting orphans are penalized by orphanRatio instead.
  const structureScore = clamp(0.6 * inputs.hubConcentration + 0.4 * inputs.hubReachability);

  const rawScore =
    GRADE_WEIGHTS.orphanRatio * orphanRatioScore +
    GRADE_WEIGHTS.depth * depthScore +
    GRADE_WEIGHTS.anchorDiversity * anchorDiversityScore +
    GRADE_WEIGHTS.structure * structureScore;

  // A3 low-confidence cap: with too few pages the link graph is too thin to certify, so
  // cap the score (a ceiling, never a floor) — a 0/2-page crawl can no longer show an "A".
  const capped =
    inputs.pageCount !== undefined && inputs.pageCount < MIN_COVERAGE_PAGES
      ? Math.min(rawScore, LOW_CONFIDENCE_SCORE_CAP)
      : rawScore;

  // Classify on the same rounded value we display, so the number and the
  // letter can never disagree at a boundary (e.g. 89.996 -> shown "90" must be "A", not "A-").
  const rounded = Math.round(capped * 100) / 100;
  return {
    score: rounded,
    grade: scoreToLetter(rounded),
    breakdown: { orphanRatioScore, depthScore, anchorDiversityScore, structureScore },
  };
}

export function scoreToLetter(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 85) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 75) return 'B';
  if (score >= 70) return 'B-';
  if (score >= 65) return 'C+';
  if (score >= 60) return 'C';
  if (score >= 55) return 'C-';
  if (score >= 50) return 'D+';
  if (score >= 45) return 'D';
  if (score >= 40) return 'D-';
  return 'F';
}
