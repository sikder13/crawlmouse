import { describe, expect, it } from 'vitest';
import { PROBE_REFERENCE_MS, SLOW_RUNNER_FACTOR, probe, rate, workload } from './probe.js';

describe('the runner probe', () => {
  it('does the same work on every run', () => {
    expect(workload()).toBe(workload());
  });

  it('rates a runner slow only past the factor times the reference', () => {
    expect(SLOW_RUNNER_FACTOR).toBe(1.5);
    const limit = PROBE_REFERENCE_MS * SLOW_RUNNER_FACTOR;
    expect(rate(limit)).toBe('normal');
    expect(rate(limit + 0.01)).toBe('slow');
    expect(rate(PROBE_REFERENCE_MS / 2)).toBe('normal');
  });

  it('reports its samples, their median, the reference and the rating', () => {
    // Each run reads the clock twice; the second read of each pair moves it by the run's duration.
    let t = 0;
    let reads = 0;
    const durations = [500, 10, 20, 30, 40, 50];
    const r = probe(() => {
      if (reads++ % 2 === 1) t += durations.shift() ?? 0;
      return t;
    });
    expect(r.samples).toEqual([10, 20, 30, 40, 50]);
    expect(r.medianMs).toBe(30);
    expect(r.referenceMs).toBe(PROBE_REFERENCE_MS);
    expect(r.limitMs).toBe(PROBE_REFERENCE_MS * SLOW_RUNNER_FACTOR);
    expect(r.rating).toBe(rate(30));
  });
});
