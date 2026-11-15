import { afterEach, describe, it, expect } from 'vitest';
import { reconcileBillingHandler, setAccountReconcile } from './billing';
import {
  deriveProUntil,
  reconcileCustomerChunk,
  runReconcile,
  deleteExpiredAudits,
  buildReconcileOpts,
  sameInstant,
  LivemodeMismatchError,
  type ReconcileCustomer,
} from './billing-helpers';
import type Stripe from 'stripe';

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const sub = (status: string, periodEnd: number | null): Stripe.Subscription =>
  ({ status, current_period_end: periodEnd }) as unknown as Stripe.Subscription;
const subItems = (status: string, periodEnd: number): Stripe.Subscription =>
  ({
    status,
    items: { data: [{ current_period_end: periodEnd }] },
  }) as unknown as Stripe.Subscription;

describe('sameInstant', () => {
  it('treats two strings for the SAME wall time as equal despite differing ISO formats', () => {
    // The drift bug: Supabase returns `...+00:00` while the derived value is `...000Z`. These are
    // the same instant, so a string `!==` reports spurious drift and "repairs" every active sub.
    expect(sameInstant('2026-06-06T12:00:00+00:00', '2026-06-06T12:00:00.000Z')).toBe(true);
  });
  it('null vs null is equal (both cleared → no drift)', () => {
    expect(sameInstant(null, null)).toBe(true);
  });
  it('null vs a value is NOT equal (one side cleared, the other set → genuine drift)', () => {
    expect(sameInstant(null, '2026-06-06T12:00:00.000Z')).toBe(false);
    expect(sameInstant('2026-06-06T12:00:00.000Z', null)).toBe(false);
  });
  it('genuinely different instants are NOT equal', () => {
    expect(sameInstant('2026-06-06T12:00:00.000Z', '2026-06-07T12:00:00.000Z')).toBe(false);
  });
  it('falls back to strict string equality when either value cannot be parsed to an instant', () => {
    // A NaN parse (corrupt/garbage value) must not collapse two unequal garbage strings into
    // "same" — fall back to exact string compare so a real mismatch is still surfaced.
    expect(sameInstant('not-a-date', 'not-a-date')).toBe(true);
    expect(sameInstant('not-a-date', 'also-not-a-date')).toBe(false);
    expect(sameInstant('not-a-date', '2026-06-06T12:00:00.000Z')).toBe(false);
  });
});

describe('deriveProUntil', () => {
  it('picks the latest period-end across multiple active subs', () => {
    expect(deriveProUntil([sub('active', 1_000), sub('trialing', 2_000)])).toEqual({
      skip: false,
      proUntil: iso(2_000),
    });
  });
  it('reads the period-end off the subscription item when the top-level field is absent', () => {
    expect(deriveProUntil([subItems('active', 2_000)])).toEqual({
      skip: false,
      proUntil: iso(2_000),
    });
  });
  it('skips (no downgrade) when an active sub has no resolvable period-end', () => {
    expect(deriveProUntil([sub('active', null)])).toEqual({ skip: true });
  });
  it('returns null pro_until (clears Pro) when no subs are active', () => {
    expect(deriveProUntil([sub('canceled', 2_000), sub('incomplete_expired', 3_000)])).toEqual({
      skip: false,
      proUntil: null,
    });
  });
});

// Fake Supabase: select('pro_until').eq('id',id).maybeSingle() reads the seeded value;
// update({pro_until}).eq('id',id) records the write.
function makeSb(
  proUntilById: Record<string, string | null>,
  opts: { readError?: Error; writeError?: Error } = {},
) {
  const updates: { id: string; pro_until: string | null }[] = [];
  const sb = {
    updates,
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: opts.readError ? null : { pro_until: proUntilById[id] ?? null },
            error: opts.readError ?? null,
          }),
        }),
      }),
      update: (row: { pro_until: string | null }) => ({
        eq: (_col: string, id: string) => {
          if (!opts.writeError) updates.push({ id, pro_until: row.pro_until });
          return Promise.resolve({ error: opts.writeError ?? null });
        },
      }),
    }),
  };
  return sb as unknown as Parameters<typeof reconcileCustomerChunk>[0] & {
    updates: typeof updates;
  };
}

