/**
 * The v2 nightly reconcile (CC-03 D10, plan §7): each account with a Stripe customer, and its
 * subscription mirror, compared with Stripe; what differs is reported to Sentry as
 * `reconcile.drift`, one message per account, at most `REPORT_CAP` of them. Nothing is written,
 * here or in Stripe: a drift is for a person to look at.
 *
 * Reported per account:
 * - `customer_missing`: Stripe has no such customer;
 * - `mirror_status`: a mirror row's status is not Stripe's (or Stripe does not list it);
 * - `followed_missing` / `followed_ended`: the subscription the account follows is not listed, or
 *   has ended (`canceled`, `incomplete_expired`);
 * - `tier_mismatch`: the account's tier is not the plan of the live subscription it follows;
 * - `double_billing`: a live (`trialing`, `active`, `past_due`) subscription with our prices that
 *   the account does not follow.
 * And from the ledger, `effects_unsent`: an event decided more than an hour ago whose effects were
 * never confirmed sent, which Stripe has likely stopped retrying.
 *
 * `accountReconcileFromEnv` builds the run for the Inngest seam in inngest/billing.ts; it refuses to
 * run when the key's mode is not STRIPE_ACCOUNT_LIVEMODE's.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import type Stripe from 'stripe';
import type { AccountState } from '@crawlmouse/types/v2';
import type { Tier } from '../entitlement-v2';
import { supabaseAdmin } from '../supabase/admin';
import type { Catalog } from './catalog';
import { billingV2Enabled } from './flags';
import type { SubscriptionStatus } from './state-machine';
import { expectedLivemode, stripeAccount } from './stripe-account';
import { accountCatalog } from './stripe-catalog';
import { mirrorOf } from './subscription-mirror';

type Env = Readonly<Record<string, string | undefined>>;

export const REPORT_CAP = 50;
/** How long a decided event may wait for its effects before it is drift. */
export const UNSENT_AFTER_MS = 60 * 60 * 1000;
const PAGE = 200;
const FLUSH_MS = 2000;

const LIVE: ReadonlySet<string> = new Set<SubscriptionStatus>(['trialing', 'active', 'past_due']);
const ENDED: ReadonlySet<string> = new Set<SubscriptionStatus>(['canceled', 'incomplete_expired']);

export type DriftKind =
  | 'customer_missing'
  | 'mirror_status'
  | 'followed_missing'
  | 'followed_ended'
  | 'tier_mismatch'
  | 'double_billing'
  | 'effects_unsent';

export interface Drift {
  kind: DriftKind;
  /** The subscription or the ledger event the drift is about. */
  ref: string | null;
}

export interface ReconcileAccount {
  id: string;
  state: AccountState;
  tier: Tier;
  currentSubscriptionId: string | null;
  stripeCustomerId: string;
}

export interface ReconcileDeps {
  /** Every live account with a Stripe customer, a page at a time. */
  accounts(): AsyncIterable<ReconcileAccount[]>;
  /** The mirror rows of these accounts: id and status, by account. */
  mirrors(accountIds: string[]): Promise<Map<string, { id: string; status: string }[]>>;
  /** Ledger rows decided before `before` whose effects were never confirmed sent. */
  unsent(before: Date): Promise<{ id: string; accountId: string | null }[]>;
  /** The customer's subscriptions in Stripe, or null when Stripe has no such customer. */
  listSubscriptions(customerId: string): Promise<Stripe.Subscription[] | null>;
  catalog: Catalog;
  report(accountId: string | null, drifts: Drift[]): void;
  /** How many drifted accounts were not reported, past the cap. */
  withheld(count: number): void;
  now: Date;
}

export interface DriftReport {
  checked: number;
  drifted: number;
  reported: number;
  withheld: number;
  kinds: Partial<Record<DriftKind, number>>;
}

const ours = async (s: Stripe.Subscription, catalog: Catalog) => {
  const m = await mirrorOf(s, catalog);
  return 'refused' in m ? null : m;
};

async function driftOf(
  a: ReconcileAccount,
  mirrors: { id: string; status: string }[],
  deps: ReconcileDeps,
): Promise<Drift[]> {
  const subs = await deps.listSubscriptions(a.stripeCustomerId);
  if (subs === null) return [{ kind: 'customer_missing', ref: a.stripeCustomerId }];
  const inStripe = new Map(subs.map((s) => [s.id, s]));
  const drifts: Drift[] = [];
  for (const m of mirrors) {
    if (inStripe.get(m.id)?.status !== m.status) drifts.push({ kind: 'mirror_status', ref: m.id });
  }
  if (a.currentSubscriptionId !== null) {
    const followed = inStripe.get(a.currentSubscriptionId);
    if (followed === undefined) {
      drifts.push({ kind: 'followed_missing', ref: a.currentSubscriptionId });
    } else if (ENDED.has(followed.status)) {
      drifts.push({ kind: 'followed_ended', ref: followed.id });
    } else if (LIVE.has(followed.status)) {
      const m = await ours(followed, deps.catalog);
      if (m !== null && m.plan !== a.tier) drifts.push({ kind: 'tier_mismatch', ref: followed.id });
    }
  }
  for (const s of subs) {
    if (s.id === a.currentSubscriptionId || !LIVE.has(s.status)) continue;
    if ((await ours(s, deps.catalog)) !== null) drifts.push({ kind: 'double_billing', ref: s.id });
  }
  return drifts;
}

