import { describe, it, expect } from 'vitest';
import { readLatestVisibleReport } from './badge-report';

// SPEC 04 §3/§7/§9 (V6) — the embed badge must resolve a CLAIMED, VISIBLE report only: claimed by a
// domain-verified owner, not taken down, not hidden. Claimed-only is the §7 badge-integrity guarantee —
// a third party's fresh UNCLAIMED mint (claimed_at null) can't silently change a domain's badge. The
// recording mock value-pins the filter set (the gate is the query, not the arity). Deploy-order-safe:
// pre-Runbook-B (columns absent, 42703) fall back so the badge keeps working (nothing is claimed/hidden
// distinctly yet — every pre-existing report was minted under mandatory verification).

type Filter = [string, ...unknown[]];
function makeSb(opts: { gated?: { data?: unknown; error?: unknown }; legacy?: { data?: unknown; error?: unknown } }) {
  const filters: Filter[] = [];
  const make = () => {
    let sawNot = false; // the gated build calls .not('claimed_at','is',null); the legacy fallback does not
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: (...a: unknown[]) => { filters.push(['eq', ...a]); return chain; },
      is: (...a: unknown[]) => { filters.push(['is', ...a]); return chain; },
      not: (...a: unknown[]) => { filters.push(['not', ...a]); sawNot = true; return chain; },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(sawNot ? (opts.gated ?? { data: null, error: null }) : (opts.legacy ?? { data: null, error: null })),
    };
    return chain;
  };
  return { sb: { from: () => make() }, filters };
}

describe('readLatestVisibleReport (badge)', () => {
  it('resolves a claimed, non-hidden report AND gates on claimed_at + hidden_at + takedown (§7 integrity)', async () => {
    const { sb, filters } = makeSb({ gated: { data: { slug: 's', grade: 'B', score: '80' }, error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await readLatestVisibleReport(sb as any, 'ex.com');
    expect(r?.slug).toBe('s');
    expect(filters).toContainEqual(['eq', 'domain', 'ex.com']);
    expect(filters).toContainEqual(['is', 'takedown_requested_at', null]);
    expect(filters).toContainEqual(['not', 'claimed_at', 'is', null]); // V6: claimed-only badge integrity
    expect(filters).toContainEqual(['is', 'hidden_at', null]);
  });

  it('V6: a fresh unclaimed third-party mint does NOT surface — no claimed report → badge resolves null', async () => {
    const { sb } = makeSb({ gated: { data: null, error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await readLatestVisibleReport(sb as any, 'ex.com');
    expect(r).toBeNull();
  });

  it('falls back (no claim/hidden filter) on an undefined-column error — badge keeps working pre-migration', async () => {
    const { sb } = makeSb({ gated: { error: { code: '42703' } }, legacy: { data: { slug: 'legacy', grade: 'C', score: '60' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await readLatestVisibleReport(sb as any, 'ex.com');
    expect(r?.slug).toBe('legacy');
  });

  it('returns null on a transient (non-undefined-column) error — never a bad badge', async () => {
    const { sb } = makeSb({ gated: { error: { code: '57014' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await readLatestVisibleReport(sb as any, 'ex.com');
    expect(r).toBeNull();
  });
});
