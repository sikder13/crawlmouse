import type { GradeBreakdown } from '@crawlmouse/types';

export interface GradeInputs {
  orphanRatio: number;                  // 0..1
  pagesBeyondDepth3Fraction: number;    // 0..1
  unreachableFraction: number;          // 0..1
  meanAnchorHHI: number;                // 0..1
  genericAnchorFraction: number;        // 0..1
  pageRankGini: number;                 // 0..1
}

export interface GradeResult {
  score: number;          // 0..100
  grade: string;
  breakdown: GradeBreakdown;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function computeGrade(inputs: GradeInputs): GradeResult {
  const orphanRatioScore = clamp(1 - inputs.orphanRatio);
  const depthScore = clamp(1 - (inputs.pagesBeyondDepth3Fraction + 0.5 * inputs.unreachableFraction));
  const baseAnchor = clamp(1 - inputs.meanAnchorHHI);
  const anchorDiversityScore = clamp(
    baseAnchor - (inputs.genericAnchorFraction > 0.2 ? 0.2 : 0),
  );
  const structureScore = clamp(1 - inputs.pageRankGini);

  const score =
    40 * orphanRatioScore +
    20 * depthScore +
    20 * anchorDiversityScore +
    20 * structureScore;

  // Classify on the same rounded value we display, so the number and the
  // letter can never disagree at a boundary (e.g. 89.996 -> shown "90" must be "A", not "A-").
  const rounded = Math.round(score * 100) / 100;
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
