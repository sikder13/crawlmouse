import { describe, it, expect } from 'vitest';
import { aggregateGraphStats } from './audit-stats';

describe('aggregateGraphStats', () => {
  it('returns zeros for an empty page set', () => {
    expect(aggregateGraphStats([])).toEqual({ orphanCount: 0, avgDepth: 0 });
  });

  it('counts orphans and averages click depth', () => {
    const stats = aggregateGraphStats([
      { is_orphan: true, depth: 0 },
      { is_orphan: false, depth: 2 },
      { is_orphan: false, depth: 4 },
    ]);
    expect(stats.orphanCount).toBe(1);
    expect(stats.avgDepth).toBe(2); // (0 + 2 + 4) / 3
  });

  it('excludes null depths from the average but still counts orphans', () => {
    const stats = aggregateGraphStats([
      { is_orphan: true, depth: null },
      { is_orphan: false, depth: 2 },
    ]);
    expect(stats.orphanCount).toBe(1);
    expect(stats.avgDepth).toBe(2); // only the non-null depth contributes
  });

  it('avoids divide-by-zero when every depth is null', () => {
    const stats = aggregateGraphStats([
      { is_orphan: false, depth: null },
      { is_orphan: false, depth: null },
    ]);
    expect(stats.avgDepth).toBe(0);
  });
});
