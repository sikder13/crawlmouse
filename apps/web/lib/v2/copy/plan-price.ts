/**
 * A plan's list price as the screens show it, read from `lib/billing/prices.ts` (CC-39 ruling 4: a
 * shown price is never a typed number). `__tests__/v2/shown-prices.test.tsx` fails when a screen or a
 * copy module names a price these do not give.
 */
import {
  AGENCY_MONTHLY,
  AGENCY_PLUS_FROM_MONTHLY,
  AGENCY_YEARLY,
  EXTRA_SEAT,
  EXTRA_SEAT_YEARLY,
  EXTRA_SITE,
  EXTRA_SITE_YEARLY,
  PRO_MONTHLY,
  PRO_YEARLY,
  usd,
} from '../../billing/prices';

export type PricedPlan = 'free' | 'pro' | 'agency';
export type PriceInterval = 'month' | 'year';

const PLAN: Record<PricedPlan, Record<PriceInterval, number>> = {
  free: { month: 0, year: 0 },
  pro: { month: PRO_MONTHLY, year: PRO_YEARLY },
  agency: { month: AGENCY_MONTHLY, year: AGENCY_YEARLY },
};

const EXTRA: Record<'seat' | 'site', Record<PriceInterval, number>> = {
  seat: { month: EXTRA_SEAT, year: EXTRA_SEAT_YEARLY },
  site: { month: EXTRA_SITE, year: EXTRA_SITE_YEARLY },
};

/** "$99": the plan's price for one month or one year. */
export function formatPlanPrice(plan: PricedPlan, interval: PriceInterval = 'month'): string {
  return usd(PLAN[plan][interval]);
}

/** "$12": an Agency seat or site beyond the plan's, for one month or one year. */
export function formatExtraPrice(item: 'seat' | 'site', interval: PriceInterval = 'month'): string {
  return usd(EXTRA[item][interval]);
}

/** Every price the screens may show, formatted: what the sweep test checks a shown price against. */
export const SHOWN_PRICES: ReadonlySet<string> = new Set([
  ...[...Object.values(PLAN), ...Object.values(EXTRA)].flatMap((p) => [p.month, p.year].map(usd)),
  usd(AGENCY_PLUS_FROM_MONTHLY),
]);