function makeStripe(byCustomer: Record<string, Stripe.Subscription[] | Error>) {
  return {
    subscriptions: {
      list: async ({ customer }: { customer: string }) => {
        const v = byCustomer[customer];
        if (v instanceof Error) throw v;
        return { data: v ?? [] };
      },
    },
  } as unknown as Stripe;
}

const cust = (id: string, cid: string): ReconcileCustomer => ({ id, stripe_customer_id: cid });

describe('reconcileCustomerChunk', () => {
  it('repairs a drifted pro_until to the active sub period-end', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    const { chunkRepaired } = await reconcileCustomerChunk(sb, stripe, [cust('u1', 'cus_1')]);
    expect(chunkRepaired).toBe(1);
    expect(sb.updates).toEqual([{ id: 'u1', pro_until: iso(5_000) }]);
  });

  it('does NOT downgrade a paying user when the active sub has no resolvable period-end', async () => {
    const sb = makeSb({ u1: iso(9_000) }); // already Pro
    const stripe = makeStripe({ cus_1: [sub('active', null)] });
    const { chunkRepaired } = await reconcileCustomerChunk(sb, stripe, [cust('u1', 'cus_1')]);
    expect(chunkRepaired).toBe(0);
    expect(sb.updates).toEqual([]); // left untouched, not nulled
  });

  it('clears Pro for an ex-customer whose subs are all canceled', async () => {
    const sb = makeSb({ u1: iso(9_000) });
    const stripe = makeStripe({ cus_1: [sub('canceled', 5_000)] });
    const { chunkRepaired } = await reconcileCustomerChunk(sb, stripe, [cust('u1', 'cus_1')]);
    expect(chunkRepaired).toBe(1);
    expect(sb.updates).toEqual([{ id: 'u1', pro_until: null }]);
  });

  it('skips a customer whose Stripe lookup throws without poisoning the rest of the chunk', async () => {
    const sb = makeSb({ uA: null, uB: null, uC: null });
    const stripe = makeStripe({
      cus_A: [sub('active', 5_000)],
      cus_B: Object.assign(new Error('No such customer: cus_B'), { code: 'resource_missing' }),
      cus_C: [sub('active', 6_000)],
    });
    const { chunkRepaired } = await reconcileCustomerChunk(sb, stripe, [
      cust('uA', 'cus_A'),
      cust('uB', 'cus_B'),
      cust('uC', 'cus_C'),
    ]);
    // A and C still reconciled; B skipped (no write, no garbage pro_until).
    expect(chunkRepaired).toBe(2);
    expect(sb.updates).toEqual([
      { id: 'uA', pro_until: iso(5_000) },
      { id: 'uC', pro_until: iso(6_000) },
    ]);
  });

  it('re-throws a non-resource_missing Stripe error so step.run can retry the chunk', async () => {
    const sb = makeSb({ uX: null });
    const stripe = makeStripe({
      cus_X: Object.assign(new Error('Too many requests'), { code: 'rate_limit' }),
    });
    await expect(reconcileCustomerChunk(sb, stripe, [cust('uX', 'cus_X')])).rejects.toThrow(
      /Too many requests/,
    );
    expect(sb.updates).toEqual([]); // nothing written on a propagated failure
  });

  it('throws (→ chunk retry) when the Supabase read fails, instead of silently skipping', async () => {
    const sb = makeSb({ u1: null }, { readError: new Error('db read down') });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    await expect(reconcileCustomerChunk(sb, stripe, [cust('u1', 'cus_1')])).rejects.toThrow(
      /db read down/,
    );
    expect(sb.updates).toEqual([]);
  });

  it('throws (→ chunk retry) when the Supabase write fails', async () => {
    const sb = makeSb({ u1: null }, { writeError: new Error('db write down') });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    await expect(reconcileCustomerChunk(sb, stripe, [cust('u1', 'cus_1')])).rejects.toThrow(
      /db write down/,
    );
  });
});

