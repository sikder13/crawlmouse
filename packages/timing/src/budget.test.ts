import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CEILING_FACTOR,
  TIMING_RUNS,
  WARMUP_RUNS,
  expectWithinBudget,
  expectWithinRelative,
  isStrict,
} from './budget.js';
import { fmt, median } from './stats.js';

/**
 * A clock the measured function moves by the next duration in `durations`, so each run takes
 * exactly the time the test says it does.
 */
function scripted(durations: number[]) {
  let t = 0;
  let i = 0;
  return {
    now: () => t,
    work: () => {
      const d = durations[i++];
      if (d === undefined) throw new Error(`run ${i} has no scripted duration`);
      t += d;
      return i;
    },
    calls: () => i,
  };
}

describe('median', () => {
  it('takes the middle of an odd count and the mean of the middle two of an even one', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('formats a small value without rounding it to zero', () => {
    expect([fmt(0.001), fmt(0.0333), fmt(16.8), fmt(1041.1749), fmt(0)]).toEqual([
      '0.001',
      '0.0333',
      '16.8',
      '1041.17',
      '0',
    ]);
  });

  it('refuses an empty list rather than reading a median of nothing', () => {
    expect(() => median([])).toThrow(/no samples/);
  });

  it('does not reorder the list it is given', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('the rule', () => {
  it('is five runs after one warm-up, with a ceiling of three times the budget', () => {
    expect([TIMING_RUNS, WARMUP_RUNS, DEFAULT_CEILING_FACTOR]).toEqual([5, 1, 3]);
  });

  it('is strict only when PERF_STRICT is exactly 1', () => {
    expect(isStrict({ PERF_STRICT: '1' })).toBe(true);
    for (const v of [undefined, '', '0', 'true', ' 1', 'yes']) {
      expect(isStrict({ PERF_STRICT: v }), String(v)).toBe(false);
    }
  });
});

describe('expectWithinBudget', () => {
  it('runs the warm-up and then TIMING_RUNS measured runs, and returns every run value', () => {
    const c = scripted([999, 1, 2, 3, 4, 5]);
    const r = expectWithinBudget('x', c.work, { budgetMs: 10, now: c.now, env: {} });
    expect(c.calls()).toBe(WARMUP_RUNS + TIMING_RUNS);
    expect(r.samples).toEqual([1, 2, 3, 4, 5]);
    expect(r.values).toEqual([2, 3, 4, 5, 6]);
    expect(r.median).toBe(3);
  });

  it('judges the median, so two slow runs out of five do not fail it', () => {
    const c = scripted([0, 900, 9, 9, 900, 9]);
    expect(() =>
      expectWithinBudget('x', c.work, { budgetMs: 10, now: c.now, env: { PERF_STRICT: '1' } }),
    ).not.toThrow();
  });

  it('fails when three runs out of five are over, and the warm-up is not one of the five', () => {
    const c = scripted([0, 11, 11, 11, 1, 1]);
    expect(() =>
      expectWithinBudget('x', c.work, { budgetMs: 10, now: c.now, env: { PERF_STRICT: '1' } }),
    ).toThrow(/median 11 ms/);
    const warm = scripted([10_000, 1, 1, 1, 1, 1]);
    expect(() =>
      expectWithinBudget('x', warm.work, {
        budgetMs: 10,
        now: warm.now,
        env: { PERF_STRICT: '1' },
      }),
    ).not.toThrow();
  });

  it('holds the default suite to the ceiling and PERF_STRICT=1 to the budget itself', () => {
    const at = (ms: number, env: Record<string, string | undefined>) => {
      const c = scripted([0, ms, ms, ms, ms, ms]);
      return () => expectWithinBudget('x', c.work, { budgetMs: 100, now: c.now, env });
    };
    expect(at(250, {})).not.toThrow();
    expect(at(300, {})).toThrow(/ceiling of 300 ms/);
    expect(at(99, { PERF_STRICT: '1' })).not.toThrow();
    expect(at(100, { PERF_STRICT: '1' })).toThrow(/budget of 100 ms/);
  });

  it('names every sample, the warm-up and the limit when it fails', () => {
    const c = scripted([40, 31.25, 32, 33, 34, 35]);
    let message = '';
    try {
      expectWithinBudget('the layout', c.work, { budgetMs: 10, now: c.now, env: {} });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('the layout');
    expect(message).toContain('31.25, 32, 33, 34, 35 ms');
    expect(message).toContain('warm-up 40 ms');
    expect(message).toContain('3 × the 10 ms budget');
  });

  it('appends its samples to PERF_SAMPLES_DIR as one JSON line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timing-'));
    const c = scripted([0, 1, 2, 3, 4, 5]);
    expectWithinBudget('m', c.work, { budgetMs: 10, now: c.now, env: { PERF_SAMPLES_DIR: dir } });
    const lines = readFileSync(join(dir, 'samples.jsonl'), 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { metric: 'm', unit: 'ms', median: 3, limit: 30, pass: true, samples: [1, 2, 3, 4, 5] },
    ]);
  });

  it('records the samples when it fails too, so a breach reaches the trend', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timing-'));
    const c = scripted([0, 50, 50, 50, 50, 50]);
    expect(() =>
      expectWithinBudget('m', c.work, {
        budgetMs: 10,
        now: c.now,
        env: { PERF_SAMPLES_DIR: dir },
      }),
    ).toThrow();
    expect(JSON.parse(readFileSync(join(dir, 'samples.jsonl'), 'utf8'))).toMatchObject({
      median: 50,
      pass: false,
    });
  });

  it('measures real work on the real clock', () => {
    const r = expectWithinBudget(
      'a busy loop',
      () => {
        const until = performance.now() + 5;
        while (performance.now() < until);
      },
      { budgetMs: 1_000, env: {} },
    );
    expect(Math.min(...r.samples)).toBeGreaterThanOrEqual(5);
  });
});

