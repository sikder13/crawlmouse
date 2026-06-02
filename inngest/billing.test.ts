import { describe, it, expect } from 'vitest';
import { deriveProUntil, reconcileCustomerChunk, type ReconcileCustomer } from './billing-helpers';
import type Stripe from 'stripe';

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const sub = (status: string, periodEnd: number | null): Stripe.Subscription =>
  ({ status, current_period_end: periodEnd }) as unknown as Stripe.Subscription;
const subItems = (status: string, periodEnd: number): Stripe.Subscription =>
  ({ status, items: { data: [{ current_period_end: periodEnd }] } }) as unknown as Stripe.Subscription;

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
