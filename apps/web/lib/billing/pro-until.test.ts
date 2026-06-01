import { describe, it, expect } from 'vitest';
import { proUntilFrom } from './pro-until';

const periodEnd = 1782000000; // unix seconds

describe('proUntilFrom', () => {
  it('returns ISO period end for active/trialing/past_due', () => {
    expect(proUntilFrom('active', periodEnd)).toBe(new Date(periodEnd * 1000).toISOString());
    expect(proUntilFrom('trialing', periodEnd)).toBe(new Date(periodEnd * 1000).toISOString());
    expect(proUntilFrom('past_due', periodEnd)).toBe(new Date(periodEnd * 1000).toISOString());
  });
  it('returns null for canceled/unpaid/incomplete or missing period end', () => {
    expect(proUntilFrom('canceled', periodEnd)).toBeNull();
    expect(proUntilFrom('unpaid', periodEnd)).toBeNull();
    expect(proUntilFrom('active', null)).toBeNull();
  });
});