export async function reconcileAccounts(deps: ReconcileDeps): Promise<DriftReport> {
  const drifted = new Map<string | null, Drift[]>();
  const add = (accountId: string | null, drifts: Drift[]) =>
    drifted.set(accountId, [...(drifted.get(accountId) ?? []), ...drifts]);
  let checked = 0;
  for await (const page of deps.accounts()) {
    const mirrors = await deps.mirrors(page.map((a) => a.id));
    for (const a of page) {
      checked++;
      const drifts = await driftOf(a, mirrors.get(a.id) ?? [], deps);
      if (drifts.length > 0) add(a.id, drifts);
    }
  }
  for (const u of await deps.unsent(new Date(deps.now.getTime() - UNSENT_AFTER_MS))) {
    add(u.accountId, [{ kind: 'effects_unsent', ref: u.id }]);
  }

  const kinds: Partial<Record<DriftKind, number>> = {};
  let reported = 0;
  for (const [accountId, drifts] of drifted) {
    for (const d of drifts) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    if (reported < REPORT_CAP) {
      deps.report(accountId, drifts);
      reported++;
    }
  }
  const withheld = drifted.size - reported;
  if (withheld > 0) deps.withheld(withheld);
  return { checked, drifted: drifted.size, reported, withheld, kinds };
}

/** Whether a Stripe secret or restricted key is a live one. Anything else throws. */
export function keyLivemode(key: string): boolean {
  if (/^(sk|rk)_live_/.test(key)) return true;
  if (/^(sk|rk)_test_/.test(key)) return false;
  throw new Error('STRIPE_ACCOUNT_SECRET_KEY is not a Stripe secret or restricted key');
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

/** The reads over PostgREST (`sb` the service-role client) and the Stripe account's client. */
export function productionReconcileDeps(
  sb: SupabaseClient,
  stripe: Stripe,
  catalog: Catalog,
  now: Date,
): ReconcileDeps {
  return {
    async *accounts() {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from('accounts')
          .select('id, state, tier, current_subscription_id, stripe_customer_id')
          .not('stripe_customer_id', 'is', null)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) failed('accounts read', error);
        const rows = data ?? [];
        yield rows.map((r) => ({
          id: r.id as string,
          state: r.state as AccountState,
          tier: r.tier as Tier,
          currentSubscriptionId: r.current_subscription_id as string | null,
          stripeCustomerId: r.stripe_customer_id as string,
        }));
        if (rows.length < PAGE) return;
      }
    },
    async mirrors(accountIds) {
      const out = new Map<string, { id: string; status: string }[]>();
      if (accountIds.length === 0) return out;
      const { data, error } = await sb
        .from('subscriptions')
        .select('id, account_id, status')
        .in('account_id', accountIds);
      if (error) failed('subscriptions read', error);
      for (const r of data ?? []) {
        const id = r.account_id as string;
        out.set(id, [...(out.get(id) ?? []), { id: r.id as string, status: r.status as string }]);
      }
      return out;
    },
    async unsent(before) {
      const { data, error } = await sb
        .from('stripe_events')
        .select('id, account_id')
        .not('handled', 'is', null)
        .is('processed_at', null)
        .lt('received_at', before.toISOString());
      if (error) failed('stripe_events read', error);
      return (data ?? []).map((r) => ({
        id: r.id as string,
        accountId: r.account_id as string | null,
      }));
    },
    async listSubscriptions(customer) {
      const subs: Stripe.Subscription[] = [];
      try {
        for await (const s of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) {
          subs.push(s);
        }
      } catch (err) {
        if ((err as { code?: string }).code === 'resource_missing') return null;
        throw err;
      }
      return subs;
    },
    catalog,
    report(accountId, drifts) {
      Sentry.captureMessage('reconcile.drift', {
        level: 'warning',
        tags: { signal: 'reconcile-drift' },
        extra: { accountId, drifts: drifts.map((d) => `${d.kind}:${d.ref ?? ''}`) },
      });
    },
    withheld(count) {
      Sentry.captureMessage('reconcile.drift.withheld', {
        level: 'warning',
        tags: { signal: 'reconcile-drift' },
        extra: { withheld: count },
      });
    },
    now,
  };
}

/** The v2 reconcile for inngest/billing.ts's seam, or null with V2_BILLING unset. */
export function accountReconcileFromEnv(
  env: Env = process.env,
): (() => Promise<DriftReport>) | null {
  if (!billingV2Enabled(env)) return null;
  return async () => {
    const key = env.STRIPE_ACCOUNT_SECRET_KEY;
    if (!key) throw new Error('STRIPE_ACCOUNT_SECRET_KEY is not set');
    if (keyLivemode(key) !== expectedLivemode(env)) {
      throw new Error(
        "the reconcile refuses to run: the key's mode is not STRIPE_ACCOUNT_LIVEMODE's",
      );
    }
    const report = await reconcileAccounts(
      productionReconcileDeps(supabaseAdmin(), stripeAccount(env), accountCatalog(), new Date()),
    );
    await Sentry.flush(FLUSH_MS);
    return report;
  };
}