describe('runReconcile', () => {
  const customers = [cust('u1', 'cus_1')];

  it('dry-run computes intended repairs but writes NOTHING', async () => {
    const sb = makeSb({ u1: null }); // would be repaired to iso(5000)
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    const res = await runReconcile(sb, stripe, customers, { mode: 'dry-run', keyLivemode: false });
    expect(res).toMatchObject({ mode: 'dry-run', checked: 1, wouldRepair: 1, repaired: 0 });
    expect(sb.updates).toEqual([]); // <-- the safety guarantee
  });

  it('full mode writes the repairs', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    const res = await runReconcile(sb, stripe, customers, { mode: 'full', keyLivemode: false });
    expect(res).toMatchObject({ mode: 'full', checked: 1, repaired: 1 });
    expect(sb.updates).toEqual([{ id: 'u1', pro_until: iso(5_000) }]);
  });

  it('single-customer mode without a customerId fails loudly instead of a silent no-op', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    await expect(
      runReconcile(sb, stripe, customers, { mode: 'single-customer', keyLivemode: false }),
    ).rejects.toThrow(/single-customer mode requires customerId/);
    expect(sb.updates).toEqual([]);
  });

  it('single-customer mode only touches the named customer', async () => {
    const sb = makeSb({ u1: null, u2: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)], cus_2: [sub('active', 6_000)] });
    const res = await runReconcile(sb, stripe, [cust('u1', 'cus_1'), cust('u2', 'cus_2')], {
      mode: 'single-customer',
      customerId: 'cus_1',
      keyLivemode: false,
    });
    expect(res.repaired).toBe(1);
    expect(sb.updates).toEqual([{ id: 'u1', pro_until: iso(5_000) }]); // u2 untouched
  });

  it('refuses to run when the expected livemode does not match the active key', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    await expect(
      runReconcile(sb, stripe, customers, {
        mode: 'full',
        keyLivemode: false,
        expectLivemode: true,
      }),
    ).rejects.toBeInstanceOf(LivemodeMismatchError);
    expect(sb.updates).toEqual([]);
  });

  it('refuses a livemode mismatch for a DRY-RUN too, before any customer read', async () => {
    // Proves the guard fires for ALL modes (not just full) and BEFORE scoping/reads — a wrong-mode
    // key can never even peek at customer data.
    let stripeListed = false;
    const sb = makeSb({ u1: null });
    const stripe = {
      subscriptions: {
        list: async () => {
          stripeListed = true;
          return { data: [] };
        },
      },
    } as unknown as Stripe;
    await expect(
      runReconcile(sb, stripe, customers, {
        mode: 'dry-run',
        keyLivemode: true,
        expectLivemode: false,
      }),
    ).rejects.toBeInstanceOf(LivemodeMismatchError);
    expect(stripeListed).toBe(false); // no Stripe read happened
    expect(sb.updates).toEqual([]); // no write happened
  });
});

// Fake Supabase for the batched delete, over a store of expired audits (`reported` names those a
// public report links). `audits`: select('id').lte(...)[.gt('id', after)].order('id').limit(n)
// answers the next n expired ids in id order after `after`; delete().in('id', ids) removes them.
// `public_reports`: select('audit_id').in('audit_id', ids) answers the reported ones among ids.
// The page size is the `n` the implementation passes (the fake imposes no cap of its own). A
// `selectError` makes the first audits select reject (to prove the loop surfaces a read fault).
function makeTtlSb(
  expiredIds: string[],
  opts: {
    selectError?: Error;
    reported?: string[];
    /** Named by a report that was taken down or hidden: reported only to a read without the filters. */
    removed?: string[];
    reportsError?: Error;
  } = {},
) {
  const store = new Set(expiredIds);
  const reported = new Set(opts.reported ?? []);
  const removed = new Set(opts.removed ?? []);
  const deleted: string[] = [];
  const reads: { after: string | null; limit: number }[] = [];
  const auditsRead = () => {
    let after: string | null = null;
    const chain = {
      lte: () => chain,
      gt: (col: string, value: string) => {
        expect(col).toBe('id');
        after = value;
        return chain;
      },
      order: (col: string, o: { ascending: boolean }) => {
        expect([col, o.ascending]).toEqual(['id', true]);
        return chain;
      },
      limit: (n: number) => {
        reads.push({ after, limit: n });
        if (opts.selectError) return Promise.resolve({ data: null, error: opts.selectError });
        const page = [...store]
          .sort()
          .filter((id) => after === null || id > after)
          .slice(0, n);
        return Promise.resolve({ data: page.map((id) => ({ id })), error: null });
      },
    };
    return chain;
  };
  const sb = {
    deleted,
    reads,
    from: (table: string) =>
      table === 'public_reports'
        ? {
            select: (cols: string) => {
              const nulls = new Set<string>();
              const chain = {
                is: (col: string, value: null) => {
                  expect(value).toBeNull();
                  nulls.add(col);
                  return chain;
                },
                in: (col: string, ids: string[]) => {
                  expect([cols, col]).toEqual(['audit_id', 'audit_id']);
                  const published = nulls.has('takedown_requested_at') && nulls.has('hidden_at');
                  const named = (id: string) => reported.has(id) || (!published && removed.has(id));
                  return Promise.resolve(
                    opts.reportsError
                      ? { data: null, error: opts.reportsError }
                      : {
                          data: ids.filter(named).map((id) => ({ audit_id: id })),
                          error: null,
                        },
                  );
                },
              };
              return chain;
            },
          }
        : {
            select: () => auditsRead(),
            delete: () => ({
              in: (_col: string, ids: string[]) => {
                ids.forEach((id) => {
                  store.delete(id);
                  deleted.push(id);
                });
                return Promise.resolve({ error: null });
              },
            }),
          },
  };
  return sb as unknown as Parameters<typeof deleteExpiredAudits>[0] & {
    deleted: string[];
    reads: { after: string | null; limit: number }[];
  };
}

