/**
 * A Stripe subscription as the `subscriptions` mirror stores it (migration 001), read through the
 * catalog's allow-list (CC-03 D3). A subscription is ours when its items are one base price of
 * quantity 1 and, on Agency, up to one seat item and one site item, each a catalog price on the base
 * price's interval; its extras are the seat and site quantities, which the plan must sell. Other
 * shapes are refused (the cases are subscription-mirror.test.ts's), and the caller decides what a
 * refusal means: a grant is recorded, a revoke applies with the plan the mirror already holds
 * (spec 03, Q11).
 */
import type Stripe from 'stripe';
import { limitsFor, type Extras, type PaidTier } from '../entitlement-v2';
import type { Catalog, CatalogPrice, Interval } from './catalog';
import type { SubscriptionStatus } from './state-machine';

/** A `subscriptions` row's columns, as `apply_stripe_event` takes them. */
export interface MirrorRow {
  id: string;
  status: SubscriptionStatus;
  plan: PaidTier;
  interval: Interval;
  seat_quantity: number;
  extra_site_quantity: number;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ended_at: string | null;
  price_ids: string[];
}

/** The part of a stored mirror row a revoke reuses when Stripe's prices are not ours. */
export interface StoredMirror {
  accountId: string;
  plan: PaidTier;
  interval: Interval;
  seatQuantity: number;
  extraSiteQuantity: number;
}

export type MirrorRefusal = 'price not in the allow-list' | 'extras the plan does not sell';

export type MirrorResult =
  | { row: MirrorRow; plan: PaidTier; interval: Interval; extras: Extras }
  | { refused: MirrorRefusal; priceIds: string[] };

const isoOf = (seconds: number | null | undefined): string | null =>
  seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString();

/** The fields of the row Stripe owns: everything but what the prices say. */
function stripeFields(sub: Stripe.Subscription) {
  const ends = sub.items.data.map((i) => i.current_period_end);
  return {
    id: sub.id,
    status: sub.status,
    // API 2026-05-27.dahlia keeps the period on each item; the subscription's runs to the latest.
    current_period_end: ends.length > 0 ? isoOf(Math.max(...ends)) : null,
    trial_end: isoOf(sub.trial_end),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: isoOf(sub.canceled_at),
    ended_at: isoOf(sub.ended_at),
    price_ids: sub.items.data.map((i) => i.price.id),
  };
}

/**
 * The mirror row, plan, interval and extras of a subscription, or why it is not ours. A Stripe
 * error while the catalog resolves a price propagates; a price the catalog resolves as not ours refuses.
 */
export async function mirrorOf(sub: Stripe.Subscription, catalog: Catalog): Promise<MirrorResult> {
  const fields = stripeFields(sub);
  const refuse = (refused: MirrorRefusal): MirrorResult => ({
    refused,
    priceIds: fields.price_ids,
  });
  // With has_more the item list is cut, and a price past the cut could be anyone's.
  if (sub.items.has_more || sub.items.data.length === 0)
    return refuse('price not in the allow-list');
  const priced: { price: CatalogPrice; quantity: number }[] = [];
  for (const item of sub.items.data) {
    const price = await catalog.planOfPrice(item.price.id);
    if (price === null) return refuse('price not in the allow-list');
    priced.push({ price, quantity: item.quantity ?? 0 });
  }
  const bases = priced.filter((p) => p.price.kind === 'base');
  if (bases.length !== 1 || bases[0]!.quantity !== 1) return refuse('price not in the allow-list');
  const { plan, interval } = bases[0]!.price;
  const seats = priced.filter((p) => p.price.kind === 'seat');
  const sites = priced.filter((p) => p.price.kind === 'site');
  if (
    seats.length > 1 ||
    sites.length > 1 ||
    priced.some((p) => p.price.plan !== plan || p.price.interval !== interval)
  ) {
    return refuse('price not in the allow-list');
  }
  const extras: Extras = { seats: seats[0]?.quantity ?? 0, sites: sites[0]?.quantity ?? 0 };
  try {
    limitsFor(plan, extras);
  } catch {
    return refuse('extras the plan does not sell');
  }
  return {
    row: {
      ...fields,
      plan,
      interval,
      seat_quantity: extras.seats,
      extra_site_quantity: extras.sites,
    },
    plan,
    interval,
    extras,
  };
}

/** The row for a subscription whose prices are not ours: Stripe's fields, the stored plan. */
export function keptMirror(sub: Stripe.Subscription, stored: StoredMirror): MirrorRow {
  return {
    ...stripeFields(sub),
    plan: stored.plan,
    interval: stored.interval,
    seat_quantity: stored.seatQuantity,
    extra_site_quantity: stored.extraSiteQuantity,
  };
}
