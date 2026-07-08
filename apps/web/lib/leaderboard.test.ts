import { describe, it, expect } from 'vitest';
import { fetchLeaderboardReports, countLeaderboardReports } from './leaderboard';

// SPEC 04 §8/§9 — the leaderboard is a public surface, so it must exclude HIDDEN reports (hide is
// honored everywhere). Deploy-order-safe: pre-Runbook-B (hidden_at absent) fall back to today's
// query (nothing can be hidden yet). NOTE: the CLAIMED-only gating (unclaimed → unlisted) is Stage C;
// this helper adds only the hide exclusion that ships with hide in Stage B.

function fakeSb(behaviour: { withHidden?: { data?: unknown; count?: number; error?: { code?: string } | null }; legacy?: { data?: unknown; count?: number } }) {
  const make = () => {
    let hiddenFiltered = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain, eq: () => chain, not: () => chain, order: () => chain, limit: () => chain,
      is: (col: string) => { if (col === 'hidden_at') hiddenFiltered = true; return chain; },
      then: (resolve: (v: unknown) => void) => resolve(hiddenFiltered ? (behaviour.withHidden ?? { data: null, count: null, error: null }) : { ...(behaviour.legacy ?? {}), error: null }),
    };
    return chain;
  };
  return { from: () => make() };
}

describe('fetchLeaderboardReports', () => {
  it('excludes hidden reports (filters hidden_at is null) when the column exists', async () => {
    const sb = fakeSb({ withHidden: { data: [{ slug: 'a', domain: 'x', grade: 'A', score: 90 }], error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchLeaderboardReports(sb as any, 'shopify', 50);
    expect(rows).toHaveLength(1);
  });

  it('falls back to the legacy query on an undefined-column error (pre-Runbook-B — badge/board keep working)', async () => {
    const sb = fakeSb({ withHidden: { error: { code: '42703' } }, legacy: { data: [{ slug: 'legacy', domain: 'y', grade: 'B', score: 80 }] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchLeaderboardReports(sb as any, 'shopify', 50);
    expect(rows[0]!.slug).toBe('legacy');
  });

  it('returns [] on a transient error (never a wrong board)', async () => {
    const sb = fakeSb({ withHidden: { error: { code: '57014' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await fetchLeaderboardReports(sb as any, 'shopify', 50)).toEqual([]);
  });
});

describe('countLeaderboardReports', () => {
  it('counts non-hidden reports; falls back pre-migration; 0 on transient error', async () => {
    const withHidden = fakeSb({ withHidden: { count: 12, error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await countLeaderboardReports(withHidden as any, 'shopify')).toBe(12);
    const pre = fakeSb({ withHidden: { error: { code: 'PGRST204' } }, legacy: { count: 7 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await countLeaderboardReports(pre as any, 'shopify')).toBe(7);
    const blip = fakeSb({ withHidden: { error: { code: '57014' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await countLeaderboardReports(blip as any, 'shopify')).toBe(0);
  });
});
