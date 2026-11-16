/**
 * The Stripe customer portal configuration v2 opens (CC-03 D8, spec 03 Q7): payment method update,
 * invoice history and cancellation at the end of the period without proration, and nothing else.
 * The cancellation asks why, offering every reason Stripe has (CC-41 D8c). The
 * account's default configuration allows plan changes and customer details, so v2 uses its own, found
 * by `metadata.crawlmouse_key`, created on first use and updated back when its features have drifted.
 */
import type Stripe from 'stripe';
import { stripeAccount } from './stripe-account';

type Configuration = Stripe.BillingPortal.Configuration;

const KEY = 'portal_v2_billing';

type Reason =
  Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionCancel.CancellationReason.Option;

/** Every option of Stripe's cancellation reason (stripe 22.2.0). */
const REASONS: readonly Reason[] = [
  'customer_service',
  'low_quality',
  'missing_features',
  'other',
  'switched_service',
  'too_complex',
  'too_expensive',
  'unused',
];

const FEATURES: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
  payment_method_update: { enabled: true },
  invoice_history: { enabled: true },
  subscription_cancel: {
    enabled: true,
    mode: 'at_period_end',
    proration_behavior: 'none',
    cancellation_reason: { enabled: true, options: [...REASONS] },
  },
  subscription_update: { enabled: false },
  customer_update: { enabled: false },
};

const ALLOWED: readonly string[] = [
  'payment_method_update',
  'invoice_history',
  'subscription_cancel',
];

/** The Stripe calls this module makes. */
export interface PortalConfigurationSource {
  billingPortal: {
    configurations: {
      list(params: Stripe.BillingPortal.ConfigurationListParams): AsyncIterable<Configuration>;
      create(params: Stripe.BillingPortal.ConfigurationCreateParams): PromiseLike<Configuration>;
      update(
        id: string,
        params: Stripe.BillingPortal.ConfigurationUpdateParams,
      ): PromiseLike<Configuration>;
    };
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
}

/**
 * How a configuration differs from D8, empty when it does not. Every feature Stripe returns is read:
 * one outside the three allowed counts as on unless it says `enabled: false`.
 */
export function portalDrift(c: Configuration): string[] {
  const features = c.features as unknown as Record<
    string,
    { enabled?: unknown } | null | undefined
  >;
  const drift: string[] = [];
  for (const name of ALLOWED) {
    if (features[name]?.enabled !== true) drift.push(`${name} is off`);
  }
  const cancel = c.features.subscription_cancel;
  if (cancel?.mode !== 'at_period_end') drift.push('cancellation is not at the period end');
  if (cancel?.proration_behavior !== 'none') drift.push('cancellation prorates');
  const reason = cancel?.cancellation_reason;
  if (reason?.enabled !== true) drift.push('cancellation reason is off');
  if (!sameSet(reason?.options ?? [], REASONS)) drift.push('cancellation reason options differ');
  for (const [name, feature] of Object.entries(features)) {
    if (!ALLOWED.includes(name) && feature?.enabled !== false) drift.push(`${name} is on`);
  }
  return drift;
}

function checked(c: Configuration): string {
  const drift = portalDrift(c);
  if (drift.length > 0) throw new Error(`portal configuration ${c.id}: ${drift.join('; ')}`);
  return c.id;
}

/** The id of v2's portal configuration, created or repaired as needed; throws if Stripe keeps it wrong. */
export async function portalConfiguration(stripe: PortalConfigurationSource): Promise<string> {
  const configurations = stripe.billingPortal.configurations;
  let found: Configuration | null = null;
  for await (const c of configurations.list({ active: true, limit: 100 })) {
    if (c.metadata?.crawlmouse_key === KEY) {
      found = c;
      break;
    }
  }
  if (found === null) {
    return checked(
      await configurations.create({ features: FEATURES, metadata: { crawlmouse_key: KEY } }),
    );
  }
  if (portalDrift(found).length === 0) return found.id;
  return checked(await configurations.update(found.id, { features: FEATURES }));
}

let shared: Promise<string> | null = null;

/** The Crawlmouse account's portal configuration, looked up once per process; a failure is retried. */
export function accountPortalConfiguration(): Promise<string> {
  if (shared === null) {
    const lookup = portalConfiguration(stripeAccount());
    shared = lookup;
    lookup.catch(() => {
      if (shared === lookup) shared = null;
    });
  }
  return shared;
}
