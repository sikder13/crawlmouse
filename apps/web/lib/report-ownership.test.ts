import { describe, it, expect } from 'vitest';
import { isDomainVerifiedForUser } from './report-ownership';

// SPEC 04 §9/§8 — ownership is re-derived from domain_verifications on EVERY mutating write (there is
// no claimed_by column; §11 keeps user ids off the report). "Verified" = verified_at IS NOT NULL for
// (user_id, domain). The exact filter set IS the security boundary — a dropped filter is an ownership
// bypass, so these tests pin the query shape, not just the boolean.

type Filter = [string, ...unknown[]];
function makeSb(result: { data: unknown; error?: unknown }) {
  const record: { table?: string; filters: Filter[] } = { filters: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: (...a: unknown[]) => { record.filters.push(['select', ...a]); return chain; },
    eq: (...a: unknown[]) => { record.filters.push(['eq', ...a]); return chain; },
    not: (...a: unknown[]) => { record.filters.push(['not', ...a]); return chain; },
    maybeSingle: () => Promise.resolve(result),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = { from: (t: string) => { record.table = t; return chain; } };
  return { sb, record };
}

describe('isDomainVerifiedForUser', () => {
  it('returns true when a verified domain_verifications row exists for (user, domain)', async () => {
    const { sb, record } = makeSb({ data: { id: 'v-1' } });
    const ok = await isDomainVerifiedForUser(sb, 'u-1', 'ex.com');
    expect(ok).toBe(true);
    expect(record.table).toBe('domain_verifications');
    // the three filters that together prove ownership — dropping any one is a bypass
    expect(record.filters).toContainEqual(['eq', 'user_id', 'u-1']);
    expect(record.filters).toContainEqual(['eq', 'domain', 'ex.com']);
    expect(record.filters).toContainEqual(['not', 'verified_at', 'is', null]);
  });

  it('returns false when no verified row exists (unverified, or a different domain/user)', async () => {
    const { sb } = makeSb({ data: null });
    expect(await isDomainVerifiedForUser(sb, 'u-1', 'ex.com')).toBe(false);
  });
});
