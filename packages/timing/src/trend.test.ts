import { describe, expect, it } from 'vitest';
import type { Sample } from './samples.js';
import { TREND_NIGHTLIES, trendLines } from './trend.js';

const s = (metric: string, median: number, limit = 100, unit = 'ms'): Sample => ({
  metric,
  unit,
  median,
  limit,
  samples: [median],
});

describe('trendLines', () => {
  it('compares each metric with the last seven nightlies', () => {
    expect(TREND_NIGHTLIES).toBe(7);
    const history = [10, 11, 12, 13, 14, 15, 16].map((m) => [s('layout', m)]);
    expect(trendLines([s('layout', 14.5)], history)).toEqual([
      '- layout: 14.5 ms (limit 100) · last 7 nightlies: median 13, range 10–16 · +11.5%',
    ]);
  });

  it('reads no further back than seven, newest first', () => {
    const history = [1, 1, 1, 1, 1, 1, 1, 900, 900].map((m) => [s('a', m)]);
    expect(trendLines([s('a', 1)], history)[0]).toContain(
      'last 7 nightlies: median 1, range 1–1 · 0%',
    );
  });

  it('says so when there is nothing earlier to compare', () => {
    expect(trendLines([s('a', 3)], [])).toEqual([
      '- a: 3 ms (limit 100) · no earlier nightly to compare',
    ]);
  });

  it('counts only the nightlies that measured the metric', () => {
    const history = [[s('a', 2)], [s('b', 5)], [s('a', 4)]];
    expect(trendLines([s('a', 3)], history)[0]).toContain(
      'last 2 nightlies: median 3, range 2–4 · 0%',
    );
  });

  it('marks a breach of its limit', () => {
    expect(trendLines([s('a', 120)], [])[0]).toBe(
      '- a: 120 ms (limit 100, OVER) · no earlier nightly to compare',
    );
  });

  it('lists a metric the last nightly measured and tonight did not, rather than dropping it', () => {
    expect(trendLines([s('a', 1)], [[s('a', 1), s('gone', 4)]])).toEqual([
      '- a: 1 ms (limit 100) · last 1 nightly: median 1, range 1–1 · 0%',
      '- gone: not measured tonight (last nightly: 4 ms)',
    ]);
  });

  it('writes a fall in the median with a minus sign', () => {
    expect(trendLines([s('a', 5)], [[s('a', 10)]])[0]).toContain('· −50%');
  });
});
