import { describe, it, expect } from 'vitest';
import { scoreToLetter, computeGrade } from './grade.js';
import { LOW_CONFIDENCE_SCORE_CAP } from './constants.js';

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
      // A5: a perfect structure is now concentrated authority (hubs) that is fully
      // reachable — both signals at their best, NOT a flat PageRank spread.
      hubConcentration: 1,
      hubReachability: 1,
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
      // A5: worst structure = no hub concentration AND no reachable hubs.
      hubConcentration: 0,
      hubReachability: 0,
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
      hubConcentration: 1,
      hubReachability: 1,
    });
    expect(r.score).toBe(90);
    expect(r.grade).toBe('A');
    expect(r.grade).toBe(scoreToLetter(r.score));
  });

  it('blends structure as 0.6 * hubConcentration + 0.4 * hubReachability', () => {
    // All other dimensions perfect so only the structure dimension varies. The
    // structure score must be the documented 0.6/0.4 blend, scaled by its weight.
    const base = {
      orphanRatio: 0,
      pagesBeyondDepth3Fraction: 0,
      unreachableFraction: 0,
      meanAnchorHHI: 0,
      genericAnchorFraction: 0,
    };
    const r = computeGrade({ ...base, hubConcentration: 0.5, hubReachability: 0 });
    // structureScore = 0.6*0.5 + 0.4*0 = 0.3; structure weight is 20.
    expect(r.breakdown.structureScore).toBeCloseTo(0.3, 5);
    // 40 (orphan) + 20 (depth) + 20 (anchor) + 20*0.3 (structure) = 86.
    expect(r.score).toBeCloseTo(86, 5);

    // Reachability is weighted LESS than concentration: swap the two inputs and the
    // 0.4-weighted term must give a strictly lower blend than the 0.6-weighted one.
    const swapped = computeGrade({ ...base, hubConcentration: 0, hubReachability: 0.5 });
    expect(swapped.breakdown.structureScore).toBeCloseTo(0.2, 5);
    expect(swapped.breakdown.structureScore).toBeLessThan(r.breakdown.structureScore);
  });
});

describe('computeGrade low-confidence coverage cap (A3)', () => {
  const perfect = {
    orphanRatio: 0,
    pagesBeyondDepth3Fraction: 0,
    unreachableFraction: 0,
    meanAnchorHHI: 0,
    genericAnchorFraction: 0,
    hubConcentration: 1,
    hubReachability: 1,
  };

  it('caps a thin crawl so a near-empty site cannot show an A', () => {
    // Previously a 2-page crawl scored 97 ("A"). With too little coverage the structural
    // signal is not trustworthy, so the grade is capped.
    const r = computeGrade({ ...perfect, pageCount: 2 });
    expect(r.score).toBeLessThanOrEqual(LOW_CONFIDENCE_SCORE_CAP);
    expect(['A', 'A-']).not.toContain(r.grade);
    expect(r.grade).toBe(scoreToLetter(r.score));
  });

  it('caps an empty graph (0 pages) instead of awarding a perfect 100', () => {
    const r = computeGrade({ ...perfect, pageCount: 0 });
    expect(r.score).toBeLessThanOrEqual(LOW_CONFIDENCE_SCORE_CAP);
  });

  it('does NOT cap a well-covered site', () => {
    const r = computeGrade({ ...perfect, pageCount: 50 });
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
  });

  it('is a ceiling, not a floor: an already-low thin crawl stays low', () => {
    const bad = {
      orphanRatio: 1,
      pagesBeyondDepth3Fraction: 1,
      unreachableFraction: 1,
      meanAnchorHHI: 1,
      genericAnchorFraction: 1,
      hubConcentration: 0,
      hubReachability: 0,
    };
    const r = computeGrade({ ...bad, pageCount: 2 });
    expect(r.score).toBeLessThan(10);
  });

  it('leaves the math unchanged when pageCount is omitted (back-compat)', () => {
    const r = computeGrade(perfect);
    expect(r.score).toBeCloseTo(100, 0);
    expect(r.grade).toBe('A');
  });
});
