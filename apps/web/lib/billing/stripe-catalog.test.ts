import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('./stripe-account', () => ({ stripeAccount: () => ({ prices: { list: h.list } }) }));

import { CatalogError, REFRESH_INTERVAL_MS, accountCatalog, stripeCatalog } from './stripe-catalog';

/**
 * The sandbox's eight prices as GET /v1/prices answered them on 2026-11-08, written out here rather
 * than derived from CATALOG, so a change to either side shows as a failure.
 */
const SANDBOX: readonly [key: string, id: string, interval: 'month' | 'year', cents: number][] = [
  ['crawlmouse_pro_monthly', 'price_pro_m', 'month', 1900],
  ['crawlmouse_pro_yearly', 'price_pro_y', 'year', 19000],
  ['crawlmouse_agency_monthly', 'price_agency_m', 'month', 9900],
  ['crawlmouse_agency_yearly', 'price_agency_y', 'year', 99000],
  ['crawlmouse_seat_monthly', 'price_seat_m', 'month', 1200],
  ['crawlmouse_seat_yearly', 'price_seat_y', 'year', 12000],
  ['crawlmouse_site_monthly', 'price_site_m', 'month', 300],
  ['crawlmouse_site_yearly', 'price_site_y', 'year', 3000],
];

type PriceOverrides = Partial<Omit<Stripe.Price, 'recurring'>> & {
  recurring?: Partial<Stripe.Price.Recurring> | null;
};

function price(key: string, overrides: PriceOverrides = {}): Stripe.Price {
  const [, id, interval, cents] = SANDBOX.find(([k]) => k === key)!;
  const { recurring, ...rest } = overrides;
  return {
    id,
    object: 'price',
    active: true,
    currency: 'usd',
    lookup_key: key,
    type: 'recurring',
    unit_amount: cents,
    ...rest,
    recurring:
      recurring === null
        ? null
        : { interval, interval_count: 1, usage_type: 'licensed', ...recurring },
  } as Stripe.Price;
}

const allEight = () => SANDBOX.map(([key]) => price(key));

/** A Stripe client whose price listing answers `prices` (re-read on every call). */
function source(prices: () => Stripe.Price[]) {
  const list = vi.fn(async (_params: Stripe.PriceListParams) => ({ data: prices() }));
  return { list, stripe: { prices: { list } } };
}

