/**
 * The catalog without Stripe, for tests: each lookup key of `CATALOG` is the price `price_<key>`.
 * Test-only.
 */
import { CATALOG, lookupKey, type Catalog } from './catalog';

export const fakePriceId = (key: string): string => `price_${key}`;

export function fakeCatalog(): Catalog {
  return {
    async priceFor(plan, interval, kind) {
      return fakePriceId(lookupKey(plan, interval, kind));
    },
    async planOfPrice(priceId) {
      const key = /^price_(.+)$/.exec(priceId)?.[1] ?? null;
      const entry = key !== null && Object.hasOwn(CATALOG, key) ? CATALOG[key]! : null;
      return entry === null
        ? null
        : { plan: entry.plan, interval: entry.interval, kind: entry.kind };
    },
  };
}
