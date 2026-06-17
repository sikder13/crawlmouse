import { describe, it, expect } from 'vitest';
import {
  diffAudit,
  countFindings,
  formatFindingDeltas,
  SCORE_DELTA_THRESHOLD,
  type GradeSnapshot,
} from './backtest-diff.js';

// SPEC 01 v2 §8 cutover gate: the backtest grades ONE crawl output under v1 and v2 and diffs THOSE.
// These pin the pure diff math (the half that decides whether a swing "blocks the flip"). The
// crawl-once-grade-twice engine seam itself is pinned in packages/engine/src/analyze-crawl.test.ts.

describe('backtest diff — v1 vs v2 over one crawl (SPEC 01 §8)', () => {
  it('counts findings by category', () => {
    const counts = countFindings([
      { category: 'orphan' },
      { category: 'orphan' },
      { category: 'unreachable_page' },
    ]);
    expect(counts).toEqual({ orphan: 2, unreachable_page: 1 });
  });

  it('diffs v2 minus v1 score + per-category finding counts and flags a large swing', () => {
    // The canonical §0 win: v2 retires unreachable_page and removes false orphans, score rises.
    const v1: GradeSnapshot = { score: 64.86, grade: 'C', findingCounts: { orphan: 5, unreachable_page: 9 } };
    const v2: GradeSnapshot = { score: 76.09, grade: 'B-', findingCounts: { orphan: 2 } };
    const d = diffAudit(v1, v2);
    expect(d.scoreDelta).toBeCloseTo(11.23, 2);
    expect(d.gradeChanged).toBe(true);
    expect(d.findingDeltas).toEqual({ orphan: -3, unreachable_page: -9 });
    expect(d.large).toBe(true); // |11.23| > 5 -> must be explained before the flip
  });

  it('omits unchanged categories and treats a small swing as not-large', () => {
    const v1: GradeSnapshot = { score: 90, grade: 'A', findingCounts: { orphan: 1, deep_page: 2 } };
    const v2: GradeSnapshot = { score: 92, grade: 'A', findingCounts: { orphan: 1, deep_page: 2, incomplete_crawl: 1 } };
    const d = diffAudit(v1, v2);
    expect(d.scoreDelta).toBe(2);
    expect(d.gradeChanged).toBe(false);
    expect(d.findingDeltas).toEqual({ incomplete_crawl: 1 });
    expect(d.large).toBe(false);
  });

  it('does not flag a delta sitting exactly on the threshold (strictly greater)', () => {
    const v1: GradeSnapshot = { score: 70, grade: 'C-', findingCounts: {} };
    const v2: GradeSnapshot = { score: 70 + SCORE_DELTA_THRESHOLD, grade: 'B', findingCounts: {} };
    expect(diffAudit(v1, v2).large).toBe(false);
  });

  it('formats finding deltas compactly, with a dash for none', () => {
    expect(formatFindingDeltas({ orphan: -3, incomplete_crawl: 1 })).toBe('orphan:-3, incomplete_crawl:+1');
    expect(formatFindingDeltas({})).toBe('—');
  });
});
