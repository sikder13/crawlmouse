import { describe, it, expect, vi, beforeEach } from 'vitest';

const { purgePublicReport } = vi.hoisted(() => ({ purgePublicReport: vi.fn() }));
// Mock the report module so its `@/lib/supabase/admin` import is never evaluated
// (Vitest has no `@/` alias here). takedown.ts purges via purgePublicReport (single source of
// truth for the tag+path purge), so the mock exposes it and the test asserts on it directly.
vi.mock('./reports', () => ({ purgePublicReport }));

import { processTakedown } from './takedown';

// Per-table override: pass { public_reports: Error } or { takedown_requests: Error } to make that
// table's update return an error; the call is still recorded, in order. What the writes do to real
// rows is lib/takedown.db.test.ts; this file pins their shape, order and failure handling.
function makeSb(errs: { public_reports?: Error; takedown_requests?: Error } = {}) {
  type Call = {
    table: string;
    update?: Record<string, unknown>;
    filters: [string, string, unknown][];
    after?: string;
  };
  const calls: Call[] = [];
  const sb = {
    calls,
    from: (table: string) => {
      const rec: Call = { table, filters: [] };
      const chain = {
        select: () => chain,
        update: (patch: Record<string, unknown>) => {
          rec.update = patch;
          calls.push(rec);
          return chain;
        },
        eq: (col: string, val: unknown) => (rec.filters.push(['eq', col, val]), chain),
        is: (col: string, val: unknown) => (rec.filters.push(['is', col, val]), chain),
        in: (col: string, val: unknown) => (rec.filters.push(['in', col, val]), chain),
        order: () => chain,
        limit: () => chain,
        gte: (_col: string, val: string) => ((rec.after = val), chain),
        maybeSingle: async () => ({ data: { domain: 'taken.example' }, error: null }),
        then: (resolve: (r: unknown) => unknown) =>
          resolve(
            rec.update
              ? { error: errs[table as keyof typeof errs] ?? null }
              : {
                  data: rec.after ? [{ slug: rec.after }] : [{ slug: 'abc123' }, { slug: 'older' }],
                  error: null,
                },
          ),
      };
      return chain;
    },
  };
  return sb as unknown as Parameters<typeof processTakedown>[0] & { calls: Call[] };
}

describe('processTakedown', () => {
  beforeEach(() => {
    purgePublicReport.mockClear();
  });

  it('sets takedown_requested_at on the report, marks the request removed, and purges caches', async () => {
    const sb = makeSb();
    await processTakedown(sb, 'abc123');
    const reportUpdate = sb.calls.find((c) => c.table === 'public_reports');
    expect(reportUpdate?.update).toHaveProperty('takedown_requested_at');
    expect(reportUpdate?.filters).toEqual([
      ['eq', 'domain', 'taken.example'],
      ['is', 'takedown_requested_at', null],
    ]);
    // The report patch is an ISO timestamp.
    expect(typeof reportUpdate?.update?.takedown_requested_at).toBe('string');
    expect(() =>
      new Date(reportUpdate!.update!.takedown_requested_at as string).toISOString(),
    ).not.toThrow();
    const reqUpdate = sb.calls.find((c) => c.table === 'takedown_requests');
    // EXACT match (not toMatchObject): the write is { status: 'removed' } and NOTHING else —
    // a stray `processed_at` (the column does not exist on takedown_requests) or any extra
    // field would be caught here at the unit level before it fails against the live schema.
    expect(reqUpdate?.update).toEqual({ status: 'removed' });
    // The queue update is keyed on the host, and scoped to OPEN statuses so it advances
    // only undecided requests and never rewrites a decided ('rejected') row's moderation history.
    expect(reqUpdate?.filters).toEqual([
      ['eq', 'domain', 'taken.example'],
      ['in', 'status', ['pending', 'verified']],
    ]);
    expect(purgePublicReport).toHaveBeenCalledWith('abc123');
  });

  it('flips the report BEFORE purging the cache (purge must see the taken-down row)', async () => {
    const sb = makeSb();
    let reportFlippedBeforePurge = false;
    purgePublicReport.mockImplementation(() => {
      reportFlippedBeforePurge = sb.calls.some((c) => c.table === 'public_reports');
    });
    await processTakedown(sb, 'abc123');
    expect(reportFlippedBeforePurge).toBe(true);
    // And the report update is recorded before the queue-status update.
    const reportIdx = sb.calls.findIndex((c) => c.table === 'public_reports');
    const reqIdx = sb.calls.findIndex((c) => c.table === 'takedown_requests');
    expect(reportIdx).toBeLessThan(reqIdx);
  });

  it('throws when the public_reports flip fails and does NOT purge the cache', async () => {
    const sb = makeSb({ public_reports: new Error('report write down') });
    await expect(processTakedown(sb, 'abc123')).rejects.toThrow(/report write down/);
    expect(purgePublicReport).not.toHaveBeenCalled();
    // The queue-status update must not run after the safety write failed.
    expect(sb.calls.some((c) => c.table === 'takedown_requests')).toBe(false);
  });

  it('throws when the queue-status update fails (report already flipped — re-running is idempotent)', async () => {
    const sb = makeSb({ takedown_requests: new Error('queue write down') });
    await expect(processTakedown(sb, 'abc123')).rejects.toThrow(/queue write down/);
    // The safety write (report flip) still happened.
    expect(sb.calls.some((c) => c.table === 'public_reports')).toBe(true);
  });
});
