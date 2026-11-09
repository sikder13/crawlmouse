import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-F1: the daily cleanup also prunes rate_limits, through public.prune_rate_limits (the SQL is
// pinned on PGlite by apps/web/__tests__/rate-limits-prune.test.ts). Here: the loop's bounds, and
// that cleanupExpiredAuditsFn runs it as its own step.

const { rpc, deleteExpiredAudits } = vi.hoisted(() => ({
  rpc: vi.fn(),
  deleteExpiredAudits: vi.fn(async () => ({ deleted: 0, drained: true, iterations: 0 })),
}));
vi.mock('./supabase', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('./billing-helpers', async (orig) => ({
  ...(await orig<typeof import('./billing-helpers')>()),
  deleteExpiredAudits,
}));

import { cleanupExpiredAuditsFn } from './billing';
import { PRUNE_BATCH, PRUNE_MAX_CALLS, pruneRateLimits } from './rate-limit-retention';

/** An rpc that deletes from a pool of `rows`, as the SQL does: at most min(p_limit, 5000). */
function pool(rows: number) {
  let left = rows;
  return vi.fn(async (name: string, args: { p_limit: number }) => {
    expect(name).toBe('prune_rate_limits');
    const n = Math.min(left, Math.max(Math.min(args.p_limit, 5000), 0));
    left -= n;
    return { data: n, error: null };
  });
}

describe('pruneRateLimits', () => {
  it('calls in batches of 5000 until a call deletes fewer', async () => {
    const fake = pool(12_345);
    expect(await pruneRateLimits({ rpc: fake })).toEqual({
      deleted: 12_345,
      calls: 3,
      drained: true,
    });
    expect(fake.mock.calls.map((c) => c[1])).toEqual(Array(3).fill({ p_limit: PRUNE_BATCH }));
  });

  it('stops after PRUNE_MAX_CALLS and says the table is not drained', async () => {
    const fake = pool(PRUNE_BATCH * (PRUNE_MAX_CALLS + 1));
    expect(await pruneRateLimits({ rpc: fake })).toEqual({
      deleted: PRUNE_BATCH * PRUNE_MAX_CALLS,
      calls: PRUNE_MAX_CALLS,
      drained: false,
    });
  });

  it('a second run deletes nothing new', async () => {
    const fake = pool(7);
    await pruneRateLimits({ rpc: fake });
    expect(await pruneRateLimits({ rpc: fake })).toEqual({ deleted: 0, calls: 1, drained: true });
  });

  it('stops exactly when a full batch empties the table', async () => {
    const fake = pool(PRUNE_BATCH);
    expect(await pruneRateLimits({ rpc: fake })).toEqual({
      deleted: PRUNE_BATCH,
      calls: 2,
      drained: true,
    });
  });

  it('throws the rpc error, so the step retries', async () => {
    const failing = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    await expect(pruneRateLimits({ rpc: failing })).rejects.toThrow(/boom/);
  });
});

describe('cleanupExpiredAuditsFn', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(pool(3));
    deleteExpiredAudits.mockClear();
  });

  it('deletes expired audits, then prunes rate_limits in a step of its own', async () => {
    const ids: string[] = [];
    const step = {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ids.push(id);
        return fn();
      },
    };
    const out = await (
      cleanupExpiredAuditsFn as unknown as { fn: (ctx: unknown) => Promise<unknown> }
    ).fn({ step });
    expect(ids).toEqual(['delete-expired', 'prune-rate-limits']);
    expect(deleteExpiredAudits).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('prune_rate_limits', { p_limit: PRUNE_BATCH });
    expect(out).toEqual({
      audits: { deleted: 0, drained: true, iterations: 0 },
      rateLimits: { deleted: 3, calls: 1, drained: true },
    });
  });
});
