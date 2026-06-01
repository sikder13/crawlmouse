import { describe, it, expect } from 'vitest';
import { scoreToLetter, computeGrade } from './grade.js';

describe('scoreToLetter', () => {
  it.each([
    [95, 'A'], [90, 'A'], [89, 'A-'], [85, 'A-'],
    [84, 'B+'], [80, 'B+'], [79, 'B'], [75, 'B'],
    [74, 'B-'], [70, 'B-'], [69, 'C+'], [65, 'C+'],
    [64, 'C'], [60, 'C'], [59, 'C-'], [55, 'C-'],
    [54, 'D+'], [50, 'D+'], [49, 'D'], [45, 'D'],
    [44, 'D-'], [40, 'D-'], [39, 'F'], [0, 'F'],
  ])('score %d -> %s', (score, expected) => {
    expect(scoreToLetter(score)).toBe(expected);
  });
});

describe('computeGrade', () => {
  it('returns 100 for perfect inputs', () => {
    const r = computeGrade({
      orphanRatio: 0,
      pagesBeyondDepth3Fraction: 0,
      unreachableFraction: 0,
      meanAnchorHHI: 0,
      genericAnchorFraction: 0,
      pageRankGini: 0,
    });
    expect(r.score).toBeCloseTo(100, 0);
    expect(r.grade).toBe('A');
  });

  it('returns ~0 for worst-case inputs', () => {
    const r = computeGrade({
      orphanRatio: 1,
      pagesBeyondDepth3Fraction: 1,
      unreachableFraction: 1,
      meanAnchorHHI: 1,
      genericAnchorFraction: 1,
      pageRankGini: 1,
    });
    expect(r.score).toBeLessThan(10);
    expect(r.grade).toBe('F');
  });

  it('never shows a letter that disagrees with the rounded score at a boundary', () => {
    // Unrounded score = 89.996, which rounds to 90.00. The letter must classify on
    // the rounded value (A), never on the unrounded value (which would be A-).
    const r = computeGrade({
      orphanRatio: 0.2501,
      pagesBeyondDepth3Fraction: 0,
      unreachableFraction: 0,
      meanAnchorHHI: 0,
      genericAnchorFraction: 0,
      pageRankGini: 0,
    });
    expect(r.score).toBe(90);
    expect(r.grade).toBe('A');
    expect(r.grade).toBe(scoreToLetter(r.score));
  });
});
