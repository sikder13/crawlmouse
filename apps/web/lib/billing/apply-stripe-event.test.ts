import { describe, it, expect } from 'vitest';
import { applyStripeEvent } from './apply-stripe-event';

// Fake Supabase client mimicking the thenable+chainable query builder.
// Records every users update (table + row). The builder supports both direct-await
// (`update().eq()`) and `.select('id')` (returns affected rows) and `.select().eq().maybeSingle()`.
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

const proUpdates = (sb: ReturnType<typeof makeFakeSb>) =>
  sb.calls.updates.filter((u) => u.table === 'users' && 'pro_until' in u.row);
const customerLinks = (sb: ReturnType<typeof makeFakeSb>) =>
  sb.calls.updates.filter((u) => u.table === 'users' && 'stripe_customer_id' in u.row);

describe('applyStripeEvent', () => {
  it('skips a fully-processed duplicate event (processed_at set)', async () => {
    const sb = makeFakeSb({ duplicate: true, priorProcessedAt: '2026-06-01T00:00:00.000Z' });
    const res = await applyStripeEvent(sb, { id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} } } as never);
    expect(res).toEqual({ handled: false });
    expect(proUpdates(sb)).toHaveLength(0);
  });

  it('re-applies a crashed event (duplicate id but processed_at null)', async () => {
    const sb = makeFakeSb({ duplicate: true, priorProcessedAt: null });
    const periodEnd = 1782000000;
    const res = await applyStripeEvent(sb, {
      id: 'evt_crash', type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_1', status: 'active', current_period_end: periodEnd } },
    } as never);
    expect(res).toEqual({ handled: true });
    expect(proUpdates(sb)[0]?.row.pro_until).toBe(new Date(periodEnd * 1000).toISOString());
  });

  it('links the stripe customer id to the user on checkout.session.completed (the root-cause branch)', async () => {
    const sb = makeFakeSb();
    const res = await applyStripeEvent(sb, {
      id: 'evt_link', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'u0', customer: 'cus_1' } },
    } as never);
    expect(res).toEqual({ handled: true });
    const links = customerLinks(sb);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ row: { stripe_customer_id: 'cus_1' }, eqCol: 'id', eqVal: 'u0' });
  });

  it('does NOT link a customer when checkout.session.completed has no client_reference_id', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_nolink', type: 'checkout.session.completed',
      data: { object: { client_reference_id: null, customer: 'cus_1' } },
    } as never);
    expect(customerLinks(sb)).toHaveLength(0); // guard holds, no garbage write
  });

  it('sets pro_until from an active subscription', async () => {
    const sb = makeFakeSb();
    const periodEnd = 1782000000;
    await applyStripeEvent(sb, {
      id: 'evt_2', type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_1', status: 'active', current_period_end: periodEnd } },
    } as never);
    expect(proUpdates(sb)[0]?.row.pro_until).toBe(new Date(periodEnd * 1000).toISOString());
  });

  it('clears pro_until on a canceled subscription', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_3', type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_1', status: 'canceled', current_period_end: 1782000000 } },
    } as never);
    expect(proUpdates(sb)[0]?.row.pro_until).toBeNull();
  });

  it('does NOT downgrade an active subscription whose event omits the period end', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_noend', type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_1', status: 'active' } }, // no current_period_end, no items
    } as never);
    expect(proUpdates(sb)).toHaveLength(0); // left untouched, not cleared
  });

  it('throws (→ 500 → Stripe retry) when no user row carries the customer id yet', async () => {
    const sb = makeFakeSb({ userRows: 0 });
    await expect(
      applyStripeEvent(sb, {
        id: 'evt_race', type: 'customer.subscription.created',
        data: { object: { customer: 'cus_unlinked', status: 'active', current_period_end: 1782000000 } },
      } as never),
    ).rejects.toThrow(/no user for stripe_customer_id/);
  });

  it('rethrows on a non-conflict insert error (so the webhook returns 500 and Stripe retries)', async () => {
    const sb = makeFakeSb({ insertError: { code: '08006', message: 'connection failure' } });
    await expect(
      applyStripeEvent(sb, { id: 'evt_4', type: 'customer.subscription.updated', data: { object: {} } } as never),
    ).rejects.toThrow(/stripe_events insert failed/);
  });
});
