/**
 * The v2 price catalog (CC-03 D3). Prices are addressed by lookup key, never by id or by anything a
 * client sends: `priceFor` turns a plan into the price id to charge, and `planOfPrice` is the
 * allow-list a webhook event's prices are read through. A price that is not one of the eight below is
 * not ours, whatever its metadata says.
 *
 * `CATALOG` is what each key sells and for how much; the amounts are `prices.ts`'s, so a price whose
 * Stripe amount differs from what the pages show is refused rather than charged. `stripeCatalog`
 * (./stripe-catalog.ts) resolves the keys through the Stripe API.
 */
import type { PaidTier } from '../entitlement-v2';
import {
  AGENCY_MONTHLY,
  AGENCY_YEARLY,
  EXTRA_SEAT,
  EXTRA_SEAT_YEARLY,
  EXTRA_SITE,
  EXTRA_SITE_YEARLY,
  PRO_MONTHLY,
  PRO_YEARLY,
} from './prices';

export type Interval = 'month' | 'year';
/** The plan itself, or one of Agency's two quantity add-ons. */
export type PriceKind = 'base' | 'seat' | 'site';

export interface CatalogPrice {
  plan: PaidTier;
  interval: Interval;
  kind: PriceKind;
}

export interface CatalogEntry extends CatalogPrice {
  /** In cents: `prices.ts`'s whole dollars × 100. */
  unitAmount: number;
}

export const CATALOG: Readonly<Record<string, Readonly<CatalogEntry>>> = Object.freeze({
  crawlmouse_pro_monthly: {
    plan: 'pro',
    interval: 'month',
    kind: 'base',
    unitAmount: PRO_MONTHLY * 100,
  },
  crawlmouse_pro_yearly: {
    plan: 'pro',
    interval: 'year',
    kind: 'base',
    unitAmount: PRO_YEARLY * 100,
  },
  crawlmouse_agency_monthly: {
    plan: 'agency',
    interval: 'month',
    kind: 'base',
    unitAmount: AGENCY_MONTHLY * 100,
  },
  crawlmouse_agency_yearly: {
    plan: 'agency',
    interval: 'year',
    kind: 'base',
    unitAmount: AGENCY_YEARLY * 100,
  },
  crawlmouse_seat_monthly: {
    plan: 'agency',
    interval: 'month',
    kind: 'seat',
    unitAmount: EXTRA_SEAT * 100,
  },
  crawlmouse_seat_yearly: {
    plan: 'agency',
    interval: 'year',
    kind: 'seat',
    unitAmount: EXTRA_SEAT_YEARLY * 100,
  },
  crawlmouse_site_monthly: {
    plan: 'agency',
    interval: 'month',
    kind: 'site',
    unitAmount: EXTRA_SITE * 100,
  },
  crawlmouse_site_yearly: {
    plan: 'agency',
    interval: 'year',
    kind: 'site',
    unitAmount: EXTRA_SITE_YEARLY * 100,
  },
});

/** The lookup key of a plan's price. Pro sells no seats or sites, so asking for one throws. */
export function lookupKey(plan: PaidTier, interval: Interval, kind: PriceKind): string {
  const found = Object.entries(CATALOG).find(
    ([, e]) => e.plan === plan && e.interval === interval && e.kind === kind,
  );
  if (!found) throw new RangeError(`no ${plan} ${kind} price billed each ${interval}`);
  return found[0];
}

export interface Catalog {
  /** The price id to charge for this plan; throws when the catalog cannot be resolved. */
  priceFor(plan: PaidTier, interval: Interval, kind: PriceKind): Promise<string>;
  /** What a price id sells, or null when it is not one of the catalog's. */
  planOfPrice(priceId: string): Promise<CatalogPrice | null>;
}
