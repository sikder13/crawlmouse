import { describe, expect, it } from 'vitest';
import {
  CHECK_CONCURRENCY_DEFAULT,
  PLAN_CONCURRENCY_CAP,
  checkConcurrencyLimit,
  planSafeLimit,
} from './concurrency';

// Inngest refuses the whole app sync when a function declares a concurrency limit above the
// account plan's cap (Free: 5), and then no function runs (PROJECT_OVERVIEW §11).
describe('planSafeLimit', () => {
  it('is the Free plan cap', () => {
    expect(PLAN_CONCURRENCY_CAP).toBe(5);
  });

  it('takes a whole number from 1 to the cap as given', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(planSafeLimit(String(n), 3)).toBe(n);
  });

  it('clamps a whole number above the cap to the cap', () => {
    for (const raw of ['6', '50', '100', '1000', '1000000']) {
      expect(planSafeLimit(raw, 3)).toBe(PLAN_CONCURRENCY_CAP);
    }
  });

  it('falls back for unset, empty, zero, negative, fractional or non-numeric values', () => {
    for (const raw of [undefined, '', '0', '-1', '5.5', 'abc', 'NaN', 'Infinity']) {
      expect(planSafeLimit(raw, 3)).toBe(3);
    }
  });
});

describe('checkConcurrencyLimit', () => {
  it('defaults to 2, leaving the rest of the cap to v1 audits', () => {
    expect(CHECK_CONCURRENCY_DEFAULT).toBe(2);
    expect(checkConcurrencyLimit({})).toBe(2);
    expect(checkConcurrencyLimit({ INNGEST_CHECK_CONCURRENCY: 'abc' })).toBe(2);
  });

  it('reads INNGEST_CHECK_CONCURRENCY, clamped to the cap', () => {
    expect(checkConcurrencyLimit({ INNGEST_CHECK_CONCURRENCY: '1' })).toBe(1);
    expect(checkConcurrencyLimit({ INNGEST_CHECK_CONCURRENCY: '5' })).toBe(5);
    expect(checkConcurrencyLimit({ INNGEST_CHECK_CONCURRENCY: '6' })).toBe(5);
  });
});
