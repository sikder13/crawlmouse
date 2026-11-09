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

export function stripeAccount(env: Env = process.env): Stripe {
  if (client) return client;
  const key = env.STRIPE_ACCOUNT_SECRET_KEY;
  if (!key) throw new Error('STRIPE_ACCOUNT_SECRET_KEY is not set');
  client = new Stripe(key);
  return client;
}

/** Whether the account's events must be live ones: `STRIPE_ACCOUNT_LIVEMODE=true`, anything else test. */
export function expectedLivemode(env: Env = process.env): boolean {
  return env.STRIPE_ACCOUNT_LIVEMODE === 'true';
}