describe('stripeCatalog', () => {
  it('lists the eight lookup keys, active only, in one page', async () => {
    const s = source(allEight);
    await stripeCatalog(s.stripe).priceFor('pro', 'month', 'base');
    expect(s.list).toHaveBeenCalledTimes(1);
    const params = s.list.mock.calls[0]![0];
    expect({ ...params, lookup_keys: [...params.lookup_keys!].sort() }).toEqual({
      lookup_keys: SANDBOX.map(([key]) => key).sort(),
      active: true,
      limit: 100,
    });
  });

  it('gives each plan its price id, and each id its plan', async () => {
    const catalog = stripeCatalog(source(allEight).stripe);
    const expected = [
      ['pro', 'month', 'base', 'price_pro_m'],
      ['pro', 'year', 'base', 'price_pro_y'],
      ['agency', 'month', 'base', 'price_agency_m'],
      ['agency', 'year', 'base', 'price_agency_y'],
      ['agency', 'month', 'seat', 'price_seat_m'],
      ['agency', 'year', 'seat', 'price_seat_y'],
      ['agency', 'month', 'site', 'price_site_m'],
      ['agency', 'year', 'site', 'price_site_y'],
    ] as const;
    for (const [plan, interval, kind, id] of expected) {
      expect(await catalog.priceFor(plan, interval, kind)).toBe(id);
      expect(await catalog.planOfPrice(id)).toEqual({ plan, interval, kind });
    }
  });

  it('lists once for any number of reads', async () => {
    const s = source(allEight);
    const catalog = stripeCatalog(s.stripe);
    await catalog.priceFor('pro', 'month', 'base');
    await catalog.priceFor('agency', 'year', 'base');
    await catalog.planOfPrice('price_seat_m');
    expect(s.list).toHaveBeenCalledTimes(1);
  });

  it('shares one listing between reads that arrive together', async () => {
    const s = source(allEight);
    const catalog = stripeCatalog(s.stripe);
    await Promise.all([
      catalog.priceFor('pro', 'month', 'base'),
      catalog.planOfPrice('price_agency_y'),
      catalog.priceFor('agency', 'month', 'site'),
    ]);
    expect(s.list).toHaveBeenCalledTimes(1);
  });

  it.each<[string, string, PriceOverrides]>([
    ['an amount that differs from the pages', 'crawlmouse_pro_monthly', { unit_amount: 1800 }],
    ['another interval', 'crawlmouse_pro_monthly', { recurring: { interval: 'year' } }],
    ['every three months', 'crawlmouse_agency_monthly', { recurring: { interval_count: 3 } }],
    ['metered usage', 'crawlmouse_seat_monthly', { recurring: { usage_type: 'metered' } }],
    ['another currency', 'crawlmouse_site_yearly', { currency: 'eur' }],
    ['a one-time price', 'crawlmouse_pro_yearly', { type: 'one_time', recurring: null }],
    ['an archived price', 'crawlmouse_agency_yearly', { active: false }],
    ['no amount (a tiered price)', 'crawlmouse_agency_monthly', { unit_amount: null }],
  ])('refuses a price with %s', async (_, key, overrides) => {
    const [, id] = SANDBOX.find(([k]) => k === key)!;
    const prices = allEight().map((p) => (p.lookup_key === key ? price(key, overrides) : p));
    const catalog = stripeCatalog(source(() => prices).stripe);
    expect(await catalog.planOfPrice(id)).toBeNull();
    await expect(catalog.priceFor('pro', 'month', 'base')).rejects.toThrow(
      new CatalogError(`unresolved lookup keys: ${key}`),
    );
  });

  it('reads no plan from a price under a lookup key that is not one of the eight', async () => {
    const foreign = price('crawlmouse_pro_monthly', {
      id: 'price_foreign',
      lookup_key: 'crawlmouse_pro_weekly',
    });
    const catalog = stripeCatalog(source(() => [...allEight(), foreign]).stripe);
    expect(await catalog.planOfPrice('price_foreign')).toBeNull();
    expect(await catalog.priceFor('pro', 'month', 'base')).toBe('price_pro_m');
  });

  it('throws CatalogError naming every key missing from Stripe, for any plan asked', async () => {
    const prices = allEight().filter(
      (p) => p.lookup_key !== 'crawlmouse_site_yearly' && p.lookup_key !== 'crawlmouse_pro_monthly',
    );
    const catalog = stripeCatalog(source(() => prices).stripe);
    const err = await catalog.priceFor('agency', 'month', 'base').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogError);
    expect((err as Error).message).toBe(
      'unresolved lookup keys: crawlmouse_pro_monthly, crawlmouse_site_yearly',
    );
    // The prices that did resolve are still read as ours.
    expect(await catalog.planOfPrice('price_agency_m')).toEqual({
      plan: 'agency',
      interval: 'month',
      kind: 'base',
    });
  });

  it('throws CatalogError when Stripe cannot list the prices', async () => {
    const list = vi.fn().mockRejectedValue(new Error('Stripe is down'));
    const err = await stripeCatalog({ prices: { list } })
      .priceFor('pro', 'month', 'base')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogError);
    expect((err as Error).cause).toEqual(new Error('Stripe is down'));
  });

  it('lists again for priceFor once Stripe answers, after a failed listing', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('Stripe is down'))
      .mockResolvedValue({ data: allEight() });
    const catalog = stripeCatalog({ prices: { list } });
    await expect(catalog.priceFor('pro', 'month', 'base')).rejects.toBeInstanceOf(CatalogError);
    expect(await catalog.priceFor('pro', 'month', 'base')).toBe('price_pro_m');
  });

  describe('an unknown price id', () => {
    let clock: number;
    let prices: Stripe.Price[];
    const now = () => clock;
    const later = price('crawlmouse_pro_monthly', { id: 'price_pro_m_2026' });

    beforeEach(() => {
      clock = 1_000_000;
      prices = allEight();
    });

    it('lists again at most once a minute, then answers null', async () => {
      const s = source(() => prices);
      const catalog = stripeCatalog(s.stripe, { now });
      expect(await catalog.planOfPrice('price_unknown')).toBeNull();
      expect(s.list).toHaveBeenCalledTimes(1);
      clock += REFRESH_INTERVAL_MS - 1;
      expect(await catalog.planOfPrice('price_unknown')).toBeNull();
      expect(s.list).toHaveBeenCalledTimes(1);
      clock += 1;
      expect(await catalog.planOfPrice('price_unknown')).toBeNull();
      expect(s.list).toHaveBeenCalledTimes(2);
      expect(await catalog.planOfPrice('price_unknown')).toBeNull();
      expect(s.list).toHaveBeenCalledTimes(2);
    });

    it('is found by the refresh when Stripe now lists it', async () => {
      const s = source(() => prices);
      const catalog = stripeCatalog(s.stripe, { now });
      await catalog.planOfPrice('price_pro_m');
      prices = [...allEight().filter((p) => p.id !== 'price_pro_m'), later];
      clock += REFRESH_INTERVAL_MS;
      expect(await catalog.planOfPrice('price_pro_m_2026')).toEqual({
        plan: 'pro',
        interval: 'month',
        kind: 'base',
      });
      // The listing is replaced, not merged: the archived id is no longer ours.
      expect(await catalog.planOfPrice('price_pro_m')).toBeNull();
      expect(await catalog.priceFor('pro', 'month', 'base')).toBe('price_pro_m_2026');
    });

    it('throws, rather than answering null, when the refresh fails', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce({ data: allEight() })
        .mockRejectedValue(new Error('Stripe is down'));
      const catalog = stripeCatalog({ prices: { list } }, { now });
      expect(await catalog.planOfPrice('price_pro_m')).not.toBeNull();
      clock += REFRESH_INTERVAL_MS;
      await expect(catalog.planOfPrice('price_unknown')).rejects.toThrow('Stripe is down');
    });

    it('throws, rather than answering null, when the first listing fails', async () => {
      const list = vi.fn().mockRejectedValue(new Error('Stripe is down'));
      await expect(
        stripeCatalog({ prices: { list } }, { now }).planOfPrice('price_pro_m'),
      ).rejects.toThrow('Stripe is down');
    });

    it('a missing key is listed again after a minute, so a fixed price is picked up', async () => {
      prices = allEight().filter((p) => p.lookup_key !== 'crawlmouse_seat_yearly');
      const s = source(() => prices);
      const catalog = stripeCatalog(s.stripe, { now });
      await expect(catalog.priceFor('pro', 'month', 'base')).rejects.toBeInstanceOf(CatalogError);
      prices = allEight();
      await expect(catalog.priceFor('pro', 'month', 'base')).rejects.toBeInstanceOf(CatalogError);
      expect(s.list).toHaveBeenCalledTimes(1);
      clock += REFRESH_INTERVAL_MS;
      expect(await catalog.priceFor('pro', 'month', 'base')).toBe('price_pro_m');
      expect(s.list).toHaveBeenCalledTimes(2);
    });
  });
});

describe('accountCatalog', () => {
  it('is one catalog per process over the Crawlmouse account', async () => {
    h.list.mockResolvedValue({ data: allEight() });
    expect(accountCatalog()).toBe(accountCatalog());
    await accountCatalog().priceFor('pro', 'year', 'base');
    await accountCatalog().planOfPrice('price_pro_y');
    expect(h.list).toHaveBeenCalledTimes(1);
  });
});
