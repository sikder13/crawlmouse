import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { proUntilFrom, ACTIVE_STATUSES } from './pro-until';

/**
 * Idempotently apply a verified Stripe event to the users table.
 *
 * Idempotency model: `stripe_events.id` is the ledger PK and `processed_at` is the real
 * "done" gate. A 23505 conflict on insert means we've SEEN this event, but we only skip
 * if a prior attempt actually COMPLETED (processed_at set). If a prior attempt crashed
 * mid-flight (row inserted, processed_at null), we re-apply — so transient failures retry
 * cleanly instead of being permanently swallowed.
 */
export async function applyStripeEvent(sb: SupabaseClient, event: Stripe.Event): Promise<{ handled: boolean }> {
  const { error: dupe } = await sb.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dupe) {
    if ((dupe as { code?: string }).code === '23505') {
      const { data: prior } = await sb.from('stripe_events').select('processed_at').eq('id', event.id).maybeSingle();
      if (prior?.processed_at) return { handled: false }; // genuinely processed before → skip
      // else: a prior attempt inserted the row but crashed before finishing → fall through and re-apply.
    } else {
      throw new Error(`stripe_events insert failed: ${dupe.message ?? 'unknown error'}`);
    }
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session;
    const userId = s.client_reference_id;
    const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
    if (userId && customerId) {
      const { error } = await sb.from('users').update({ stripe_customer_id: customerId }).eq('id', userId);
      if (error) throw new Error(`users customer-link update failed: ${error.message}`);
    }
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    // current_period_end is top-level on older API versions, on the item in newer ones.
    const periodEnd =
      (sub as unknown as { current_period_end?: number }).current_period_end ??
      sub.items?.data?.[0]?.current_period_end ??
      null;

    // Guard: an active-ish event that omits the period end must NOT downgrade an existing
    // subscriber to null. Only write when we can compute a concrete pro_until, OR when the
    // status is genuinely non-active (cancel/unpaid/etc. → clear Pro).
    if (!(ACTIVE_STATUSES.has(sub.status) && periodEnd == null)) {
      const proUntil = proUntilFrom(sub.status, periodEnd);
      const { data: updated, error } = await sb
        .from('users')
        .update({ pro_until: proUntil })
        .eq('stripe_customer_id', customerId)
        .select('id');
      if (error) throw new Error(`users pro_until update failed: ${error.message}`);
      // No user row carries this customer id yet — i.e. checkout.session.completed (which links
      // the customer id) hasn't been processed. Stripe does NOT guarantee event ordering, so
      // throw to return 500 and let Stripe retry later; processed_at stays null so the retry
      // re-applies rather than being skipped as a duplicate.
      if (!updated || updated.length === 0) {
        throw new Error(`no user for stripe_customer_id ${customerId}; will retry`);
      }
    }
  }

  await sb.from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
  return { handled: true };
}
