import { describe, expect, it } from 'vitest';
import { SLICE_US, busyPerSlice, quantile } from './busy';

const S = SLICE_US;

describe('busyPerSlice', () => {
  it('puts a task inside one slice in that slice', () => {
    expect(busyPerSlice([{ ts: 1_000, dur: 5_000 }], 0, 3 * S)).toEqual([5, 0, 0]);
  });

  it('splits a task across the slice edges it crosses', () => {
    // 10 ms from 10 ms in: 6.67 ms in the first slice, 3.33 in the second.
    const got = busyPerSlice([{ ts: 10_000, dur: 10_000 }], 0, 2 * S);
    expect(got[0]).toBeCloseTo(S / 1000 - 10, 9);
    expect(got[1]).toBeCloseTo(20 - S / 1000, 9);
  });

  it('clips what lies outside the window', () => {
    expect(busyPerSlice([{ ts: -5_000, dur: 10_000 }], 0, S)).toEqual([5]);
    expect(busyPerSlice([{ ts: S - 1_000, dur: 50_000 }], 0, S)).toEqual([1]);
    expect(busyPerSlice([{ ts: 2 * S, dur: 1_000 }], 0, S)).toEqual([0]);
  });

  it('ends on window edges that do not divide into whole slices', () => {
    // The edge that once looped for ever: a window starting off the slice grid, in trace microseconds.
    const from = 179_442_352_123.4;
    const tasks = [{ ts: from + 7 * S - 0.0001, dur: 3 * S }];
    const got = busyPerSlice(tasks, from, from + 12_000_000);
    expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo((3 * S) / 1000, 6);
  });

  // A seeded sweep over random windows and tasks: the total is the clipped durations' sum,
  // computed here without slices, and the slice count follows the span.
  it('keeps every microsecond of work in the window, over 500 generated windows', () => {
    let seed = 0x2f6b1d;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    for (let k = 0; k < 500; k++) {
      const from = rand() * 1e12;
      const span = 1 + Math.floor(rand() * 2_000_000);
      const tasks = Array.from({ length: Math.floor(rand() * 40) }, () => ({
        ts: from - 100_000 + rand() * (span + 200_000),
        dur: rand() * 400_000,
      }));
      const got = busyPerSlice(tasks, from, from + span);
      const want = tasks.reduce(
        (sum, t) =>
          sum + Math.max(0, Math.min(t.ts + t.dur, from + span) - Math.max(t.ts, from)) / 1000,
        0,
      );
      expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo(want, 2);
      expect(got).toHaveLength(Math.max(1, Math.ceil(span / S)));
    }
  });

  it('reads twice the busy time when every task takes twice as long', () => {
    const one = busyPerSlice(
      [
        { ts: 1_000, dur: 3_000 },
        { ts: 40_000, dur: 2_000 },
      ],
      0,
      4 * S,
    );
    const two = busyPerSlice(
      [
        { ts: 1_000, dur: 6_000 },
        { ts: 40_000, dur: 4_000 },
      ],
      0,
      4 * S,
    );
    expect(two).toEqual(one.map((x) => 2 * x));
  });
});

describe('quantile', () => {
  it('takes the nearest rank below', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(quantile(xs, 0.95)).toBe(20);
    expect(quantile(xs, 0.5)).toBe(11);
    expect(quantile([3, 1, 2], 0)).toBe(1);
    expect(quantile([3, 1, 2], 1)).toBe(3);
  });

  it('refuses no readings', () => {
    expect(() => quantile([], 0.95)).toThrow(/no readings/);
  });
});
