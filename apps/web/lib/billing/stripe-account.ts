import 'server-only';
import Stripe from 'stripe';

/**
 * The Crawlmouse Stripe account (CC-03 D2), which v2 bills through. v1 bills the Nahl Technologies
 * account through `lib/stripe.ts`; the two share no key, secret or client.
 *
 * Built on first use, not at import: `STRIPE_ACCOUNT_SECRET_KEY` is unset wherever `V2_BILLING` is, and
 * the Stripe constructor throws without a key, so a module-level client would break every route that
 * imports this. Signature checks need no key and use the static `Stripe.webhooks`.
 */

type Env = Readonly<Record<string, string | undefined>>;

let client: Stripe | null = null;

/**
 * Refuses a key whose mode is not the one `STRIPE_ACCOUNT_LIVEMODE` names, and a test key on the
 * production deployment (`VERCEL_ENV=production`): there, test cards would buy real plans. The v2
 * routes, the webhook and the reconcile take their client from here, so a refusal stops each with a
 * 500 and no write. The other client outside tests is v1's (`grep -rln "new Stripe(" apps/web/lib
 * apps/web/app` lists lib/stripe.ts and this file, beside test files).
 */
export function stripeAccount(env: Env = process.env): Stripe {
  if (client) return client;
  const key = env.STRIPE_ACCOUNT_SECRET_KEY;
  if (!key) throw new Error('STRIPE_ACCOUNT_SECRET_KEY is not set');
  const live = /^(sk|rk)_live_/.test(key);
  if (!live && !/^(sk|rk)_test_/.test(key)) {
    throw new Error('STRIPE_ACCOUNT_SECRET_KEY is neither a live nor a test secret key');
  }
  if (live !== expectedLivemode(env)) {
    throw new Error('STRIPE_ACCOUNT_SECRET_KEY is not the mode STRIPE_ACCOUNT_LIVEMODE names');
  }
  if (!live && env.VERCEL_ENV === 'production') {
    throw new Error('the production deployment bills in live mode only');
  }
  client = new Stripe(key);
  return client;
}

/** Whether the account's events must be live ones: `STRIPE_ACCOUNT_LIVEMODE=true`, anything else test. */
export function expectedLivemode(env: Env = process.env): boolean {
  return env.STRIPE_ACCOUNT_LIVEMODE === 'true';
}
