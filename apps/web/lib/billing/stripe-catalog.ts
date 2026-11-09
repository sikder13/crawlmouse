/**
 * The v2 catalog resolved through the Stripe API (CC-03 D3): one listing of the eight lookup keys,
 * kept by the instance. A listed price counts as the key's only when it is what `CATALOG` says the key
 * sells (recurring, licensed, billed each one month or year, in dollars, at the pages' amount); any
 * other price under the key leaves the key unresolved.
 *
 * `priceFor` needs all eight keys resolved and otherwise throws `CatalogError`, which the routes answer
 * with 503 `billing_unavailable`. `planOfPrice` is the webhook's allow-list: an id the listing does not
 * hold is listed again, at most once a minute after the last successful listing, and only an id absent
 * from a successful listing is answered null. A listing that fails throws, so the webhook answers 500
 * and Stripe retries instead of the event being recorded as foreign (spec 03, review finding 4).
 */
import type Stripe from 'stripe';
import type { PaidTier } from '../entitlement-v2';
import {
  CATALOG,
  lookupKey,
  type Catalog,
  type CatalogPrice,
  type Interval,
  type PriceKind,
} from './catalog';
import { stripeAccount } from './stripe-account';

export const REFRESH_INTERVAL_MS = 60_000;

export class CatalogError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CatalogError';
  }
}

/** The Stripe call the catalog makes. */
export interface PriceSource {
  prices: { list(params: Stripe.PriceListParams): PromiseLike<{ data: Stripe.Price[] }> };
}

/** What a listed price sells when it is the price `CATALOG` names for its lookup key, else null. */
export function acceptedPrice(p: Stripe.Price): CatalogPrice | null {
  const key = p.lookup_key;
  if (key === null || !Object.hasOwn(CATALOG, key)) return null;
  const entry = CATALOG[key]!;
  const r = p.recurring;
  const sells =
    p.active &&
    p.type === 'recurring' &&
    r !== null &&
    r.interval === entry.interval &&
    r.interval_count === 1 &&
    r.usage_type === 'licensed' &&
    p.currency === 'usd' &&
    p.unit_amount === entry.unitAmount;
  return sells
    ? Object.freeze({ plan: entry.plan, interval: entry.interval, kind: entry.kind })
    : null;
}

interface Listing {
  idByKey: ReadonlyMap<string, string>;
  priceById: ReadonlyMap<string, CatalogPrice>;
}

const KEYS = Object.keys(CATALOG);

const missingKeys = (l: Listing) => KEYS.filter((k) => !l.idByKey.has(k));

export function stripeCatalog(
  source: PriceSource,
  { now = Date.now }: { now?: () => number } = {},
): Catalog {
  let listing: Listing | null = null;
  let listedAt = -Infinity;
  let pending: Promise<Listing> | null = null;

  async function fetchListing(): Promise<Listing> {
    const { data } = await source.prices.list({ lookup_keys: KEYS, active: true, limit: 100 });
    const idByKey = new Map<string, string>();
    const priceById = new Map<string, CatalogPrice>();
    for (const p of data) {
      const sold = acceptedPrice(p);
      if (sold === null) continue;
      idByKey.set(p.lookup_key!, p.id);
      priceById.set(p.id, sold);
    }
    listing = { idByKey, priceById };
    listedAt = now();
    return listing;
  }

  /** One listing at a time: callers that arrive while one is in flight share it. */
  function list(): Promise<Listing> {
    pending ??= fetchListing().finally(() => {
      pending = null;
    });
    return pending;
  }

  /** The listing, listed again when it lacks what is asked and the last listing is a minute old. */
  async function current(lacks: (l: Listing) => boolean): Promise<Listing> {
    const held = listing ?? (await list());
    return lacks(held) && now() - listedAt >= REFRESH_INTERVAL_MS ? list() : held;
  }

  return {
    async priceFor(plan: PaidTier, interval: Interval, kind: PriceKind) {
      const key = lookupKey(plan, interval, kind);
      let l: Listing;
      try {
        l = await current((held) => missingKeys(held).length > 0);
      } catch (err) {
        throw new CatalogError('the Stripe prices could not be listed', { cause: err });
      }
      const missing = missingKeys(l);
      if (missing.length > 0)
        throw new CatalogError(`unresolved lookup keys: ${missing.join(', ')}`);
      return l.idByKey.get(key)!;
    },
    async planOfPrice(priceId: string) {
      const l = await current((held) => !held.priceById.has(priceId));
      return l.priceById.get(priceId) ?? null;
    },
  };
}

let shared: Catalog | null = null;

/** The catalog of the Crawlmouse account, one per process. */
export function accountCatalog(): Catalog {
  shared ??= stripeCatalog(stripeAccount());
  return shared;
}
