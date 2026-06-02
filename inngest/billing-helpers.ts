import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { ACTIVE_STATUSES, subscriptionPeriodEnd } from '@crawlmouse/types';

export interface ReconcileCustomer {
  id: string;
  stripe_customer_id: string | null;
}

/**
 * Derive the `pro_until` a customer's subscriptions imply. The discriminated result makes the
 * "leave them alone" case unrepresentable as a value:
 * - `{ skip: true }` — the customer has an active sub but NO resolvable period-end, so we can't
 *   compute a value and must NOT downgrade an existing subscriber.
 * - `{ skip: false, proUntil }` — `proUntil` is the latest period-end across active subs, or null
 *   when none are active (→ clear Pro).
 */
export type DerivedProUntil = { skip: true } | { skip: false; proUntil: string | null };

export function deriveProUntil(subs: Stripe.Subscription[]): DerivedProUntil {
  const activeSubs = subs.filter((s) => ACTIVE_STATUSES.has(s.status));
  const periodEnds = activeSubs
    .map((s) => subscriptionPeriodEnd(s))
    .filter((x): x is number => x != null);
  if (activeSubs.length > 0 && periodEnds.length === 0) return { skip: true };
  return { skip: false, proUntil: periodEnds.length ? new Date(Math.max(...periodEnds) * 1000).toISOString() : null };
}

/**
 * Reconcile one page of customers against Stripe, returning how many `pro_until` values we
 * repaired. A deleted/invalid customer (Stripe `resource_missing`) is logged and skipped so one
 * bad id can't fail the whole chunk's `step.run` — but every OTHER error (Stripe rate-limit /
 * network / auth, or a Supabase read/write fault) is re-thrown so the step retries the chunk
 * rather than silently reporting a "successful" run that repaired nothing.
 */
export async function reconcileCustomerChunk(
  sb: SupabaseClient,
  stripe: Stripe,
  customers: ReconcileCustomer[],
): Promise<{ chunkRepaired: number }> {
  let chunkRepaired = 0;
  for (const u of customers) {
    if (!u.stripe_customer_id) continue;
    let subs: { data: Stripe.Subscription[] };
    try {
      subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id, status: 'all', limit: 100 });
    } catch (err) {
      if ((err as { code?: string })?.code === 'resource_missing') {
        console.error(`[reconcile] skipping deleted customer ${u.id} (${u.stripe_customer_id})`);
        continue;
      }
      throw err; // transient/systemic → let step.run retry the chunk
    }
    const derived = deriveProUntil(subs.data);
    if (derived.skip) continue;
    const { data: row, error: readErr } = await sb.from('users').select('pro_until').eq('id', u.id).maybeSingle();
    if (readErr) throw readErr;
    if ((row?.pro_until ?? null) !== derived.proUntil) {
      const { error: writeErr } = await sb.from('users').update({ pro_until: derived.proUntil }).eq('id', u.id);
      if (writeErr) throw writeErr;
      chunkRepaired++;
    }
  }
  return { chunkRepaired };
}
