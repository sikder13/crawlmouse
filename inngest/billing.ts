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
    const ACTIVE = ['active', 'trialing', 'past_due'];
    const PAGE = 200;
    let from = 0;
    let checked = 0;
    let repaired = 0;
    // Paginate — a bare select caps at 1000 rows, which would silently skip customer #1001+.
    for (;;) {
      const { data: customers } = await sb
        .from('users')
        .select('id, stripe_customer_id')
        .not('stripe_customer_id', 'is', null)
        .range(from, from + PAGE - 1);
      if (!customers || customers.length === 0) break;
      for (const u of customers) {
        // A customer is Pro if ANY subscription is active — use the latest period-end among them.
        const subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id!, status: 'all', limit: 100 });
        const activeSubs = subs.data.filter((s) => ACTIVE.includes(s.status));
        const periodEnds = activeSubs
          .map((s) => (s as unknown as { current_period_end?: number }).current_period_end ?? s.items?.data?.[0]?.current_period_end ?? null)
          .filter((x): x is number => x != null);
        // Guard: active subs but no resolvable period-end → can't compute; don't downgrade.
        if (activeSubs.length > 0 && periodEnds.length === 0) continue;
        const proUntil = periodEnds.length ? new Date(Math.max(...periodEnds) * 1000).toISOString() : null;
        const { data: row } = await sb.from('users').select('pro_until').eq('id', u.id).maybeSingle();
        if ((row?.pro_until ?? null) !== proUntil) {
          await sb.from('users').update({ pro_until: proUntil }).eq('id', u.id);
          repaired++;
        }
      }
      checked += customers.length;
      if (customers.length < PAGE) break;
      from += PAGE;
    }
    return { checked, repaired };
  },
);

// Daily TTL cleanup — delete expired free audits (cascades to pages/links/findings).
export const cleanupExpiredAuditsFn = inngest.createFunction(
  { id: 'crawlmouse.audits-ttl-cleanup' },
  { cron: '0 4 * * *' },
  async () => {
    const sb = admin();
    // lte so a row exactly at the expiry instant is deleted (complements listMine's `gt` filter).
    const { data } = await sb.from('audits').delete().lte('expires_at', new Date().toISOString()).select('id');
    return { deleted: data?.length ?? 0 };
  },
);
