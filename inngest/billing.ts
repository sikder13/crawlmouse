import { inngest } from './client';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
function stripeClient() { return new Stripe(process.env.STRIPE_SECRET_KEY!); }

// Daily Stripe reconciliation — repairs pro_until drift from any missed webhooks.
export const reconcileBillingFn = inngest.createFunction(
  { id: 'crawlmouse.stripe-reconcile' },
  { cron: '0 3 * * *' },
  async () => {
    const sb = admin();
    const stripe = stripeClient();
    const { data: customers } = await sb.from('users').select('id, stripe_customer_id').not('stripe_customer_id', 'is', null);
    let repaired = 0;
    for (const u of customers ?? []) {
      const subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id!, status: 'all', limit: 1 });
      const sub = subs.data[0];
      const active = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
      const periodEnd = active
        ? ((sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null)
        : null;
      const proUntil = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
      const { data: row } = await sb.from('users').select('pro_until').eq('id', u.id).maybeSingle();
      if ((row?.pro_until ?? null) !== proUntil) {
        await sb.from('users').update({ pro_until: proUntil }).eq('id', u.id);
        repaired++;
      }
    }
    return { checked: customers?.length ?? 0, repaired };
  },
);

// Daily TTL cleanup — delete expired free audits (cascades to pages/links/findings).
export const cleanupExpiredAuditsFn = inngest.createFunction(
  { id: 'crawlmouse.audits-ttl-cleanup' },
  { cron: '0 4 * * *' },
  async () => {
    const sb = admin();
    const { data } = await sb.from('audits').delete().lt('expires_at', new Date().toISOString()).select('id');
    return { deleted: data?.length ?? 0 };
  },
);