describe('expectWithinRelative', () => {
  /** Two functions on one clock: `measured` and `reference` take the next duration from their own list. */
  function pair(measured: number[], reference: number[]) {
    let t = 0;
    const order: string[] = [];
    const step = (xs: number[], name: string) => () => {
      order.push(name);
      const d = xs.shift();
      if (d === undefined) throw new Error(`${name} has no scripted duration`);
      t += d;
    };
    return {
      now: () => t,
      measured: step(measured, 'm'),
      reference: step(reference, 'r'),
      order,
    };
  }

  it('interleaves the two, after a warm-up of each', () => {
    const p = pair([0, 1, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1]);
    expectWithinRelative('x', p, { limit: (ref) => ref * 2, rule: 'twice', now: p.now });
    expect(p.order.join('')).toBe('mrmrmrmrmrmr');
  });

  it('compares the median of one against the limit drawn from the median of the other', () => {
    const ok = pair([0, 1, 30, 9, 9, 9], [0, 2, 5, 5, 5, 1]);
    expect(() =>
      expectWithinRelative('x', ok, { limit: (ref) => ref * 2, rule: 'twice', now: ok.now }),
    ).not.toThrow();
    const over = pair([0, 10, 10, 10, 1, 1], [0, 5, 5, 5, 5, 5]);
    expect(() =>
      expectWithinRelative('x', over, { limit: (ref) => ref * 2, rule: 'twice', now: over.now }),
    ).toThrow(/median 10 ms is not under 10 ms \(twice\)/);
  });

  it('names both sets of samples when it fails', () => {
    const p = pair([0, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5]);
    expect(() =>
      expectWithinRelative('nested', p, { limit: (ref) => ref, rule: 'no slower', now: p.now }),
    ).toThrow(/7, 8, 9, 10, 11 ms[^]*1, 2, 3, 4, 5 ms/);
  });
});
