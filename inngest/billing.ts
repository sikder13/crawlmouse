import { inngest } from './client';
import { supabaseAdmin } from './supabase';
import { reconcileCustomerChunk } from './billing-helpers';
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
        const { data: customers, error: pageErr } = await sb
          .from('users')
          .select('id, stripe_customer_id')
          .not('stripe_customer_id', 'is', null)
          .order('id', { ascending: true }) // stable order so pages don't skip/repeat a customer
          .range(from, from + PAGE - 1);
        // Surface a page-read failure so step.run retries — otherwise an empty `customers`
        // would break the loop and report a "successful" reconcile that repaired nothing.
        if (pageErr) throw pageErr;
        // Per-customer Stripe errors are skipped inside the helper so one bad customer id
        // can't throw the whole chunk (which would re-issue every Stripe call on retry).
        const { chunkRepaired } = await reconcileCustomerChunk(sb, stripe, customers ?? []);
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