/** `a00`…: ids whose string order is their numeric order, as uuids' is in Postgres. */
const idsOf = (n: number, prefix = 'a') =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);

describe('deleteExpiredAudits', () => {
  it('deletes the entire expired set in <= batchSize chunks and terminates', async () => {
    const ids = idsOf(23);
    const sb = makeTtlSb(ids);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', {
      batchSize: 10,
      maxIterations: 100,
    });
    // 23 ids / batch 10 → two full batches then a partial (3) batch that exits via the
    // `ids.length < batchSize` branch with iterations incremented to 3.
    expect(res).toMatchObject({ deleted: 23, kept: 0, drained: true, iterations: 3 });
    expect(sb.deleted.sort()).toEqual(ids.sort());
  });

  it('drains an EXACT multiple of batchSize (full final batch then one empty select)', async () => {
    // The most error-prone branch: 20 ids / batch 10 → two full batches, then an extra select
    // returns 0 rows and exits via the `ids.length === 0` early-return with drained=true. A
    // broken impl that returned drained=false or looped to maxIterations would be caught here.
    const ids = idsOf(20);
    const sb = makeTtlSb(ids);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', {
      batchSize: 10,
      maxIterations: 100,
    });
    expect(res).toMatchObject({ deleted: 20, drained: true, iterations: 2 });
    expect(sb.deleted.length).toBe(20); // the trailing empty select adds nothing
  });

  it('an already-empty expired set returns deleted=0, drained=true, iterations=0', async () => {
    const sb = makeTtlSb([]);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', {
      batchSize: 10,
      maxIterations: 5,
    });
    expect(res).toEqual({ deleted: 0, kept: 0, drained: true, iterations: 0 });
    expect(sb.deleted).toEqual([]);
  });

  it('stops at maxIterations even if rows remain (no infinite loop)', async () => {
    const sb = makeTtlSb(idsOf(100));
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', {
      batchSize: 10,
      maxIterations: 3,
    });
    expect(res.deleted).toBe(30); // 3 * 10
    expect(res.drained).toBe(false);
    expect(res.iterations).toBe(3);
  });

  it('reports drained=true when the set empties before the cap', async () => {
    const sb = makeTtlSb(['a', 'b']);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', {
      batchSize: 10,
      maxIterations: 5,
    });
    expect(res).toMatchObject({ deleted: 2, drained: true });
  });

  it('throws (→ step retry) when the expired-id select fails, instead of reporting a clean drain', async () => {
    const sb = makeTtlSb(['a', 'b'], { selectError: new Error('select down') });
    await expect(
      deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 5 }),
    ).rejects.toThrow(/select down/);
    expect(sb.deleted).toEqual([]); // nothing deleted on a read fault
  });

  // C-4 (docs/ops/v1-inventory.json): a minted report links its audit; deleting the audit would
  // set the report's audit_id null (the FK's `on delete set null`) and cut that link.
  it('keeps an expired audit that a public report names, and deletes every other', async () => {
    const ids = idsOf(7);
    const sb = makeTtlSb(ids, { reported: ['a02', 'a05'] });
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', {
      batchSize: 3,
      maxIterations: 10,
    });
    expect(res).toEqual({ deleted: 5, kept: 2, drained: true, iterations: 3 });
    expect(sb.deleted.sort()).toEqual(['a00', 'a01', 'a03', 'a04', 'a06']);
  });

  it('deletes an expired audit whose report was taken down or hidden: only a published report keeps it', async () => {
    const ids = idsOf(5);
    const sb = makeTtlSb(ids, { reported: ['a01'], removed: ['a02', 'a03'] });
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', {
      batchSize: 10,
      maxIterations: 10,
    });
    expect(res).toEqual({ deleted: 4, kept: 1, drained: true, iterations: 1 });
    expect(sb.deleted.sort()).toEqual(['a00', 'a02', 'a03', 'a04']);
  });

  it('kept audits that fill whole batches do not block the batches after them', async () => {
    // The first two batches are all reported: an implementation that re-read from the start each
    // time would read them forever and delete nothing.
    const reported = idsOf(6, 'k');
    const doomed = idsOf(5, 'z');
    const sb = makeTtlSb([...reported, ...doomed], { reported });
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', {
      batchSize: 3,
      maxIterations: 10,
    });
    expect(res).toEqual({ deleted: 5, kept: 6, drained: true, iterations: 4 });
    expect(sb.deleted.sort()).toEqual(doomed);
    // Each batch reads after the last id the one before it read.
    expect(sb.reads.map((r) => r.after)).toEqual([null, 'k02', 'k05', 'z02']);
  });

  it('a set wholly kept drains with nothing deleted, and the cap still bounds it', async () => {
    const ids = idsOf(9);
    const all = await deleteExpiredAudits(
      makeTtlSb(ids, { reported: ids }),
      '2026-06-03T00:00:00Z',
      {
        batchSize: 3,
        maxIterations: 10,
      },
    );
    expect(all).toEqual({ deleted: 0, kept: 9, drained: true, iterations: 3 });
    const capped = makeTtlSb(ids, { reported: ids });
    expect(
      await deleteExpiredAudits(capped, '2026-06-03T00:00:00Z', { batchSize: 3, maxIterations: 2 }),
    ).toEqual({ deleted: 0, kept: 6, drained: false, iterations: 2 });
    expect(capped.deleted).toEqual([]);
  });

  it('throws when the report read fails, deleting nothing (a delete without it could cut a link)', async () => {
    const sb = makeTtlSb(['a', 'b'], { reported: ['a'], reportsError: new Error('reports down') });
    await expect(
      deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 5 }),
    ).rejects.toThrow(/reports down/);
    expect(sb.deleted).toEqual([]);
  });
});

