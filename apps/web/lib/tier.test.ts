import { describe, it, expect } from 'vitest';
import { tierLimits, tierLimitsFor } from './tier';

describe('tierLimits', () => {
  it('free = 500 pages, sequential', () => {
    expect(tierLimits(false)).toEqual({ pageCap: 500, perHostConcurrency: 1 });
  });
  it('pro = 2000 pages, concurrent', () => {
    expect(tierLimits(true)).toEqual({ pageCap: 2000, perHostConcurrency: 8 });
  });
});

describe('tierLimitsFor (agency seam)', () => {
  it('free → free crawl limits', () => {
    expect(tierLimitsFor('free')).toEqual(tierLimits(false));
  });
  it('pro → pro crawl limits', () => {
    expect(tierLimitsFor('pro')).toEqual(tierLimits(true));
  });
  it('agency mirrors pro this phase (dormant seam)', () => {
    expect(tierLimitsFor('agency')).toEqual(tierLimits(true));
  });
});
