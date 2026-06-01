import { describe, it, expect } from 'vitest';
import { tierLimits } from './tier';

describe('tierLimits', () => {
  it('free = 500 pages, sequential', () => {
    expect(tierLimits(false)).toEqual({ pageCap: 500, perHostConcurrency: 1 });
  });
  it('pro = 2000 pages, concurrent', () => {
    expect(tierLimits(true)).toEqual({ pageCap: 2000, perHostConcurrency: 8 });
  });
});
