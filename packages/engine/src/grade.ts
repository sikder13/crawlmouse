import type { GradeBreakdown } from '@crawlmouse/types';
import {
  GRADE_WEIGHTS,
  GENERIC_ANCHOR_ALERT,
  GENERIC_ANCHOR_PENALTY,
  UNREACHABLE_DEPTH_WEIGHT,
  MIN_COVERAGE_PAGES,
  LOW_CONFIDENCE_SCORE_CAP,
  NO_EVIDENCE_COMPONENT_CEILING,
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
  /**
   * Stage 4 — THE DENOMINATORS BEHIND THE RATIOS. Declared here ahead of the scoring change that
   * consumes them, so the contract is visible in one place rather than appearing with the fix.
   *
   * Every input above is a RATIO, and a ratio cannot distinguish `0/0` from `0/500`. That is the whole
   * of the D6 defect: a site with no observed internal links and a site with perfect internal linking
   * both arrive as `orphanRatio: 0`, and the second has earned full marks while the first has measured
   * nothing at all. 34 of 212 production audits were the first case; eight scored exactly 88.00.
   *
   * `observedEdgeCount` is the number of internal links actually seen among gradeable pages, and
   * `gradeablePageCount` the population those ratios were computed over. Optional while the scoring
   * change lands; `grade-absence-of-evidence.test.ts` is the failing test that specifies the behaviour.
   */
  observedEdgeCount?: number;
  gradeablePageCount?: number;
}

export interface GradeResult {
  score: number;          // 0..100
  grade: string;
  breakdown: GradeBreakdown;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function computeGrade(inputs: GradeInputs): GradeResult {
  // Stage 4 — ABSENCE OF EVIDENCE MUST NEVER READ AS EVIDENCE OF QUALITY.
  //
  // Every component below is a ratio over the link graph: orphans are defined by inbound links, depth
  // by traversal, anchor diversity by anchor text ON links, structure by PageRank over edges. With no
  // observed edges NONE of them measured anything, yet three of the four return their maximum — which
  // is how eight production audits reached exactly 88.00 on an empty graph.
  //
  // Applied through ONE helper that every component passes through, deliberately: the defect is the
  // class, so a component added later inherits the protection rather than re-deriving the flaw.
  //
  // `undefined` means the caller predates this contract and behaviour is unchanged for it — the
  // production path is wired in `deriveGradeInputs` and pinned by a guard test, because a silently
  // unpassed denominator would restore the defect without failing anything.
  const evidenceKnown = inputs.observedEdgeCount !== undefined && inputs.gradeablePageCount !== undefined;
  const hasEvidence = !evidenceKnown || (inputs.observedEdgeCount! > 0 && inputs.gradeablePageCount! > 0);
  const measured = (raw: number): number =>
    hasEvidence ? raw : Math.min(raw, NO_EVIDENCE_COMPONENT_CEILING);

  const orphanRatioScore = measured(clamp(1 - inputs.orphanRatio));
  const depthScore = measured(
    clamp(1 - (inputs.pagesBeyondDepth3Fraction + UNREACHABLE_DEPTH_WEIGHT * inputs.unreachableFraction)),
  );
  const baseAnchor = clamp(1 - inputs.meanAnchorHHI);
  const anchorDiversityScore = measured(
    clamp(baseAnchor - (inputs.genericAnchorFraction > GENERIC_ANCHOR_ALERT ? GENERIC_ANCHOR_PENALTY : 0)),
  );
  // A5: structure rewards a healthy authority topology — concentration on real hubs
  // (weighted 0.6, the primary signal) plus those hubs being reachable from the
  // homepage (weighted 0.4). This is the OPPOSITE of the old `1 - pageRankGini`, which
  // scored a flat, hub-less spread as good. Over-concentration is not penalized here
  // (it saturates at 1); the resulting orphans are penalized by orphanRatio instead.
  const structureScore = measured(clamp(0.6 * inputs.hubConcentration + 0.4 * inputs.hubReachability));

  const rawScore =
    GRADE_WEIGHTS.orphanRatio * orphanRatioScore +
    GRADE_WEIGHTS.depth * depthScore +
    GRADE_WEIGHTS.anchorDiversity * anchorDiversityScore +
    GRADE_WEIGHTS.structure * structureScore;

  // Thin-crawl floor (A3) — a ceiling, never a floor: the grade can't be certified high when the link
  // graph is too thin to trust (pageCount < MIN_COVERAGE_PAGES — a 2-page brochure or a failed crawl).
  // SPEC 02 §2 REMOVED the old low-confidence trigger here: a well-structured site the crawl only
  // partly reached keeps its real (uncapped) point estimate and communicates the uncertainty via the
  // ConfidenceBand instead of being slammed to C/60. (PASSING_SCORE in the web app is unrelated.)
  const lowCoverage = inputs.pageCount !== undefined && inputs.pageCount < MIN_COVERAGE_PAGES;
  const capped = lowCoverage ? Math.min(rawScore, LOW_CONFIDENCE_SCORE_CAP) : rawScore;

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