// Pins the SAFETY-CRITICAL wiring the inngest createFunction wrappers feed into runReconcile.
// A regression that hardcodes the scheduled cron to 'full' (re-introducing the launch-critical
// "scheduled cron writes" bug) or drops the livemode guard would be caught here.
describe('buildReconcileOpts', () => {
  it('SCHEDULED path always yields a dry-run (never a write), with the env-derived livemode guard', () => {
    const opts = buildReconcileOpts({
      secretKey: 'sk_live_abc',
      livemodeEnv: 'true',
      defaultMode: 'dry-run', // the scheduled cron's fixed default
    });
    expect(opts).toEqual({
      mode: 'dry-run',
      keyLivemode: true,
      expectLivemode: true,
      customerId: undefined,
    });
  });

  it('MANUAL path defaults to a real full run when the event omits a mode', () => {
    const opts = buildReconcileOpts({
      secretKey: 'sk_test_abc',
      livemodeEnv: 'false',
      defaultMode: 'full',
      event: { data: {} },
    });
    expect(opts).toEqual({
      mode: 'full',
      keyLivemode: false,
      expectLivemode: false,
      customerId: undefined,
    });
  });

  it('MANUAL path forwards the event mode + customerId verbatim', () => {
    const opts = buildReconcileOpts({
      secretKey: 'sk_test_abc',
      livemodeEnv: undefined, // no assertion in dev
      defaultMode: 'full',
      event: { data: { mode: 'single-customer', customerId: 'cus_42' } },
    });
    expect(opts).toEqual({
      mode: 'single-customer',
      keyLivemode: false,
      expectLivemode: undefined,
      customerId: 'cus_42',
    });
  });

  it('keyLivemode is true only for an sk_live_ key; expectLivemode is undefined when the env is unset', () => {
    expect(
      buildReconcileOpts({
        secretKey: 'sk_live_x',
        livemodeEnv: undefined,
        defaultMode: 'dry-run',
      }),
    ).toMatchObject({ keyLivemode: true, expectLivemode: undefined });
    expect(
      buildReconcileOpts({ secretKey: undefined, livemodeEnv: 'false', defaultMode: 'dry-run' }),
    ).toMatchObject({ keyLivemode: false, expectLivemode: false });
  });
});

