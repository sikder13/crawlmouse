import { describe, it, expect } from 'vitest';
import { asNumber } from './numeric';

describe('asNumber', () => {
  it('coerces a PostgREST numeric string to a number', () => {
    // Postgres numeric(5,2) is serialized by PostgREST as a JSON string.
    expect(asNumber('87.50')).toBe(87.5);
  });

  it('passes a real number through', () => {
    expect(asNumber(87.5)).toBe(87.5);
  });

  it('treats 0 and "0" as the number 0 (not falsy-null)', () => {
    expect(asNumber(0)).toBe(0);
    expect(asNumber('0')).toBe(0);
  });

  it('returns null for null/undefined/empty', () => {
    expect(asNumber(null)).toBeNull();
    expect(asNumber(undefined)).toBeNull();
    expect(asNumber('')).toBeNull();
    expect(asNumber('   ')).toBeNull();
  });

  it('returns null for non-numeric or non-finite values', () => {
    expect(asNumber('abc')).toBeNull();
    expect(asNumber(NaN)).toBeNull();
    expect(asNumber(Infinity)).toBeNull();
    expect(asNumber({})).toBeNull();
  });
});
