import { recordSample } from './samples.js';
import { fmt, median } from './stats.js';

/** Measured runs per check; the check is judged on their median. */
export const TIMING_RUNS = 5;
/** Runs before the measured ones, not counted: the first call pays for compiling the code. */
export const WARMUP_RUNS = 1;
/**
 * The default suite holds a median to this many times its budget, a line only a real regression
 * crosses on a loaded machine. The budget itself is held by the strict job (PERF_STRICT=1).
 */
export const DEFAULT_CEILING_FACTOR = 3;

type Env = Record<string, string | undefined>;

/** Whether this run holds medians to their budgets rather than the default ceiling. */
export function isStrict(env: Env = process.env): boolean {
  return env.PERF_STRICT === '1';
}

interface Options {
  /** Milliseconds; injected by tests. */
  now?: () => number;
  /** Read for PERF_STRICT and PERF_SAMPLES_DIR; injected by tests. */
  env?: Env;
}

export interface BudgetOptions extends Options {
  budgetMs: number;
}

export interface BudgetResult<T> {
  /** What each measured run returned, in order. */
  values: T[];
  samples: number[];
  median: number;
  limitMs: number;
}

const list = (xs: number[]) => `${xs.map(fmt).join(', ')} ms`;

function timed<T>(fn: () => T, now: () => number): { value: T; ms: number } {
  const start = now();
  const value = fn();
  return { value, ms: now() - start };
}

/**
 * Runs `fn` WARMUP_RUNS times, then TIMING_RUNS times on the clock, and throws unless the median
 * of those runs is under the limit: the budget under PERF_STRICT=1, DEFAULT_CEILING_FACTOR times
 * it otherwise. The samples are recorded to PERF_SAMPLES_DIR, when set, pass or fail.
 */
export function expectWithinBudget<T>(
  name: string,
  fn: () => T,
  { budgetMs, now = () => performance.now(), env = process.env }: BudgetOptions,
): BudgetResult<T> {
  const strict = isStrict(env);
  const limitMs = strict ? budgetMs : budgetMs * DEFAULT_CEILING_FACTOR;
  const warmups = Array.from({ length: WARMUP_RUNS }, () => timed(fn, now).ms);
  const runs = Array.from({ length: TIMING_RUNS }, () => timed(fn, now));
  const samples = runs.map((r) => r.ms);
  const mid = median(samples);
  const pass = mid < limitMs;
  recordSample(env.PERF_SAMPLES_DIR, {
    metric: name,
    unit: 'ms',
    median: mid,
    limit: limitMs,
    pass,
    samples,
  });
  if (!pass) {
    const against = strict
      ? `the budget of ${fmt(budgetMs)} ms (PERF_STRICT=1)`
      : `the default ceiling of ${fmt(limitMs)} ms (${DEFAULT_CEILING_FACTOR} × the ${fmt(budgetMs)} ms budget, which the strict job holds)`;
    throw new Error(
      `${name}: median ${fmt(mid)} ms of ${TIMING_RUNS} runs is not under ${against}. ` +
        `Samples: ${list(samples)}; warm-up ${list(warmups)}.`,
    );
  }
  return { values: runs.map((r) => r.value), samples, median: mid, limitMs };
}

export interface RelativeOptions extends Options {
  /** The limit for the measured median, given the reference median. */
  limit: (referenceMs: number) => number;
  /** The rule the limit encodes, in words, for the failure message. */
  rule: string;
}

/**
 * Times `measured` and `reference` in turn, a warm-up of each and then TIMING_RUNS pairs, and
 * throws unless the median of `measured` is under `limit(median of reference)`. Interleaving puts
 * both sides under the same load, so the comparison holds on a busy machine without a ceiling.
 */
export function expectWithinRelative(
  name: string,
  { measured, reference }: { measured: () => unknown; reference: () => unknown },
  { limit, rule, now = () => performance.now() }: RelativeOptions,
): { measured: number[]; reference: number[] } {
  for (let i = 0; i < WARMUP_RUNS; i++) {
    measured();
    reference();
  }
  const m: number[] = [];
  const r: number[] = [];
  for (let i = 0; i < TIMING_RUNS; i++) {
    m.push(timed(measured, now).ms);
    r.push(timed(reference, now).ms);
  }
  const bound = limit(median(r));
  if (!(median(m) < bound)) {
    throw new Error(
      `${name}: median ${fmt(median(m))} ms is not under ${fmt(bound)} ms (${rule}). ` +
        `Measured: ${list(m)}; reference: ${list(r)}, median ${fmt(median(r))} ms.`,
    );
  }
  return { measured: m, reference: r };
}
