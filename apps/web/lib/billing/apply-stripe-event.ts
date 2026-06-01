import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { proUntilFrom } from './pro-until';

/** Idempotently apply a verified Stripe event to the users table. */
export async function applyStripeEvent(sb: SupabaseClient, event: Stripe.Event): Promise<{ handled: boolean }> {
  // Idempotency: inserting the event id fails on replay (PK conflict) → skip.
  const { error: dupe } = await sb.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dupe) {
    // 23505 = unique_violation → this event id was already processed (idempotent replay); skip.
    if ((dupe as { code?: string }).code === '23505') return { handled: false };
    // Any other error is a genuine failure: throw so the route returns 500 and Stripe retries.
    throw new Error(`stripe_events insert failed: ${dupe.message ?? 'unknown error'}`);
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session;
    const userId = s.client_reference_id;
    const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
    if (userId && customerId) {
      await sb.from('users').update({ stripe_customer_id: customerId }).eq('id', userId);
    }
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const periodEnd =
      (sub as unknown as { current_period_end?: number }).current_period_end ??
      sub.items?.data?.[0]?.current_period_end ??
      null;
    const proUntil = proUntilFrom(sub.status, periodEnd);
    await sb.from('users').update({ pro_until: proUntil }).eq('stripe_customer_id', customerId);
  }

  await sb.from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
  return { handled: true };
}
