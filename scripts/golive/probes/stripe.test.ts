import { describe, expect, it, vi } from 'vitest';
import { CATALOG } from '../../../apps/web/lib/billing/catalog';
import { deps, fakeToken, json, scriptedFetch } from '../test-support';
import {
  accepted,
  keyRefusal,
  sellsAsCatalog,
  stripeProbe,
  verdictFor,
  type PriceLike,
} from './stripe';

// stripe-account.ts imports 'server-only', which Next aliases and node cannot resolve; the app's own
// test mocks it the same way (apps/web/lib/billing/stripe-catalog.test.ts).
vi.mock('server-only', () => ({}));

const KEYS = Object.keys(CATALOG);

const price = (key: string, over: Partial<PriceLike> = {}): PriceLike => {
  const e = CATALOG[key]!;
  return {
    lookup_key: key,
    active: true,
    livemode: true,
    type: 'recurring',
    currency: 'usd',
    unit_amount: e.unitAmount,
    recurring: { interval: e.interval, interval_count: 1, usage_type: 'licensed' },
    ...over,
  };
};

describe('the key gate', () => {
  const live = fakeToken(['rk', 'live']);
  it.each([
    ['a full live secret', fakeToken(['sk', 'live'])],
    ['a full test secret', fakeToken(['sk', 'test'])],
    ['a restricted test key', fakeToken(['rk', 'test'])],
    ['a publishable key', fakeToken(['pk', 'live'])],
    ['something else', 'not-a-key'],
  ])('refuses %s with fail, and sends nothing', async (_label, key) => {
    expect(keyRefusal(key)).not.toBeNull();
    const { fetch, calls } = scriptedFetch(() => json({ data: [] }));
    const r = await stripeProbe(deps({ fetch, env: { STRIPE_LIVE_READ_KEY: key } }));
    expect(r.status).toBe('fail');
    expect(r.reason).not.toContain(key);
    expect(calls).toEqual([]);
  });
  it('accepts a restricted live key', () => {
    expect(keyRefusal(live)).toBeNull();
  });
  it('answers unknown without a key', async () => {
    expect(await stripeProbe(deps())).toEqual({
      status: 'unknown',
      reason: 'set STRIPE_LIVE_READ_KEY in scripts/.env.local',
    });
  });
});

describe('the listing', () => {
  const key = fakeToken(['rk', 'live']);
  const listing = (data: PriceLike[]) => scriptedFetch(() => json({ object: 'list', data }));

  it('asks for all eight keys and does not filter on active', async () => {
    const { fetch, calls } = listing(KEYS.map((k) => price(k)));
    const r = await stripeProbe(deps({ fetch, env: { STRIPE_LIVE_READ_KEY: key } }));
    expect(r.status).toBe('pass');
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.stripe.com/v1/prices');
    expect(url.searchParams.getAll('lookup_keys[]').sort()).toEqual([...KEYS].sort());
    expect(url.searchParams.has('active')).toBe(false);
    expect(calls[0]!.method).toBe('GET');
  });

  it('names missing, test-mode, inactive and wrong-terms keys separately', async () => {
    const [a, b, c, d, ...rest] = KEYS as [string, string, string, string, ...string[]];
    const { fetch } = listing([
      price(b, { livemode: false }),
      price(c, { active: false }),
      price(d, { unit_amount: 1 }),
      ...rest.map((k) => price(k)),
    ]);
    const r = await stripeProbe(deps({ fetch, env: { STRIPE_LIVE_READ_KEY: key } }));
    expect(r).toEqual({
      status: 'fail',
      reason: `missing: ${a}; test mode: ${b}; inactive: ${c}; wrong terms: ${d}`,
    });
  });

  it('passes a key when one of its live prices is accepted beside a stale one', () => {
    const k = KEYS[0]!;
    expect(verdictFor(k, [price(k, { active: false, unit_amount: 5 }), price(k)])).toBe('ok');
  });
});

describe("the copied predicate agrees with the app's acceptedPrice", () => {
  const variants = (k: string): PriceLike[] => [
    price(k),
    price(k, { active: false }),
    price(k, { type: 'one_time', recurring: null }),
    price(k, { currency: 'eur' }),
    price(k, { unit_amount: CATALOG[k]!.unitAmount + 100 }),
    price(k, { unit_amount: null }),
    price(k, {
      recurring: {
        interval: CATALOG[k]!.interval === 'month' ? 'year' : 'month',
        interval_count: 1,
        usage_type: 'licensed',
      },
    }),
    price(k, {
      recurring: { interval: CATALOG[k]!.interval, interval_count: 3, usage_type: 'licensed' },
    }),
    price(k, {
      recurring: { interval: CATALOG[k]!.interval, interval_count: 1, usage_type: 'metered' },
    }),
    price(k, { lookup_key: null }),
    price(k, { lookup_key: `${k}_v2` }),
    price(k, { lookup_key: '__proto__' }),
  ];

  it('on every catalog key and each way a price can differ', async () => {
    const { acceptedPrice } = await import('../../../apps/web/lib/billing/stripe-catalog');
    let compared = 0;
    for (const k of KEYS) {
      for (const p of variants(k)) {
        expect(accepted(p), JSON.stringify(p)).toBe(acceptedPrice(p as never) !== null);
        compared += 1;
      }
    }
    expect(compared).toBe(KEYS.length * 12);
  });

  it('on a vector written out by hand: Pro monthly at $19, recurring monthly, licensed, in dollars', () => {
    const pro: PriceLike = {
      lookup_key: 'crawlmouse_pro_monthly',
      active: true,
      livemode: true,
      type: 'recurring',
      currency: 'usd',
      unit_amount: 1900,
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    };
    expect(accepted(pro)).toBe(true);
    expect(accepted({ ...pro, unit_amount: 1800 })).toBe(false);
    expect(sellsAsCatalog({ ...pro, active: false })).toBe(true);
  });
});
