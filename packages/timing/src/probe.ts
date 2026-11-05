import { median } from './stats.js';

/**
 * The probe's median on a runner of normal speed, in milliseconds: the median of three readings on
 * the GitHub-hosted runner in the Playwright image, rounded to a whole millisecond.
 * docs/ops/ci-timing.md lists the three runs.
 */
export const PROBE_REFERENCE_MS = 105;
/** A runner whose probe median is more than this many times the reference is rated slow. */
export const SLOW_RUNNER_FACTOR = 1.5;

const RUNS = 5;
const SIZE = 1_000_000;

/** A fixed CPU workload: fill an array from a linear congruential generator and sort it. */
export function workload(): number {
  let state = 2026;
  const xs = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    xs[i] = state;
  }
  xs.sort();
  let checksum = 0;
  for (let i = 0; i < SIZE; i += 997) checksum = (checksum + xs[i]!) % 1_000_000_007;
  return checksum;
}

export type Rating = 'normal' | 'slow';

export function rate(medianMs: number): Rating {
  return medianMs > PROBE_REFERENCE_MS * SLOW_RUNNER_FACTOR ? 'slow' : 'normal';
}

export interface ProbeResult {
  samples: number[];
  medianMs: number;
  referenceMs: number;
  limitMs: number;
  rating: Rating;
}

/** Runs the workload once to warm up, then RUNS times on the clock, and rates the runner. */
export function probe(now: () => number = () => performance.now()): ProbeResult {
  const run = () => {
    const start = now();
    workload();
    return now() - start;
  };
  run();
  const samples = Array.from({ length: RUNS }, run);
  const medianMs = median(samples);
  return {
    samples,
    medianMs,
    referenceMs: PROBE_REFERENCE_MS,
    limitMs: PROBE_REFERENCE_MS * SLOW_RUNNER_FACTOR,
    rating: rate(medianMs),
  };
}
