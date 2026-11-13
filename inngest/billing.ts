import type { GetFunctionInput } from 'inngest';
import { inngest } from './client';
import { supabaseAdmin } from './supabase';
import { runReconcile, buildReconcileOpts, deleteExpiredAudits } from './billing-helpers';
import { pruneRateLimits } from './rate-limit-retention';
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

let accountReconcile: (() => Promise<unknown>) | null = null;

/**
 * The v2 reconcile (CC-03 D10). The app sets it when V2_BILLING is on
 * (apps/web/lib/billing/reconcile-v2.ts, accountReconcileFromEnv); the nightly run then runs it as a
 * second step after v1's. Null, the default, leaves the nightly run as v1's step alone.
 */
export function setAccountReconcile(run: (() => Promise<unknown>) | null): void {
  accountReconcile = run;
}

type ReconcileInput = Pick<GetFunctionInput<typeof inngest>, 'step'>;

/**
 * The nightly body, exported so a test can drive it with a fake `step`. v1's dry run first, then the
 * v2 reconcile when it is set; the run answers v1's summary either way.
 */
export async function reconcileBillingHandler({ step }: ReconcileInput) {
  const v1 = await step.run('reconcile-dry-run', async () => {
    const sb = supabaseAdmin();
    const stripe = stripeClient();
    const opts = buildReconcileOpts({
      secretKey: process.env.STRIPE_SECRET_KEY,
      livemodeEnv: process.env.STRIPE_RECONCILE_LIVEMODE,
      defaultMode: 'dry-run', // scheduled cron is dry-run ONLY — never writes
    });
    const customers = await loadCustomers(sb, opts.customerId);
    return runReconcile(sb, stripe, customers, opts);
  });
  const v2 = accountReconcile;
  if (v2 !== null) await step.run('reconcile-accounts', () => v2());
  return v1;
}

// SCHEDULED daily run — DRY-RUN ONLY. Logs intended pro_until repairs; writes nothing.
// A real repair is triggered explicitly via the manual function below.
export const reconcileBillingFn = inngest.createFunction(
  { id: 'crawlmouse.stripe-reconcile' },
  { cron: '0 3 * * *' },
  ({ step }) => reconcileBillingHandler({ step }),
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

// Daily TTL cleanup — bounded/batched delete of expired free audits (cascades to pages/links/findings),
// keeping an expired audit a public report names (C-4, deleteExpiredAudits),
// then the rate_limits rows whose window has ended (B-F1, rate-limit-retention.ts), each its own step.
export const cleanupExpiredAuditsFn = inngest.createFunction(
  { id: 'crawlmouse.audits-ttl-cleanup' },
  { cron: '0 4 * * *' },
  async ({ step }) => {
    const audits = await step.run('delete-expired', async () => {
      const sb = supabaseAdmin();
      return deleteExpiredAudits(sb, new Date().toISOString());
    });
    const rateLimits = await step.run('prune-rate-limits', async () =>
      pruneRateLimits(supabaseAdmin()),
    );
    return { audits, rateLimits };
  },
);
