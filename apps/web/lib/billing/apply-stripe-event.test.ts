import { describe, it, expect } from 'vitest';
import { applyStripeEvent } from './apply-stripe-event';

// Fake Supabase client mimicking the thenable+chainable query builder.
// Records every users update (table + row + the .eq() predicate). The builder supports both
// direct-await (`update().eq()`) and `.select('id')` (returns affected rows) and `.select().eq().maybeSingle()`.
function makeFakeSb(opts: {
  duplicate?: boolean;
  insertError?: { code?: string; message?: string };
  priorProcessedAt?: string | null; // processed_at returned on the duplicate re-check
  userRows?: number; // how many rows a users update matches (default 1)
} = {}) {
  const calls = { updates: [] as { table: string; row: Record<string, unknown>; eqCol?: string; eqVal?: unknown }[] };
  const userRows = opts.userRows ?? 1;

  const make = (table: string) => ({
    insert: async () => ({
      error: opts.duplicate ? { code: '23505', message: 'duplicate key' } : (opts.insertError ?? null),
    }),
    update(row: Record<string, unknown>) {
      const rows = table === 'users' ? Array.from({ length: userRows }, (_, i) => ({ id: `u${i}` })) : [];
      let eqCol: string | undefined;
      let eqVal: unknown;
      const record = () => calls.updates.push({ table, row, eqCol, eqVal });
      const builder: {
        eq: (col?: string, val?: unknown) => typeof builder;
        select: () => Promise<{ data: { id: string }[]; error: null }>;
        then: (resolve: (v: { data: { id: string }[]; error: null }) => void) => void;
      } = {
        eq: (col, val) => { eqCol = col; eqVal = val; return builder; },
        select: () => { record(); return Promise.resolve({ data: rows, error: null }); },
        then: (resolve) => { record(); resolve({ data: rows, error: null }); },
      };
      return builder;
    },
    select() {
      const builder = {
        eq: () => builder,
        maybeSingle: async () => ({ data: { processed_at: opts.priorProcessedAt ?? null }, error: null }),
      };
      return builder;
    },
  });

  const sb = { calls, from: (t: string) => make(t) };
  return sb as unknown as Parameters<typeof applyStripeEvent>[0] & { calls: typeof calls };
}

// Fake Stripe — only subscriptions.retrieve is used (by checkout.session.completed). The
// returned subscription uses the items.data[].current_period_end shape (Stripe API >= 2025),
// matching production; subscriptionPeriodEnd reads it. Pass an Error to simulate a retrieve fault.
const fakeStripe = (sub: { status: string; current_period_end?: number } | Error = { status: 'active', current_period_end: 1782000000 }) =>
  ({
    subscriptions: {
      retrieve: async () => {
        if (sub instanceof Error) throw sub;
        return { status: sub.status, items: { data: [{ current_period_end: sub.current_period_end }] } };
      },
    },
  }) as unknown as Parameters<typeof applyStripeEvent>[2];

const proUpdates = (sb: ReturnType<typeof makeFakeSb>) =>
  sb.calls.updates.filter((u) => u.table === 'users' && 'pro_until' in u.row);
const customerLinks = (sb: ReturnType<typeof makeFakeSb>) =>
  sb.calls.updates.filter((u) => u.table === 'users' && 'stripe_customer_id' in u.row);

