import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inngest } from '../../inngest/client';
import { admitSiteHost } from '../../apps/web/lib/auth/admit-site';
import { pepperFrom } from '../../apps/web/lib/auth/ledger';
import {
  dispatchPlanned,
  type EffectSinks,
  type PlannedEffect,
} from '../../apps/web/lib/billing/effects';
import { billingV2Enabled } from '../../apps/web/lib/billing/flags';
import { supabaseEntitlementStore } from '../../apps/web/lib/billing/state-machine-apply';
import { stripeAccount } from '../../apps/web/lib/billing/stripe-account';
import { stripeCatalog } from '../../apps/web/lib/billing/stripe-catalog';
import type { RequestDeps } from '../../apps/web/lib/v2/pipeline/request';
import type { BillingDeps, BillingStripe } from './billing';
import { qaInbox } from './inbox';
import type { ResetDeps } from './reset';
import type { QaAuth, SeedDeps } from './seed';
import { qaBillingAccounts, qaResetStore, qaStore } from './store';

/**
 * The QA scripts' production wiring, and the only file under scripts/qa that reads the environment
 * or makes a network client: the service-role Supabase client, Supabase Auth's admin API, the
 * Crawlmouse Stripe account and Inngest. Not imported by any test.
 *
 * Environment: QA_INBOX; SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY;
 * TRIAL_LEDGER_PEPPER for qa+protrial's trial; INNGEST_EVENT_KEY for the trial's events and the
 * sites' first audits; V2_BILLING=1 to send the trial's events at all, as the app does; for
 * `--billing`, STRIPE_ACCOUNT_SECRET_KEY and STRIPE_ACCOUNT_LIVEMODE (checked by the app's own
 * `stripeAccount`) and QA_ORIGIN, the base of the Checkout's return URLs (https://crawlmouse.com
 * when unset).
 */

type Env = Readonly<Record<string, string | undefined>>;

const PAGE = 1000;

const unsetSend = async (): Promise<never> => {
  throw new Error('INNGEST_EVENT_KEY unset');
};

/** A variable the run needs is unset. */
export class WiringError extends Error {}

function need(env: Env, ...names: string[]): string {
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) return v;
  }
  throw new WiringError(`set ${names.join(' or ')}`);
}

/** Supabase Auth's admin API: a confirmed user stamped with its set key, found by paging users. */
function adminAuth(sb: SupabaseClient): QaAuth {
  return {
    async find(email) {
      const want = email.toLowerCase();
      for (let page = 1; ; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: PAGE });
        if (error) throw new Error(`qa:seed: listUsers failed: ${error.message}`);
        const hit = data.users.find((u) => u.email?.toLowerCase() === want);
        if (hit) {
          const key = (hit.app_metadata as { qa_seed?: unknown } | undefined)?.qa_seed;
          return { id: hit.id, qaKey: typeof key === 'string' ? key : null };
        }
        if (data.users.length < PAGE) return null;
      }
    },
    async create(email, key) {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { qa_seed: key },
      });
      if (error) throw new Error(`qa:seed: createUser failed: ${error.message}`);
      return data.user.id;
    },
  };
}

export interface Wired {
  seed: SeedDeps;
  reset: ResetDeps;
  /** Built on first use: part (a) and qa:reset need no Stripe key. */
  billing(): BillingDeps;
}

export function wire(env: Env, print: (line: string) => void): Wired {
  const inbox = qaInbox(env);
  const sb = createClient(
    need(env, 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    need(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const auth = adminAuth(sb);

  const hasEventKey = Boolean(env.INNGEST_EVENT_KEY?.trim());
  if (!hasEventKey) {
    print(
      'INNGEST_EVENT_KEY unset: no event is sent. The trial is reported trial-dispatch-failed, and ' +
        "each new site's first audit is reported not sent and stays queued.",
    );
  }
  const send: RequestDeps['send'] = hasEventKey ? (event) => inngest.send(event) : unsetSend;
  // The app's dispatcher (lib/billing/effect-sinks.ts billingDispatcher) is server-only and Sentry's:
  // the same rule here, V2_BILLING=1 or nothing, and a trial plans sends only.
  const sinks: EffectSinks = {
    send: hasEventKey
      ? async (events) => {
          await inngest.send([...events]);
        }
      : unsetSend,
    cancel: async () => {
      throw new Error('qa:seed plans no cancellation');
    },
    alert: async () => {
      throw new Error('qa:seed plans no alert');
    },
  };
  const dispatch = billingV2Enabled(env)
    ? (planned: readonly PlannedEffect[]) => dispatchPlanned(planned, sinks)
    : async () => {};

  const now = () => new Date();
  const store = qaStore(sb, {
    send,
    admit: (host) => admitSiteHost(host),
    trial: {
      entitlement: supabaseEntitlementStore(sb),
      admit: (host) => admitSiteHost(host),
      report: (message, ctx) => print(`report: ${message} ${JSON.stringify(ctx)}`),
      pepper: pepperFrom(env),
      now,
      dispatch,
    },
    now,
  });

  const seed: SeedDeps = {
    auth,
    store,
    // CC-33's runInternal (scripts/ops/internal.ts) is not on this tree; the merge binds it here.
    markInternal: async () => {
      throw new Error('qa:seed needs CC-33 (scripts/ops/internal.ts); questions Q1');
    },
    inbox,
    print,
  };

  return {
    seed,
    reset: { ...seed, reset: qaResetStore(sb) },
    billing() {
      const stripe = stripeAccount(env);
      const catalog = stripeCatalog(stripe);
      const port: BillingStripe = {
        balance: { retrieve: () => stripe.balance.retrieve() },
        coupons: {
          retrieve: (id) => stripe.coupons.retrieve(id),
          create: (params) => stripe.coupons.create(params),
        },
        customers: {
          retrieve: async (id) => {
            const c = await stripe.customers.retrieve(id);
            return c.deleted ? { id: c.id, deleted: true } : { id: c.id, metadata: c.metadata };
          },
          create: (params, options) => stripe.customers.create(params, options),
        },
        checkout: {
          sessions: {
            list: (params) => stripe.checkout.sessions.list(params),
            expire: (id) => stripe.checkout.sessions.expire(id),
            create: (params) => stripe.checkout.sessions.create(params),
          },
        },
      };
      return {
        auth,
        store,
        accounts: qaBillingAccounts(sb),
        stripe: port,
        keyLive: /^(sk|rk)_live_/.test(need(env, 'STRIPE_ACCOUNT_SECRET_KEY')),
        priceFor: (plan, interval) => catalog.priceFor(plan, interval, 'base'),
        origin: env.QA_ORIGIN?.trim() || 'https://crawlmouse.com',
        inbox,
        now,
        async confirm(prompt) {
          const rl = createInterface({ input: stdin, output: stdout });
          try {
            return await rl.question(prompt);
          } finally {
            rl.close();
          }
        },
        print,
      };
    },
  };
}
