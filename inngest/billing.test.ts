import { describe, it, expect } from 'vitest';
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
  ({ status, items: { data: [{ current_period_end: periodEnd }] } }) as unknown as Stripe.Subscription;

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
    expect(deriveProUntil([sub('active', 1_000), sub('trialing', 2_000)])).toEqual({ skip: false, proUntil: iso(2_000) });
  });
  it('reads the period-end off the subscription item when the top-level field is absent', () => {
    expect(deriveProUntil([subItems('active', 2_000)])).toEqual({ skip: false, proUntil: iso(2_000) });
  });
  it('skips (no downgrade) when an active sub has no resolvable period-end', () => {
    expect(deriveProUntil([sub('active', null)])).toEqual({ skip: true });
  });
  it('returns null pro_until (clears Pro) when no subs are active', () => {
    expect(deriveProUntil([sub('canceled', 2_000), sub('incomplete_expired', 3_000)])).toEqual({ skip: false, proUntil: null });
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
  return sb as unknown as Parameters<typeof reconcileCustomerChunk>[0] & { updates: typeof updates };
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
    const stripe = makeStripe({ cus_X: Object.assign(new Error('Too many requests'), { code: 'rate_limit' }) });
    await expect(reconcileCustomerChunk(sb, stripe, [cust('uX', 'cus_X')])).rejects.toThrow(/Too many requests/);
    expect(sb.updates).toEqual([]); // nothing written on a propagated failure
  });

  it('throws (→ chunk retry) when the Supabase read fails, instead of silently skipping', async () => {
    const sb = makeSb({ u1: null }, { readError: new Error('db read down') });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    await expect(reconcileCustomerChunk(sb, stripe, [cust('u1', 'cus_1')])).rejects.toThrow(/db read down/);
    expect(sb.updates).toEqual([]);
  });

  it('throws (→ chunk retry) when the Supabase write fails', async () => {
    const sb = makeSb({ u1: null }, { writeError: new Error('db write down') });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    await expect(reconcileCustomerChunk(sb, stripe, [cust('u1', 'cus_1')])).rejects.toThrow(/db write down/);
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
    const res = await runReconcile(
      sb, stripe, [cust('u1', 'cus_1'), cust('u2', 'cus_2')],
      { mode: 'single-customer', customerId: 'cus_1', keyLivemode: false },
    );
    expect(res.repaired).toBe(1);
    expect(sb.updates).toEqual([{ id: 'u1', pro_until: iso(5_000) }]); // u2 untouched
  });

  it('refuses to run when the expected livemode does not match the active key', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    await expect(
      runReconcile(sb, stripe, customers, { mode: 'full', keyLivemode: false, expectLivemode: true }),
    ).rejects.toBeInstanceOf(LivemodeMismatchError);
    expect(sb.updates).toEqual([]);
  });

  it('refuses a livemode mismatch for a DRY-RUN too, before any customer read', async () => {
    // Proves the guard fires for ALL modes (not just full) and BEFORE scoping/reads — a wrong-mode
    // key can never even peek at customer data.
    let stripeListed = false;
    const sb = makeSb({ u1: null });
    const stripe = {
      subscriptions: { list: async () => { stripeListed = true; return { data: [] }; } },
    } as unknown as Stripe;
    await expect(
      runReconcile(sb, stripe, customers, { mode: 'dry-run', keyLivemode: true, expectLivemode: false }),
    ).rejects.toBeInstanceOf(LivemodeMismatchError);
    expect(stripeListed).toBe(false); // no Stripe read happened
    expect(sb.updates).toEqual([]); // no write happened
  });
});