describe('applyStripeEvent', () => {
  it('skips a fully-processed duplicate event (processed_at set)', async () => {
    const sb = makeFakeSb({ duplicate: true, priorProcessedAt: '2026-06-01T00:00:00.000Z' });
    const res = await applyStripeEvent(sb, { id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} } } as never, fakeStripe());
    expect(res).toEqual({ handled: false });
    expect(proUpdates(sb)).toHaveLength(0);
  });

  it('re-applies a crashed event (duplicate id but processed_at null)', async () => {
    const sb = makeFakeSb({ duplicate: true, priorProcessedAt: null });
    const periodEnd = 1782000000;
    const res = await applyStripeEvent(sb, {
      id: 'evt_crash', type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_1', status: 'active', current_period_end: periodEnd } },
    } as never, fakeStripe());
    expect(res).toEqual({ handled: true });
    expect(proUpdates(sb)[0]?.row.pro_until).toBe(new Date(periodEnd * 1000).toISOString());
  });

  it('links the customer AND grants pro_until on checkout.session.completed (root-cause branch, ordering-independent)', async () => {
    const sb = makeFakeSb();
    const periodEnd = 1782000000;
    const res = await applyStripeEvent(sb, {
      id: 'evt_link', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'u0', customer: 'cus_1', subscription: 'sub_1' } },
    } as never, fakeStripe({ status: 'active', current_period_end: periodEnd }));
    expect(res).toEqual({ handled: true });
    // Link is its own update (durable, first); the grant is a second update.
    expect(customerLinks(sb)).toEqual([{ table: 'users', row: { stripe_customer_id: 'cus_1' }, eqCol: 'id', eqVal: 'u0' }]);
    expect(proUpdates(sb)).toEqual([{ table: 'users', row: { pro_until: new Date(periodEnd * 1000).toISOString() }, eqCol: 'id', eqVal: 'u0' }]);
  });

  it('only links the customer on checkout.session.completed with no subscription (no pro_until grant)', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_link_nosub', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'u0', customer: 'cus_1' } }, // no subscription id
    } as never, fakeStripe());
    expect(customerLinks(sb)).toHaveLength(1);
    expect(proUpdates(sb)).toHaveLength(0);
  });

  it('links the customer but does NOT grant on a not-yet-active subscription (e.g. 3DS incomplete)', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_link_incomplete', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'u0', customer: 'cus_1', subscription: 'sub_1' } },
    } as never, fakeStripe({ status: 'incomplete', current_period_end: 1782000000 }));
    expect(customerLinks(sb)).toHaveLength(1); // linked
    expect(proUpdates(sb)).toHaveLength(0);     // no pro_until clobber; subscription.* will grant
  });

  it('still links the customer when the subscription retrieve fails (entitlement deferred, no throw)', async () => {
    const sb = makeFakeSb();
    const res = await applyStripeEvent(sb, {
      id: 'evt_link_retrievefail', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'u0', customer: 'cus_1', subscription: 'sub_1' } },
    } as never, fakeStripe(new Error('stripe down')));
    expect(res).toEqual({ handled: true });   // does not 500 the whole event
    expect(customerLinks(sb)).toHaveLength(1); // link still committed
    expect(proUpdates(sb)).toHaveLength(0);    // grant deferred to subscription.*
  });

  it('does NOT link a customer when checkout.session.completed has no client_reference_id', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_nolink', type: 'checkout.session.completed',
      data: { object: { client_reference_id: null, customer: 'cus_1', subscription: 'sub_1' } },
    } as never, fakeStripe());
    expect(customerLinks(sb)).toHaveLength(0); // guard holds, no garbage write
  });

  it('sets pro_until from an active subscription', async () => {
    const sb = makeFakeSb();
    const periodEnd = 1782000000;
    await applyStripeEvent(sb, {
      id: 'evt_2', type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_1', status: 'active', current_period_end: periodEnd } },
    } as never, fakeStripe());
    expect(proUpdates(sb)[0]?.row.pro_until).toBe(new Date(periodEnd * 1000).toISOString());
  });

  it('clears pro_until on a canceled subscription', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_3', type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_1', status: 'canceled', current_period_end: 1782000000 } },
    } as never, fakeStripe());
    expect(proUpdates(sb)[0]?.row.pro_until).toBeNull();
  });

  it('does NOT downgrade an active subscription whose event omits the period end', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_noend', type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_1', status: 'active' } }, // no current_period_end, no items
    } as never, fakeStripe());
    expect(proUpdates(sb)).toHaveLength(0); // left untouched, not cleared
  });

  it('throws (→ 500 → Stripe retry) when no user row carries the customer id yet', async () => {
    const sb = makeFakeSb({ userRows: 0 });
    await expect(
      applyStripeEvent(sb, {
        id: 'evt_race', type: 'customer.subscription.created',
        data: { object: { customer: 'cus_unlinked', status: 'active', current_period_end: 1782000000 } },
      } as never, fakeStripe()),
    ).rejects.toThrow(/no user for stripe_customer_id/);
  });

  it('rethrows on a non-conflict insert error (so the webhook returns 500 and Stripe retries)', async () => {
    const sb = makeFakeSb({ insertError: { code: '08006', message: 'connection failure' } });
    await expect(
      applyStripeEvent(sb, { id: 'evt_4', type: 'customer.subscription.updated', data: { object: {} } } as never, fakeStripe()),
    ).rejects.toThrow(/stripe_events insert failed/);
  });
});
