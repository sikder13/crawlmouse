import { describe, it, expect } from 'vitest';
import { readLatestVisibleReport } from './badge-report';

// SPEC 04 §3/§9 — the embed badge must resolve a VISIBLE report only: not taken down and not HIDDEN.
// Deploy-order-safe: pre-Runbook-B (hidden_at column absent) fall back so the badge keeps working
// (nothing can be hidden yet — hide returns 503 without the column).

function fakeSb(behaviour: { withHidden?: { data?: unknown; error?: { code?: string } | null }; legacy?: { data?: unknown } }) {
  let hiddenFiltered = false;
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain, // .not('claimed_at', 'is', null) — the claim gate
    is: (col: string) => { if (col === 'hidden_at') hiddenFiltered = true; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(hiddenFiltered ? (behaviour.withHidden ?? { data: null, error: null }) : { data: behaviour.legacy?.data ?? null, error: null }),
  };
  return { from: () => { hiddenFiltered = false; return chain; } };
}

describe('readLatestVisibleReport (badge)', () => {
  it('resolves a claimed, non-hidden report when the columns exist', async () => {
    const sb = fakeSb({ withHidden: { data: { slug: 's', grade: 'B', score: '80' }, error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await readLatestVisibleReport(sb as any, 'ex.com');
    expect(r?.slug).toBe('s');
  });

  it('falls back (no hidden_at filter) on an undefined-column error — badge keeps working pre-migration', async () => {
    const sb = fakeSb({ withHidden: { error: { code: '42703' } }, legacy: { data: { slug: 'legacy', grade: 'C', score: '60' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await readLatestVisibleReport(sb as any, 'ex.com');
    expect(r?.slug).toBe('legacy');
  });

  it('returns null on a transient (non-undefined-column) error — never a bad badge', async () => {
    const sb = fakeSb({ withHidden: { error: { code: '57014' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await readLatestVisibleReport(sb as any, 'ex.com');
    expect(r).toBeNull();
  });
});
