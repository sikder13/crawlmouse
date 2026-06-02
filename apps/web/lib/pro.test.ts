import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isProActive, userIsPro } from './pro';

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
  it('is false at the exact-now boundary (strict greater-than)', () => {
    expect(isProActive(now.toISOString(), now)).toBe(false);
  });
  it('is false for a malformed date string (no throw)', () => {
    expect(isProActive('not-a-date', now)).toBe(false);
  });
});

// Fake the users-row read: sb.from('users').select('pro_until').eq('id', id).maybeSingle()
function fakeSb(row: { pro_until: string | null } | null): SupabaseClient {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
  } as unknown as SupabaseClient;
}

describe('userIsPro', () => {
  it('is true when the row has a future pro_until', async () => {
    expect(await userIsPro(fakeSb({ pro_until: '2999-01-01T00:00:00Z' }), 'u1')).toBe(true);
  });
  it('is false when the row has an expired pro_until', async () => {
    expect(await userIsPro(fakeSb({ pro_until: '2000-01-01T00:00:00Z' }), 'u1')).toBe(false);
  });
  it('is false when there is no row / null pro_until', async () => {
    expect(await userIsPro(fakeSb(null), 'u1')).toBe(false);
    expect(await userIsPro(fakeSb({ pro_until: null }), 'u1')).toBe(false);
  });
});
