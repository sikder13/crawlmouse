import { inngest } from './client';
import { supabaseAdmin } from './supabase';
import { runReconcile, buildReconcileOpts, deleteExpiredAudits } from './billing-helpers';
import Stripe from 'stripe';

function stripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const PAGE = 200;

async function loadAllCustomers(sb: ReturnType<typeof supabaseAdmin>) {
  const all: { id: string; stripe_customer_id: string | null }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('users')
      .select('id, stripe_customer_id')
      .not('stripe_customer_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Load exactly the customers a run needs: when a single Stripe customer is targeted, fetch just
// that one row (a targeted repair must not pay for — or even read — the whole users table); else
// page the full set for a dry-run / full reconcile.
async function loadCustomers(sb: ReturnType<typeof supabaseAdmin>, customerId?: string) {
  if (customerId) {
    const { data, error } = await sb
      .from('users')
      .select('id, stripe_customer_id')
      .eq('stripe_customer_id', customerId);
    if (error) throw error;
    return data ?? [];
  }
  return loadAllCustomers(sb);
}

// SCHEDULED daily run — DRY-RUN ONLY. Logs intended pro_until repairs; writes nothing.
// A real repair is triggered explicitly via the manual function below.
export const reconcileBillingFn = inngest.createFunction(
  { id: 'crawlmouse.stripe-reconcile' },
  { cron: '0 3 * * *' },
  async ({ step }) =>
    step.run('reconcile-dry-run', async () => {
      const sb = supabaseAdmin();
      const stripe = stripeClient();
      const opts = buildReconcileOpts({
        secretKey: process.env.STRIPE_SECRET_KEY,
        livemodeEnv: process.env.STRIPE_RECONCILE_LIVEMODE,
        defaultMode: 'dry-run', // scheduled cron is dry-run ONLY — never writes
      });
      const customers = await loadCustomers(sb, opts.customerId);
      return runReconcile(sb, stripe, customers, opts);
    }),
);

// MANUAL reconcile — explicit `inngest.send({ name: 'billing.reconcile.requested', data: { mode, customerId } })`.
// Defaults to a real 'full' run because it is only ever invoked deliberately (deploy runbook / ops).
export const reconcileBillingManualFn = inngest.createFunction(
  { id: 'crawlmouse.stripe-reconcile-manual' },
  { event: 'billing.reconcile.requested' },
  async ({ event, step }) =>
    step.run('reconcile', async () => {
      const sb = supabaseAdmin();
      const stripe = stripeClient();
      const opts = buildReconcileOpts({
        secretKey: process.env.STRIPE_SECRET_KEY,
        livemodeEnv: process.env.STRIPE_RECONCILE_LIVEMODE,
        defaultMode: 'full', // manual run is deliberate → real repair by default
        event,
      });
      // A targeted single-customer (or any customerId-scoped) run reads only that one row.
      const customers = await loadCustomers(sb, opts.customerId);
      return runReconcile(sb, stripe, customers, opts);
    }),
);

// Daily TTL cleanup — bounded/batched delete of expired free audits (cascades to pages/links/findings).
export const cleanupExpiredAuditsFn = inngest.createFunction(
  { id: 'crawlmouse.audits-ttl-cleanup' },
  { cron: '0 4 * * *' },
  async ({ step }) =>
    step.run('delete-expired', async () => {
      const sb = supabaseAdmin();
      return deleteExpiredAudits(sb, new Date().toISOString());
    }),
);
