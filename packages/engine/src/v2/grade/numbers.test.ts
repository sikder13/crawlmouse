import { describe, expect, it } from 'vitest';
import { median, round } from './numbers.js';

describe('round', () => {
  it('rounds a decimal half away from zero, including halves binary floating point stores just under', () => {
    expect([1.005, 0.145, 1.255, 2.675, 0.005].map(round)).toEqual([1.01, 0.15, 1.26, 2.68, 0.01]);
    expect([-1.005, -0.145].map(round)).toEqual([-1.01, -0.15]);
  });

  it('every decimal half from 0 to 100, in hundredths, rounds up', () => {
    const down: number[] = [];
    for (let k = 0; k < 10_000; k++) {
      const half = Number(`${Math.floor(k / 100)}.${String(k % 100).padStart(2, '0')}5`);
      const expected = (k + 1) / 100;
      if (round(half) !== Number(expected.toFixed(2))) down.push(half);
    }
    expect(down).toEqual([]);
  });

  it('leaves two-decimal values as they are', () => {
    expect([26.67, 14.7, 0, 100].map(round)).toEqual([26.67, 14.7, 0, 100]);
  });
});

describe('median', () => {
  it('is the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([0.4, 0.2])).toBeCloseTo(0.3, 12);
  });
});
