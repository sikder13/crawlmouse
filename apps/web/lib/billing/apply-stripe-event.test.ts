import { describe, it, expect } from 'vitest';
import { applyStripeEvent } from './apply-stripe-event';

// Minimal fake Supabase client: records every .update(row) and simulates PK-conflict on insert.
function makeFakeSb(opts: { duplicate?: boolean; insertError?: { code?: string; message?: string } } = {}) {
  const calls = { userUpdates: [] as Record<string, unknown>[] };
  const sb = {
    calls,
    from() {
      return {
        insert: async () => ({ error: opts.duplicate ? { code: '23505', message: 'duplicate key' } : (opts.insertError ?? null) }),
        update(row: Record<string, unknown>) {
          return { eq: async () => { calls.userUpdates.push(row); return { error: null }; } };
        },
      };
    },
  };
  return sb as unknown as Parameters<typeof applyStripeEvent>[0] & { calls: typeof calls };
}

describe('applyStripeEvent', () => {
  it('is a no-op for a duplicate event id (idempotent)', async () => {
    const sb = makeFakeSb({ duplicate: true });
    const res = await applyStripeEvent(sb, { id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} } } as never);
    expect(res).toEqual({ handled: false });
    expect((sb as never as { calls: { userUpdates: unknown[] } }).calls.userUpdates).toHaveLength(0);
  });

  it('sets pro_until from an active subscription', async () => {
    const sb = makeFakeSb();
    const periodEnd = 1782000000;
    await applyStripeEvent(sb, {
      id: 'evt_2', type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_1', status: 'active', current_period_end: periodEnd } },
    } as never);
    const calls = (sb as never as { calls: { userUpdates: Record<string, unknown>[] } }).calls;
    const proUpdate = calls.userUpdates.find((u) => 'pro_until' in u);
    expect(proUpdate?.pro_until).toBe(new Date(periodEnd * 1000).toISOString());
  });

  it('clears pro_until on a canceled subscription', async () => {
    const sb = makeFakeSb();
    await applyStripeEvent(sb, {
      id: 'evt_3', type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_1', status: 'canceled', current_period_end: 1782000000 } },
    } as never);
    const calls = (sb as never as { calls: { userUpdates: Record<string, unknown>[] } }).calls;
    const proUpdate = calls.userUpdates.find((u) => 'pro_until' in u);
    expect(proUpdate?.pro_until).toBeNull();
  });

  it('rethrows on a non-conflict insert error (so the webhook returns 500 and Stripe retries)', async () => {
    const sb = makeFakeSb({ insertError: { code: '08006', message: 'connection failure' } });
    await expect(
      applyStripeEvent(sb, { id: 'evt_4', type: 'customer.subscription.updated', data: { object: {} } } as never),
    ).rejects.toThrow(/stripe_events insert failed/);
  });
});
