import { describe, expect, it } from 'vitest';
import {
  AUDIT_CONCURRENCY_DEFAULT,
  CHECK_CONCURRENCY_DEFAULT,
  PLAN_CONCURRENCY_CAP,
  WORKER_BATCH_SLOTS,
  checkConcurrencyLimit,
  planSafeLimit,
} from './concurrency';

// Inngest refuses the whole app sync when a function declares a concurrency limit above the
// account plan's cap, and then no function runs (PROJECT_OVERVIEW §11).
describe('planSafeLimit', () => {
  it('is the Pro plan cap, 100 concurrent steps', () => {
    expect(PLAN_CONCURRENCY_CAP).toBe(100);
  });

  it('takes a whole number from 1 to the cap as given', () => {
    for (const n of [1, 2, 5, 16, 50, 99, 100]) expect(planSafeLimit(String(n), 3)).toBe(n);
  });

  it('clamps a whole number above the cap to the cap', () => {
    for (const raw of ['101', '500', '1000', '1000000']) {
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
  it('defaults to the production worker’s batch slots', () => {
    expect(WORKER_BATCH_SLOTS).toBe(16);
    expect(CHECK_CONCURRENCY_DEFAULT).toBe(WORKER_BATCH_SLOTS);
    expect(checkConcurrencyLimit({})).toBe(16);
    expect(checkConcurrencyLimit({ INNGEST_CHECK_CONCURRENCY: 'abc' })).toBe(16);
  });

  it('reads INNGEST_CHECK_CONCURRENCY, clamped to the cap', () => {
    expect(checkConcurrencyLimit({ INNGEST_CHECK_CONCURRENCY: '1' })).toBe(1);
    expect(checkConcurrencyLimit({ INNGEST_CHECK_CONCURRENCY: '40' })).toBe(40);
    expect(checkConcurrencyLimit({ INNGEST_CHECK_CONCURRENCY: '101' })).toBe(100);
  });
});

describe('the defaults, against what the account allows', () => {
  it('keeps v1 audits at the 5 they have run at, not the new cap', () => {
    expect(AUDIT_CONCURRENCY_DEFAULT).toBe(5);
  });

  it('declares no default above the plan cap, alone or together', () => {
    expect(CHECK_CONCURRENCY_DEFAULT + AUDIT_CONCURRENCY_DEFAULT).toBeLessThanOrEqual(
      PLAN_CONCURRENCY_CAP,
    );
  });
});
