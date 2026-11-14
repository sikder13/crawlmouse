import type Stripe from 'stripe';
import { checkoutRefusal } from '../../apps/web/lib/billing/checkout-refusal';
import type { Interval } from '../../apps/web/lib/billing/catalog';
import {
  TRIAL_DAYS,
  trialRefusal,
  type EntitlementSnapshot,
} from '../../apps/web/lib/billing/state-machine';
import { QA_ACCOUNTS, type QaAccount } from './accounts';
import { qaAddress } from './inbox';
import { noter, type Note, type QaAuth, type QaStore, type Step } from './seed';

/**
 * `pnpm qa:seed --billing` (CC-38 D1(b), questions Q2 and Q3): for each QA account that has a plan,
 * a Stripe Checkout Session of the shape the app opens (`startCheckout`, apps/web/lib/billing/
 * checkout-v2.ts), with the `INTERNAL-QA` coupon applied by id. The owner completes each printed
 * session once in a browser, and the real webhook's `checkout.session.completed` carries the plan
 * into the account and binds its customer. This script writes no account, subscription, tier or state.
 *
 * The session's parameters are startCheckout's for the same plan, interval and trial, plus
 * `discounts`, and for a session without a trial `payment_method_collection: 'if_required'`, so a
 * $0 checkout asks for no card; the Agency trial keeps `always`, its card on file. billing.test.ts
 * builds the app's own session through startCheckout and requires the two to differ in those fields
 * only. checkout-v2 is not imported here: it imports `server-only`.
 *
 * Refused before any account is read: a live key without `--live`; `--live` with a test key; a key
 * whose prefix and the API's `livemode` disagree; in live mode, a confirmation that is not the exact
 * phrase, asked after the accounts are printed; a coupon of that id that is not 100% off forever.
 * Refused per account: no user made by qa:seed, no `qa_accounts` row for it, `internal` false, a
 * stored customer without `metadata.internal = 'true'`, and what the app's checkout itself refuses.
 */

export const COUPON_ID = 'INTERNAL-QA';

/** startCheckout's `SESSION_LIFETIME_S` (checkout-v2.ts); the parity test fails if they differ. */
const SESSION_LIFETIME_S = 31 * 60;

