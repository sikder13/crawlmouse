import { describe, it, expect } from 'vitest';
import { isProActive } from './pro';

describe('isProActive', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('is true when pro_until is in the future', () => {
    expect(isProActive('2026-07-01T00:00:00Z', now)).toBe(true);
  });
  it('is false when pro_until is in the past', () => {
    expect(isProActive('2026-05-01T00:00:00Z', now)).toBe(false);
  });
  it('is false when pro_until is null/undefined', () => {
    expect(isProActive(null, now)).toBe(false);
    expect(isProActive(undefined, now)).toBe(false);
  });
});
