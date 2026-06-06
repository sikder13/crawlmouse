// TC-L1/A1/A3 live (strengthened): run the ACTUAL scheduled-reconcile path (buildReconcileOpts ->
// runReconcile) against PROD in DRY-RUN mode (writes nothing by construction). Now that a REAL Stripe
// customer exists (AU1/cus_UeUirlImaxTL5L), this exercises the customer-fetch + deriveProUntil + compare
// path live and confirms it reports NO false drift (pro_until matches the live subscription).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runReconcile, buildReconcileOpts } from '../../inngest/billing-helpers';
const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/web/.env.local', import.meta.url).pathname, 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const { data: customers } = await sb.from('users').select('id, stripe_customer_id').not('stripe_customer_id', 'is', null).order('id');
const opts = buildReconcileOpts({ secretKey: env.STRIPE_SECRET_KEY, livemodeEnv: env.STRIPE_RECONCILE_LIVEMODE, defaultMode: 'dry-run' });
// snapshot pro_until BEFORE
const before = await sb.from('users').select('id, pro_until').not('stripe_customer_id', 'is', null).order('id');
const summary = await runReconcile(sb as any, stripe, (customers ?? []) as any, opts);
const after = await sb.from('users').select('id, pro_until').not('stripe_customer_id', 'is', null).order('id');
const changed = JSON.stringify(before.data) !== JSON.stringify(after.data);
console.log(JSON.stringify({ opts: { mode: opts.mode, customerId: opts.customerId, expectLivemode: opts.expectLivemode, keyLivemode: opts.keyLivemode }, customerCount: customers?.length ?? 0, summary, proUntilChanged: changed, before: before.data, after: after.data }, null, 2));
