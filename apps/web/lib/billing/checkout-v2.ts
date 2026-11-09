/**
 * v2 checkout (CC-03 D6): an account owner buys Pro or Agency through a Stripe Checkout Session on
 * the Crawlmouse account. The route has already established the owner; this decides whether the
 * account may buy, finds or creates its Stripe customer, and opens the session. The state change
 * comes back through the webhook.
 *
 * Refused, before any Stripe call: a plan the account already holds or exceeds (`plan_held`), and any
 * account that still follows a subscription (`subscription_open`, questions Q3), because a second
 * checkout would open a second subscription that Stripe keeps charging. The customer's other open
 * sessions are expired first and the new one lasts 31 minutes, so two tabs cannot both pay (plan
 * review, finding 1). Card only, so the subscription is `active` when the checkout completes
 * (questions Q12).
 *
 * The agency trial (./agency-trial.ts) opens its session through `startCheckout` here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { z } from 'zod';
import type { PaidTier } from '../entitlement-v2';
import type { Catalog, Interval } from './catalog';
import type { RequestBody } from './request-body';
import type { EntitlementSnapshot } from './state-machine';
import { snapshotFromRow, type AccountRow } from './state-machine-apply';
import { CatalogError } from './stripe-catalog';

/**
 * Stripe's minimum is 30 minutes after it creates the session. The extra minute covers the time the
 * request takes to reach Stripe, so a session is not refused for expiring a moment too soon.
 */
export const SESSION_LIFETIME_S = 31 * 60;

export interface BillingAccount {
  snapshot: EntitlementSnapshot;
  stripeCustomerId: string | null;
}

export interface CheckoutAccounts {
  /** The account's entitlement and Stripe customer; null when there is no such account. */
  read(accountId: string): Promise<BillingAccount | null>;
  /** Stores the customer where the account has none; true when this call stored it. */
  bindCustomer(accountId: string, customerId: string): Promise<boolean>;
}

/** The Stripe calls a checkout makes. */
export interface CheckoutStripe {
  customers: {
    create(
      params: Stripe.CustomerCreateParams,
      options: { idempotencyKey: string },
    ): PromiseLike<{ id: string }>;
  };
  checkout: {
    sessions: {
      list(params: Stripe.Checkout.SessionListParams): AsyncIterable<{ id: string }>;
      expire(id: string): PromiseLike<unknown>;
      create(params: Stripe.Checkout.SessionCreateParams): PromiseLike<{ url: string | null }>;
    };
  };
}

export interface CheckoutDeps {
  accounts: CheckoutAccounts;
  stripe: CheckoutStripe;
  catalog: Catalog;
  /** `resolveOrigin(req)`: the base of the URLs Stripe sends the buyer back to. */
  origin: string;
  now: () => Date;
  /** Raises an error for the founder. `extra` holds ids and reasons, never a body or a Stripe object. */
  report: (message: string, extra: Readonly<Record<string, string>>) => void;
}

export interface Buyer {
  accountId: string;
  /** The owner's sign-in address, given to a new Stripe customer. */
  email: string | null;
}

export type BillingRefusal = {
  ok: false;
  status: 400 | 409 | 503;
  error: string;
  detail?: Readonly<Record<string, string>>;
};
export type BillingResult = { ok: true; url: string } | BillingRefusal;

const UNAVAILABLE: BillingRefusal = { ok: false, status: 503, error: 'billing_unavailable' };

const CheckoutBody = z.strictObject({
  plan: z.enum(['pro', 'agency']),
  interval: z.enum(['month', 'year']),
  accountId: z.uuid().optional(),
});

export type CheckoutInput = z.infer<typeof CheckoutBody>;

/** A checkout body: the plan and the interval, never a price; null for anything else. */
export function parseCheckout(body: RequestBody): CheckoutInput | null {
  const parsed = CheckoutBody.safeParse(body.fields);
  return parsed.success ? parsed.data : null;
}

const RANK: Readonly<Record<PaidTier, number>> = { pro: 1, agency: 2 };

/** Why the account may not buy `plan` now, or null when it may. */
export function checkoutRefusal(s: EntitlementSnapshot, plan: PaidTier): BillingRefusal | null {
  if ((s.state === 'pro' || s.state === 'agency') && RANK[s.state] >= RANK[plan]) {
    return { ok: false, status: 409, error: 'plan_held' };
  }
  if (s.subscriptionId !== null) {
    return { ok: false, status: 409, error: 'subscription_open', detail: { next: 'portal' } };
  }
  return null;
}

function isIdempotencyError(err: unknown): boolean {
  return (err as { type?: unknown } | null)?.type === 'StripeIdempotencyError';
}

/**
 * The account's Stripe customer: the stored one, or one created with the idempotency key
 * `customer:<account>` and stored where none is. Null when Stripe refuses the key (a retry within
 * 24 hours with other details, such as a changed email) and the account still holds no customer.
 */