/** The Stripe calls `--billing` makes. A promotion code is never among them. */
export interface BillingStripe {
  balance: { retrieve(): PromiseLike<{ livemode: boolean }> };
  coupons: {
    retrieve(
      id: string,
    ): PromiseLike<Pick<Stripe.Coupon, 'id' | 'percent_off' | 'duration' | 'valid'>>;
    create(params: Stripe.CouponCreateParams): PromiseLike<{ id: string }>;
  };
  customers: {
    retrieve(
      id: string,
    ): PromiseLike<{ id: string; deleted?: boolean; metadata?: Stripe.Metadata | null }>;
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

export interface BillingAccounts {
  /** The account's entitlement and stored Stripe customer; null when there is no such account. */
  read(
    accountId: string,
  ): Promise<{ snapshot: EntitlementSnapshot; stripeCustomerId: string | null } | null>;
}

export interface BillingDeps {
  auth: Pick<QaAuth, 'find'>;
  store: Pick<QaStore, 'personal' | 'agency' | 'marker' | 'isInternal'>;
  accounts: BillingAccounts;
  stripe: BillingStripe;
  /** Whether the secret key is a live one, by its prefix (`sk_live_`, `rk_live_`). */
  keyLive: boolean;
  /** The catalog's base price for the plan (`accountCatalog().priceFor(plan, interval, 'base')`). */
  priceFor(plan: 'pro' | 'agency', interval: Interval): Promise<string>;
  /** The base of the URLs Stripe returns the buyer to. */
  origin: string;
  inbox: { local: string; domain: string };
  now(): Date;
  /** Asks the operator, and answers what they typed. */
  confirm(prompt: string): Promise<string>;
  print(line: string): void;
}

export interface BillingOptions {
  /** `--live`: the operator means live mode. */
  live: boolean;
}

type Billed = QaAccount & { billing: NonNullable<QaAccount['billing']> };

const BILLED: readonly Billed[] = QA_ACCOUNTS.filter((a): a is Billed => a.billing !== null);

/** What the operator types to open live checkouts. */
export const livePhrase = (n: number): string => `open ${n} live checkouts`;

class Refused extends Error {}

export async function seedBilling(deps: BillingDeps, opts: BillingOptions): Promise<Step[]> {
  const steps: Step[] = [];
  const run = noter(steps, deps.print, 'run');
  try {
    await checkMode(deps, opts, run);
    await ensureCoupon(deps, run);
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    run('stopped', 'refused', e.message);
    return steps;
  }
  for (const account of BILLED) {
    const note = noter(steps, deps.print, account.key);
    try {
      await billOne(deps, account, note);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      note('checkout', 'refused', e.message);
    }
  }
  return steps;
}

async function checkMode(deps: BillingDeps, opts: BillingOptions, run: Note): Promise<void> {
  const apiLive = (await deps.stripe.balance.retrieve()).livemode;
  if (apiLive !== deps.keyLive) {
    throw new Refused('the key prefix and the Stripe account disagree on the mode');
  }
  if (deps.keyLive && !opts.live) throw new Refused('the key is a live key: pass --live to use it');
  if (!deps.keyLive && opts.live) throw new Refused('--live was given, but the key is a test key');
  if (!deps.keyLive) {
    run('mode', 'done', 'test');
    return;
  }
  deps.print('Live mode. A Checkout Session will be opened for each of these accounts:');
  for (const a of BILLED) {
    const b = a.billing;
    deps.print(
      `  ${a.key.padEnd(12)} ${qaAddress(deps.inbox, a.key)}  ${b.plan} ${b.interval}ly${b.trial ? ', trial' : ''}`,
    );
  }
  const phrase = livePhrase(BILLED.length);
  if ((await deps.confirm(`Type "${phrase}" to go on: `)) !== phrase) {
    throw new Refused('the confirmation was not typed');
  }
  run('mode', 'done', 'live, confirmed');
}

function isMissing(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'resource_missing';
}

async function ensureCoupon(deps: BillingDeps, run: Note): Promise<void> {
  let coupon: Awaited<ReturnType<BillingStripe['coupons']['retrieve']>>;
  try {
    coupon = await deps.stripe.coupons.retrieve(COUPON_ID);
  } catch (err) {
    if (!isMissing(err)) throw err;
    await deps.stripe.coupons.create({
      id: COUPON_ID,
      percent_off: 100,
      duration: 'forever',
      metadata: { internal: 'true' },
    });
    run('coupon', 'done', `${COUPON_ID} created`);
    return;
  }
  if (coupon.percent_off !== 100 || coupon.duration !== 'forever' || !coupon.valid) {
    throw new Refused(`${COUPON_ID} exists and is not a valid 100%-off-forever coupon`);
  }
  run('coupon', 'unchanged', COUPON_ID);
}

/** The plan already carried into the account by the webhook. */
function onPlan(s: EntitlementSnapshot, b: Billed['billing']): boolean {
  if (s.subscriptionId === null) return false;
  if (b.plan === 'pro') return s.state === 'pro';
  return b.trial ? s.state === 'agency_trial' || s.state === 'agency' : s.state === 'agency';
}

function isIdempotencyError(err: unknown): boolean {
  return (err as { type?: unknown } | null)?.type === 'StripeIdempotencyError';
}

async function billOne(deps: BillingDeps, account: Billed, note: Note): Promise<void> {
  const email = qaAddress(deps.inbox, account.key);
  const user = await deps.auth.find(email);
  if (user === null || user.qaKey !== account.key) {
    throw new Refused(`${email} is not a user qa:seed made: run qa:seed first`);
  }
  const home = account.home;
  const seat =
    home.kind === 'agency'
      ? await deps.store.agency(user.id, home.name)
      : await deps.store.personal(user.id);
  if (seat === null) throw new Refused('the account is missing: run qa:seed first');
  const accountId = seat.accountId;
  if ((await deps.store.marker(accountId)) !== account.key) {
    throw new Refused(`${accountId} has no qa_accounts row for ${account.key}`);
  }
  if (!(await deps.store.isInternal(accountId))) {
    throw new Refused(`${accountId} is not internal`);
  }
  const held = await deps.accounts.read(accountId);
  if (held === null) throw new Refused(`${accountId} is gone`);
  const b = account.billing;
  if (onPlan(held.snapshot, b)) {
    note('checkout', 'unchanged', `already ${held.snapshot.state}`);
    return;
  }
  const refusal = b.trial
    ? trialRefusal(held.snapshot, deps.now())
    : (checkoutRefusal(held.snapshot, b.plan)?.error ?? null);
  if (refusal !== null) throw new Refused(`the app's checkout refuses it: ${refusal}`);

  const price = await deps.priceFor(b.plan, b.interval);
  const customer = await customerFor(deps, accountId, email, held.stripeCustomerId);
  note('customer', held.stripeCustomerId === null ? 'done' : 'unchanged', customer);
  const open: string[] = [];
  for await (const s of deps.stripe.checkout.sessions.list({
    customer,
    status: 'open',
    limit: 100,
  })) {
    open.push(s.id);
  }
  for (const id of open) await deps.stripe.checkout.sessions.expire(id);

  const session = await deps.stripe.checkout.sessions.create(
    sessionParams({ accountId, customer, price, billing: b, origin: deps.origin, now: deps.now() }),
  );
  if (!session.url) throw new Error('the Checkout Session has no url');
  note('checkout', 'done', `${b.plan}${b.trial ? ' trial' : ''}: ${session.url}`);
}

/**
 * The stored customer, which must carry `internal`; else one created as startCheckout creates it,
 * under its idempotency key, with `internal` added. It is not stored here: the webhook binds it.
 */
async function customerFor(
  deps: BillingDeps,
  accountId: string,
  email: string,
  stored: string | null,
): Promise<string> {
  if (stored !== null) {
    const c = await deps.stripe.customers.retrieve(stored);
    if (c.deleted || c.metadata?.internal !== 'true') {
      throw new Refused(`the account's customer ${stored} does not carry internal=true`);
    }
    return stored;
  }
  try {
    const created = await deps.stripe.customers.create(
      { email, metadata: { account_id: accountId, internal: 'true' } },
      { idempotencyKey: `customer:${accountId}` },
    );
    return created.id;
  } catch (err) {
    if (!isIdempotencyError(err)) throw err;
    throw new Refused(
      'Stripe holds customer:<account> with other details (a checkout from the app within 24 hours)',
    );
  }
}

export interface SessionInput {
  accountId: string;
  customer: string;
  price: string;
  billing: Billed['billing'];
  origin: string;
  now: Date;
}

/** startCheckout's session for this plan (checkoutV2's terms, or agencyTrial's), with the coupon. */
export function sessionParams(i: SessionInput): Stripe.Checkout.SessionCreateParams {
  const metadata = { account_id: i.accountId };
  const trial = i.billing.trial;
  return {
    mode: 'subscription',
    customer: i.customer,
    client_reference_id: i.accountId,
    metadata,
    line_items: [{ price: i.price, quantity: 1 }],
    payment_method_types: ['card'],
    payment_method_collection: trial ? 'always' : 'if_required',
    discounts: [{ coupon: COUPON_ID }],
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    expires_at: Math.floor(i.now.getTime() / 1000) + SESSION_LIFETIME_S,
    subscription_data: trial
      ? {
          metadata,
          trial_period_days: TRIAL_DAYS,
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        }
      : { metadata },
    // checkoutV2 lands on Settings' plan page; agencyTrial on the agency workspace (AGENCY_HOME).
    success_url: `${i.origin}${trial ? '/agency' : '/settings/plan?checkout=done'}`,
    cancel_url: `${i.origin}${trial ? '/agency-trial' : '/settings/plan'}`,
  };
}
