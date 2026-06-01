import { inngest } from './client';
import { supabaseAdmin } from './supabase';
import { ACTIVE_STATUSES, subscriptionPeriodEnd } from '@crawlmouse/types';
import Stripe from 'stripe';

function stripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const PAGE = 200;

// Daily Stripe reconciliation — repairs pro_until drift from any missed webhooks.
export const reconcileBillingFn = inngest.createFunction(
  { id: 'crawlmouse.stripe-reconcile' },
  { cron: '0 3 * * *' },
  async ({ step }) => {
    const sb = supabaseAdmin();
    const stripe = stripeClient();
    let from = 0;
    let checked = 0;
    let repaired = 0;
    // Paginate (a bare select caps at 1000 rows) and make each page its own step, so a transient
    // failure retries only that chunk instead of re-issuing every Stripe call from scratch.
    for (;;) {
      const result = await step.run(`reconcile-chunk-${from}`, async () => {
        const { data: customers } = await sb
          .from('users')
          .select('id, stripe_customer_id')
          .not('stripe_customer_id', 'is', null)
          .range(from, from + PAGE - 1);
        let chunkRepaired = 0;
        for (const u of customers ?? []) {
          // Pro if ANY subscription is active — use the latest period-end among them.
          const subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id!, status: 'all', limit: 100 });
          const activeSubs = subs.data.filter((s) => ACTIVE_STATUSES.has(s.status));
          const periodEnds = activeSubs
            .map((s) => subscriptionPeriodEnd(s))
            .filter((x): x is number => x != null);
          // Active subs but no resolvable period-end → can't compute; don't downgrade.
          if (activeSubs.length > 0 && periodEnds.length === 0) continue;
          const proUntil = periodEnds.length ? new Date(Math.max(...periodEnds) * 1000).toISOString() : null;
          const { data: row } = await sb.from('users').select('pro_until').eq('id', u.id).maybeSingle();
          if ((row?.pro_until ?? null) !== proUntil) {
            await sb.from('users').update({ pro_until: proUntil }).eq('id', u.id);
            chunkRepaired++;
          }
        }
        return { count: customers?.length ?? 0, chunkRepaired };
      });
      checked += result.count;
      repaired += result.chunkRepaired;
      if (result.count < PAGE) break;
      from += PAGE;
    }
    return { checked, repaired };
  },
);

// Daily TTL cleanup — delete expired free audits (cascades to pages/links/findings).
export const cleanupExpiredAuditsFn = inngest.createFunction(
  { id: 'crawlmouse.audits-ttl-cleanup' },
  { cron: '0 4 * * *' },
  async ({ step }) =>
    step.run('delete-expired', async () => {
      const sb = supabaseAdmin();
      // lte so a row exactly at the expiry instant is deleted (complements listMine's `gt` filter).
      const { data } = await sb.from('audits').delete().lte('expires_at', new Date().toISOString()).select('id');
      return { deleted: data?.length ?? 0 };
    }),
);