describe('runReconcile dry-run resource_missing', () => {
  it('skips a deleted customer in dry-run too (no throw, wouldRepair unchanged, still counts it)', async () => {
    const sb = makeSb({ u1: null, u2: null }); // both would otherwise be repaired
    const stripe = makeStripe({
      cus_1: Object.assign(new Error('No such customer: cus_1'), { code: 'resource_missing' }),
      cus_2: [sub('active', 5_000)],
    });
    const res = await runReconcile(sb, stripe, [cust('u1', 'cus_1'), cust('u2', 'cus_2')], {
      mode: 'dry-run',
      keyLivemode: false,
    });
    // The deleted customer is skipped (not a wouldRepair) but still counted in `checked`;
    // the healthy customer is the only intended repair. Nothing is written in dry-run.
    expect(res).toMatchObject({ mode: 'dry-run', checked: 2, wouldRepair: 1, repaired: 0 });
    expect(sb.updates).toEqual([]);
  });

  it('re-throws a non-resource_missing Stripe error in dry-run (→ step retry), writing nothing', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({
      cus_1: Object.assign(new Error('Too many requests'), { code: 'rate_limit' }),
    });
    await expect(
      runReconcile(sb, stripe, [cust('u1', 'cus_1')], { mode: 'dry-run', keyLivemode: false }),
    ).rejects.toThrow(/Too many requests/);
    expect(sb.updates).toEqual([]);
  });
});

// ─── The v2 reconcile seam (CC-03 D10) ───────────────────────────────────────────────────────────

describe('reconcileBillingFn and the v2 reconcile seam', () => {
  /** A fake `step` that records step ids and runs each body, except the canned ones. */
  function fakeStep(canned: Record<string, unknown>) {
    const ran: string[] = [];
    const step = {
      run: async (id: string, fn: () => unknown) => {
        ran.push(id);
        return id in canned ? canned[id] : fn();
      },
    };
    return { step, ran };
  }
  const v1Summary = { mode: 'dry-run', checked: 4, wouldRepair: 1, repaired: 0 };
  type Input = Parameters<typeof reconcileBillingHandler>[0];

  afterEach(() => setAccountReconcile(null));

  it('unset: v1’s step alone, and its summary is the answer', async () => {
    const { step, ran } = fakeStep({ 'reconcile-dry-run': v1Summary });
    expect(await reconcileBillingHandler({ step } as unknown as Input)).toEqual(v1Summary);
    expect(ran).toEqual(['reconcile-dry-run']);
  });

  it('set: v1’s step, then reconcile-accounts runs it; the answer is still v1’s summary', async () => {
    const calls: string[] = [];
    setAccountReconcile(async () => {
      calls.push('v2');
      return { checked: 2, drifted: 1 };
    });
    const { step, ran } = fakeStep({ 'reconcile-dry-run': v1Summary });
    expect(await reconcileBillingHandler({ step } as unknown as Input)).toEqual(v1Summary);
    expect(ran).toEqual(['reconcile-dry-run', 'reconcile-accounts']);
    expect(calls).toEqual(['v2']);
  });

  it('a v2 failure fails the run after v1’s step, so Inngest retries only the second step', async () => {
    setAccountReconcile(async () => Promise.reject(new Error('the key’s mode is wrong')));
    const { step, ran } = fakeStep({ 'reconcile-dry-run': v1Summary });
    await expect(reconcileBillingHandler({ step } as unknown as Input)).rejects.toThrow(
      'the key’s mode is wrong',
    );
    expect(ran).toEqual(['reconcile-dry-run', 'reconcile-accounts']);
  });

  it('set back to null: v1’s step alone again', async () => {
    setAccountReconcile(async () => ({}));
    setAccountReconcile(null);
    const { step, ran } = fakeStep({ 'reconcile-dry-run': v1Summary });
    await reconcileBillingHandler({ step } as unknown as Input);
    expect(ran).toEqual(['reconcile-dry-run']);
  });
});
