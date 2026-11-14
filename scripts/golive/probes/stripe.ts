/**
 * D3(e): the v2 Stripe account's live prices. Lists the eight `CATALOG` lookup keys with a restricted
 * live read key (`STRIPE_LIVE_READ_KEY`), without `active=true`, so an inactive price is named as
 * inactive rather than as missing. Each key must have a live-mode price that is active and sells what
 * `CATALOG` says.
 *
 * Only `CATALOG` is imported (catalog.ts has no runtime import past prices.ts). `acceptedPrice` lives
 * in stripe-catalog.ts, which pulls in `server-only` through stripe-account.ts and would not load
 * under tsx (plan review B6), so its test is copied below as `sellsAsCatalog`, and stripe.test.ts
 * holds the two in agreement.
 *
 * A key that is not `rk_live_…` is refused before any request: a test key would pass against a test
 * catalog, and a full secret key (`sk_…`) does not belong in scripts/.env.local.
 */
import { CATALOG } from '../../../apps/web/lib/billing/catalog';
import { fail, httpFailed, noToken, pass, type Probe } from './types';

/** The fields of a Stripe price this probe reads. */
export interface PriceLike {
  lookup_key: string | null;
  active: boolean;
  livemode: boolean;
  type: string;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number; usage_type: string } | null;
}

/** `acceptedPrice`'s test, without `active`: the price sells what CATALOG names for its key. */
export function sellsAsCatalog(p: PriceLike): boolean {
  const key = p.lookup_key;
  if (key === null || !Object.hasOwn(CATALOG, key)) return false;
  const entry = CATALOG[key]!;
  const r = p.recurring;
  return (
    p.type === 'recurring' &&
    r !== null &&
    r.interval === entry.interval &&
    r.interval_count === 1 &&
    r.usage_type === 'licensed' &&
    p.currency === 'usd' &&
    p.unit_amount === entry.unitAmount
  );
}

/** Whether checkout would take the price: `acceptedPrice(p) !== null`, copied. */
export const accepted = (p: PriceLike): boolean => p.active && sellsAsCatalog(p);

export type KeyVerdict = 'ok' | 'missing' | 'test mode' | 'inactive' | 'wrong terms';

/** What the listing says about one lookup key. */
export function verdictFor(key: string, prices: readonly PriceLike[]): KeyVerdict {
  const mine = prices.filter((p) => p.lookup_key === key);
  if (mine.length === 0) return 'missing';
  const live = mine.filter((p) => p.livemode === true);
  if (live.length === 0) return 'test mode';
  if (live.some(accepted)) return 'ok';
  if (live.some(sellsAsCatalog)) return 'inactive';
  return 'wrong terms';
}

/** Why the key cannot be used, or null. */
export function keyRefusal(key: string): string | null {
  if (key.startsWith('rk_live_')) return null;
  if (key.startsWith('sk_'))
    return 'STRIPE_LIVE_READ_KEY is a full secret key; use a restricted read key (rk_live_)';
  if (key.startsWith('rk_test_'))
    return 'STRIPE_LIVE_READ_KEY is a test key; use a live restricted read key';
  return 'STRIPE_LIVE_READ_KEY is not a restricted live key (rk_live_)';
}

const KEYS = Object.keys(CATALOG);

export const stripeProbe: Probe = async (deps) => {
  const key = deps.env.STRIPE_LIVE_READ_KEY;
  if (!key) return noToken('STRIPE_LIVE_READ_KEY');
  const refused = keyRefusal(key);
  if (refused) return fail(refused);
  const query = [...KEYS.map((k) => `lookup_keys[]=${encodeURIComponent(k)}`), 'limit=100'].join(
    '&',
  );
  const res = await deps.fetch(`https://api.stripe.com/v1/prices?${query}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) return httpFailed('Stripe prices', res.status);
  const body = (await res.json()) as { data?: PriceLike[] };
  const prices = Array.isArray(body.data) ? body.data : [];
  const bad = KEYS.map((k) => [k, verdictFor(k, prices)] as const).filter(([, v]) => v !== 'ok');
  if (bad.length === 0)
    return pass(`all ${KEYS.length} lookup keys have an active live price at the catalog's terms`);
  const by = (v: KeyVerdict) => bad.filter(([, x]) => x === v).map(([k]) => k);
  const parts = (['missing', 'test mode', 'inactive', 'wrong terms'] as const)
    .filter((v) => by(v).length > 0)
    .map((v) => `${v}: ${by(v).join(', ')}`);
  return fail(parts.join('; '));
};