async function customerFor(
  deps: CheckoutDeps,
  buyer: Buyer,
  stored: string | null,
): Promise<string | null> {
  if (stored !== null) return stored;
  let created: { id: string };
  try {
    created = await deps.stripe.customers.create(
      { ...(buyer.email ? { email: buyer.email } : {}), metadata: { account_id: buyer.accountId } },
      { idempotencyKey: `customer:${buyer.accountId}` },
    );
  } catch (err) {
    if (!isIdempotencyError(err)) throw err;
    const now = await deps.accounts.read(buyer.accountId);
    if (now?.stripeCustomerId) return now.stripeCustomerId;
    deps.report('billing.customer-unavailable', { accountId: buyer.accountId });
    return null;
  }
  if (await deps.accounts.bindCustomer(buyer.accountId, created.id)) return created.id;
  const now = await deps.accounts.read(buyer.accountId);
  if (!now?.stripeCustomerId) throw new Error(`account ${buyer.accountId} holds no customer`);
  return now.stripeCustomerId;
}

async function expireOpenSessions(stripe: CheckoutStripe, customer: string): Promise<void> {
  const open: string[] = [];
  for await (const s of stripe.checkout.sessions.list({ customer, status: 'open', limit: 100 })) {
    open.push(s.id);
  }
  for (const id of open) await stripe.checkout.sessions.expire(id);
}

export interface CheckoutTerms {
  plan: PaidTier;
  interval: Interval;
  /** The page Stripe's back link returns to, under the origin. */
  cancelPath: string;
  /** A trial of this many days, with the card taken now and the plan charged at its end. */
  trialDays?: number;
}

/** Resolves the price and the customer, expires the customer's open sessions and opens one. */
export async function startCheckout(
  deps: CheckoutDeps,
  buyer: Buyer,
  account: BillingAccount,
  terms: CheckoutTerms,
): Promise<BillingResult> {
  let price: string;
  try {
    price = await deps.catalog.priceFor(terms.plan, terms.interval, 'base');
  } catch (err) {
    if (!(err instanceof CatalogError)) throw err;
    deps.report('billing.catalog-unavailable', { reason: err.message });
    return UNAVAILABLE;
  }
  const customer = await customerFor(deps, buyer, account.stripeCustomerId);
  if (customer === null) return UNAVAILABLE;
  await expireOpenSessions(deps.stripe, customer);

  const metadata = { account_id: buyer.accountId };
  const trial = terms.trialDays !== undefined;
  const session = await deps.stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: buyer.accountId,
    metadata,
    line_items: [{ price, quantity: 1 }],
    payment_method_types: ['card'],
    ...(trial ? { payment_method_collection: 'always' as const } : {}),
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    expires_at: Math.floor(deps.now().getTime() / 1000) + SESSION_LIFETIME_S,
    subscription_data: trial
      ? {
          metadata,
          trial_period_days: terms.trialDays,
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        }
      : { metadata },
    success_url: `${deps.origin}/settings/plan?checkout=done`,
    cancel_url: `${deps.origin}${terms.cancelPath}`,
  });
  if (!session.url) throw new Error('the Checkout Session has no url');
  return { ok: true, url: session.url };
}

export async function checkoutV2(
  deps: CheckoutDeps,
  input: Buyer & { plan: PaidTier; interval: Interval },
): Promise<BillingResult> {
  const account = await deps.accounts.read(input.accountId);
  if (account === null) throw new Error(`account ${input.accountId} not found`);
  const refusal = checkoutRefusal(account.snapshot, input.plan);
  if (refusal !== null) return refusal;
  return startCheckout(deps, input, account, {
    plan: input.plan,
    interval: input.interval,
    cancelPath: '/settings/plan',
  });
}

/** `AccountRow`'s columns, every one of them: the compiler refuses this object with one missing. */
const ROW_COLUMNS: Record<keyof AccountRow, true> = {
  state: true,
  tier: true,
  trial_variant: true,
  trial_ends_at: true,
  trial_used_at: true,
  past_due_tier: true,
  past_due_since: true,
  disputed_at: true,
  seat_limit: true,
  site_limit: true,
  competitor_limit: true,
  entitlement_version: true,
  current_subscription_id: true,
  entitlement_changed_at: true,
  state_history: true,
};

const ACCOUNT_COLUMNS = [...Object.keys(ROW_COLUMNS), 'stripe_customer_id'].join(', ');

/** The accounts port over the service-role client: `stripe_customer_id` is not member-readable. */
export function supabaseCheckoutAccounts(admin: SupabaseClient): CheckoutAccounts {
  return {
    async read(accountId) {
      const { data, error } = await admin
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw new Error(`accounts read failed: ${error.message}`);
      if (!data) return null;
      const row = data as unknown as AccountRow & { stripe_customer_id: string | null };
      return { snapshot: snapshotFromRow(row).snapshot, stripeCustomerId: row.stripe_customer_id };
    },
    async bindCustomer(accountId, customerId) {
      const { data, error } = await admin
        .from('accounts')
        .update({ stripe_customer_id: customerId })
        .eq('id', accountId)
        .is('stripe_customer_id', null)
        .select('id');
      if (error) throw new Error(`accounts customer write failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
