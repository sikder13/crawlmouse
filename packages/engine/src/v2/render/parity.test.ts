import { describe, expect, it } from 'vitest';
import { PARITY_SPREAD, REPEAT_SPREAD, spread, within } from './parity.js';

describe('the spreads', () => {
  it('are 2 % between two renders of one page and 5 % between the two sides of a static page', () => {
    expect([REPEAT_SPREAD, PARITY_SPREAD]).toEqual([0.02, 0.05]);
  });
});

describe('spread', () => {
  it('is the difference over the larger count', () => {
    expect(spread(100, 98)).toBeCloseTo(0.02, 12);
    expect(spread(98, 100)).toBeCloseTo(0.02, 12);
    expect(spread(0, 0)).toBe(0);
    expect(spread(0, 10)).toBe(1);
  });
});

describe('within', () => {
  it.each([
    [100, 98, REPEAT_SPREAD, true],
    [100, 97, REPEAT_SPREAD, false],
    [100, 95, PARITY_SPREAD, true],
    [100, 94, PARITY_SPREAD, false],
    [1000, 980, REPEAT_SPREAD, true],
    [1000, 979, REPEAT_SPREAD, false],
  ])('%i and %i within %f is %s', (a, b, bound, ok) => {
    expect(within(a, b, bound)).toBe(ok);
  });
});