// Fake Supabase for the batched delete: select(...).lte(...).limit(n) returns the next page of
// expired ids; delete().in('id', ids) removes them from the backing store. The page size is
// driven entirely by the `n` the implementation passes to limit() — the fake imposes no cap of
// its own, so batching is exercised against the impl's real batchSize argument. A `selectError`
// makes the first select reject (to prove the loop surfaces a read fault).
function makeTtlSb(expiredIds: string[], opts: { selectError?: Error } = {}) {
  const store = new Set(expiredIds);
  const deleted: string[] = [];
  const sb = {
    deleted,
    from: () => ({
      select: () => ({
        lte: () => ({
          order: () => ({
            limit: (n: number) =>
              Promise.resolve(
                opts.selectError
                  ? { data: null, error: opts.selectError }
                  : { data: [...store].slice(0, n).map((id) => ({ id })), error: null },
              ),
          }),
        }),
      }),
      delete: () => ({
        in: (_col: string, ids: string[]) => {
          ids.forEach((id) => { store.delete(id); deleted.push(id); });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return sb as unknown as Parameters<typeof deleteExpiredAudits>[0] & { deleted: string[] };
}

describe('deleteExpiredAudits', () => {
  it('deletes the entire expired set in <= batchSize chunks and terminates', async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `a${i}`);
    const sb = makeTtlSb(ids);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 100 });
    // 23 ids / batch 10 → two full batches then a partial (3) batch that exits via the
    // `ids.length < batchSize` branch with iterations incremented to 3.
    expect(res).toMatchObject({ deleted: 23, drained: true, iterations: 3 });
    expect(sb.deleted.sort()).toEqual(ids.sort());
  });

  it('drains an EXACT multiple of batchSize (full final batch then one empty select)', async () => {
    // The most error-prone branch: 20 ids / batch 10 → two full batches, then an extra select
    // returns 0 rows and exits via the `ids.length === 0` early-return with drained=true. A
    // broken impl that returned drained=false or looped to maxIterations would be caught here.
    const ids = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const sb = makeTtlSb(ids);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 100 });
    expect(res).toMatchObject({ deleted: 20, drained: true, iterations: 2 });
    expect(sb.deleted.length).toBe(20); // the trailing empty select adds nothing
  });

  it('an already-empty expired set returns deleted=0, drained=true, iterations=0', async () => {
    const sb = makeTtlSb([]);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 5 });
    expect(res).toEqual({ deleted: 0, drained: true, iterations: 0 });
    expect(sb.deleted).toEqual([]);
  });

  it('stops at maxIterations even if rows remain (no infinite loop)', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const sb = makeTtlSb(ids);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 3 });
    expect(res.deleted).toBe(30); // 3 * 10
    expect(res.drained).toBe(false);
  });

  it('reports drained=true when the set empties before the cap', async () => {
    const sb = makeTtlSb(['a', 'b']);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 5 });
    expect(res).toMatchObject({ deleted: 2, drained: true });
  });

  it('throws (→ step retry) when the expired-id select fails, instead of reporting a clean drain', async () => {
    const sb = makeTtlSb(['a', 'b'], { selectError: new Error('select down') });
    await expect(
      deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 5 }),
    ).rejects.toThrow(/select down/);
    expect(sb.deleted).toEqual([]); // nothing deleted on a read fault
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
    expect(opts).toEqual({ mode: 'dry-run', keyLivemode: true, expectLivemode: true, customerId: undefined });
  });

  it('MANUAL path defaults to a real full run when the event omits a mode', () => {
    const opts = buildReconcileOpts({
      secretKey: 'sk_test_abc',
      livemodeEnv: 'false',
      defaultMode: 'full',
      event: { data: {} },
    });
    expect(opts).toEqual({ mode: 'full', keyLivemode: false, expectLivemode: false, customerId: undefined });
  });

  it('MANUAL path forwards the event mode + customerId verbatim', () => {
    const opts = buildReconcileOpts({
      secretKey: 'sk_test_abc',
      livemodeEnv: undefined, // no assertion in dev
      defaultMode: 'full',
      event: { data: { mode: 'single-customer', customerId: 'cus_42' } },
    });
    expect(opts).toEqual({ mode: 'single-customer', keyLivemode: false, expectLivemode: undefined, customerId: 'cus_42' });
  });

  it('keyLivemode is true only for an sk_live_ key; expectLivemode is undefined when the env is unset', () => {
    expect(buildReconcileOpts({ secretKey: 'sk_live_x', livemodeEnv: undefined, defaultMode: 'dry-run' }))
      .toMatchObject({ keyLivemode: true, expectLivemode: undefined });
    expect(buildReconcileOpts({ secretKey: undefined, livemodeEnv: 'false', defaultMode: 'dry-run' }))
      .toMatchObject({ keyLivemode: false, expectLivemode: false });
  });
});

describe('runReconcile dry-run resource_missing', () => {
  it('skips a deleted customer in dry-run too (no throw, wouldRepair unchanged, still counts it)', async () => {
    const sb = makeSb({ u1: null, u2: null }); // both would otherwise be repaired
    const stripe = makeStripe({
      cus_1: Object.assign(new Error('No such customer: cus_1'), { code: 'resource_missing' }),
      cus_2: [sub('active', 5_000)],
    });
    const res = await runReconcile(
      sb, stripe, [cust('u1', 'cus_1'), cust('u2', 'cus_2')],
      { mode: 'dry-run', keyLivemode: false },
    );
    // The deleted customer is skipped (not a wouldRepair) but still counted in `checked`;
    // the healthy customer is the only intended repair. Nothing is written in dry-run.
    expect(res).toMatchObject({ mode: 'dry-run', checked: 2, wouldRepair: 1, repaired: 0 });
    expect(sb.updates).toEqual([]);
  });

  it('re-throws a non-resource_missing Stripe error in dry-run (→ step retry), writing nothing', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({ cus_1: Object.assign(new Error('Too many requests'), { code: 'rate_limit' }) });
    await expect(
      runReconcile(sb, stripe, [cust('u1', 'cus_1')], { mode: 'dry-run', keyLivemode: false }),
    ).rejects.toThrow(/Too many requests/);
    expect(sb.updates).toEqual([]);
  });
});
