import { isMainThread } from 'node:worker_threads';
import { recordSample } from './samples.js';
import { fmt, median } from './stats.js';

/** Measured runs per check; the check is judged on their median. */
export const TIMING_RUNS = 5;
/** Runs before the measured ones, not counted: the first call pays for compiling the code. */
export const WARMUP_RUNS = 1;
/**
 * The default suite holds a median, in CPU time, to this many times its budget. The budget itself,
 * on the wall clock, is held by the strict job (PERF_STRICT=1).
 */
export const DEFAULT_CEILING_FACTOR = 3;

type Env = Record<string, string | undefined>;

/** Whether this run holds medians to their budgets rather than the default ceiling. */
export function isStrict(env: Env = process.env): boolean {
  return env.PERF_STRICT === '1';
}

export interface Clock {
  name: 'CPU time' | 'wall-clock time';
  /** Milliseconds. */
  now: () => number;
}

/**
 * The clock a check reads. The default suite reads CPU time, user plus system, because the wall
 * clock measures the machine as well as the code: on a loaded machine a function waits for a core,
 * and only the wall clock counts the wait. PERF_STRICT=1 reads the wall clock, the time a reader
 * waits, which is what a budget promises. `process.cpuUsage()` counts every thread of the process,
 * so CPU time is refused inside a worker thread (vitest's `threads` pool); the suites run in the
 * default `forks` pool.
 */
export function clockFor(env: Env = process.env, mainThread: boolean = isMainThread): Clock {
  if (isStrict(env)) return { name: 'wall-clock time', now: () => performance.now() };
  if (!mainThread) {
    throw new Error(
      'CPU time in a worker thread counts every thread of the process; run this suite in the forks pool.',
    );
  }
  return {
    name: 'CPU time',
    now: () => {
      const { user, system } = process.cpuUsage();
      return (user + system) / 1000;
    },
  };
}

interface Options {
  /** Milliseconds; injected by tests in place of the clock clockFor picks. */
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
 * Runs `fn` WARMUP_RUNS times, then TIMING_RUNS times on the clock clockFor picks, and throws
 * unless the median of those runs is under the limit: the budget, on the wall clock, under
 * PERF_STRICT=1; DEFAULT_CEILING_FACTOR times it, in CPU time, otherwise. The samples are recorded
 * to PERF_SAMPLES_DIR, when set, pass or fail.
 */
export function expectWithinBudget<T>(
  name: string,
  fn: () => T,
  { budgetMs, now, env = process.env }: BudgetOptions,
): BudgetResult<T> {
  const strict = isStrict(env);
  const clock = clockFor(env);
  const read = now ?? clock.now;
  const limitMs = strict ? budgetMs : budgetMs * DEFAULT_CEILING_FACTOR;
  const warmups = Array.from({ length: WARMUP_RUNS }, () => timed(fn, read).ms);
  const runs = Array.from({ length: TIMING_RUNS }, () => timed(fn, read));
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
      `${name}: median ${fmt(mid)} ms of ${clock.name} over ${TIMING_RUNS} runs is not under ${against}. ` +
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
 * throws unless the median of `measured` is under `limit(median of reference)`, on the clock
 * clockFor picks. Interleaving puts both sides under the same load, so the comparison has no
 * ceiling factor.
 */
export function expectWithinRelative(
  name: string,
  { measured, reference }: { measured: () => unknown; reference: () => unknown },
  { limit, rule, now, env = process.env }: RelativeOptions,
): { measured: number[]; reference: number[] } {
  const clock = clockFor(env);
  const read = now ?? clock.now;
  for (let i = 0; i < WARMUP_RUNS; i++) {
    measured();
    reference();
  }
  const m: number[] = [];
  const r: number[] = [];
  for (let i = 0; i < TIMING_RUNS; i++) {
    m.push(timed(measured, read).ms);
    r.push(timed(reference, read).ms);
  }
  const bound = limit(median(r));
  if (!(median(m) < bound)) {
    throw new Error(
      `${name}: median ${fmt(median(m))} ms of ${clock.name} is not under ${fmt(bound)} ms (${rule}). ` +
        `Measured: ${list(m)}; reference: ${list(r)}, median ${fmt(median(r))} ms.`,
    );
  }
  return { measured: m, reference: r };
}
