import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import type { Catalog } from './catalog';
import { fakeCatalog } from './catalog.fake';
import { stripeSubscription, type FakeSubscription } from './stripe.fake';
import { keptMirror, mirrorOf } from './subscription-mirror';

/** The allow-list reading of a subscription, against the fake catalog's `price_<lookup key>` ids. */

const base: FakeSubscription = {
  id: 'sub_m1',
  customer: 'cus_m1',
  status: 'active',
  plan: 'pro',
  interval: 'month',
  seats: 0,
  sites: 0,
  trialEnd: null,
  periodEnd: 1_900_000_000,
  cancelAtPeriodEnd: false,
};

/** A subscription with these items: [price id, quantity, current_period_end]. */
function withItems(items: [string, number, number][]): Stripe.Subscription {
  const s = stripeSubscription(base);
  return {
    ...s,
    items: {
      ...s.items,
      data: items.map(([price, quantity, end], i) => ({
        id: `si_${i}`,
        price: { id: price },
        quantity,
        current_period_end: end,
      })) as unknown as Stripe.SubscriptionItem[],
    },
  };
}

const catalog = fakeCatalog();

describe('mirrorOf', () => {
  it('a Pro monthly subscription: the row, the plan, no extras', async () => {
    expect(await mirrorOf(stripeSubscription(base), catalog)).toEqual({
      row: {
        id: 'sub_m1',
        status: 'active',
        plan: 'pro',
        interval: 'month',
        seat_quantity: 0,
        extra_site_quantity: 0,
        current_period_end: '2030-03-17T17:46:40.000Z',
        trial_end: null,
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        price_ids: ['price_crawlmouse_pro_monthly'],
      },
      plan: 'pro',
      interval: 'month',
      extras: { seats: 0, sites: 0 },
    });
  });

  it('Agency yearly with 3 seats and 7 sites: the extras are the quantities', async () => {
    const r = await mirrorOf(
      stripeSubscription({ ...base, plan: 'agency', interval: 'year', seats: 3, sites: 7 }),
      catalog,
    );
    expect(r).toMatchObject({
      plan: 'agency',
      interval: 'year',
      extras: { seats: 3, sites: 7 },
      row: { seat_quantity: 3, extra_site_quantity: 7 },
    });
  });

  it('the period end is the latest of the items’', async () => {
    const r = await mirrorOf(
      withItems([
        ['price_crawlmouse_agency_monthly', 1, 1_900_000_000],
        ['price_crawlmouse_seat_monthly', 2, 1_900_086_400],
      ]),
      catalog,
    );
    expect('row' in r && r.row.current_period_end).toBe('2030-03-18T17:46:40.000Z');
  });

  const refusals: [string, [string, number, number][]][] = [
    ['a price that is not ours', [['price_other', 1, 1]]],
    ['no items', []],
    [
      'two base prices',
      [
        ['price_crawlmouse_pro_monthly', 1, 1],
        ['price_crawlmouse_pro_yearly', 1, 1],
      ],
    ],
    ['a base quantity of 2', [['price_crawlmouse_pro_monthly', 2, 1]]],
    [
      'a seat on Pro',
      [
        ['price_crawlmouse_pro_monthly', 1, 1],
        ['price_crawlmouse_seat_monthly', 1, 1],
      ],
    ],
    [
      'a seat billed yearly on a monthly plan',
      [
        ['price_crawlmouse_agency_monthly', 1, 1],
        ['price_crawlmouse_seat_yearly', 1, 1],
      ],
    ],
    [
      'two seat items',
      [
        ['price_crawlmouse_agency_monthly', 1, 1],
        ['price_crawlmouse_seat_monthly', 1, 1],
        ['price_crawlmouse_seat_monthly', 1, 1],
      ],
    ],
    ['only a site item', [['price_crawlmouse_site_monthly', 3, 1]]],
  ];
  it.each(refusals)('refuses %s as not in the allow-list', async (_name, items) => {
    expect(await mirrorOf(withItems(items), catalog)).toEqual({
      refused: 'price not in the allow-list',
      priceIds: items.map(([p]) => p),
    });
  });

  it('refuses a list that does not hold every item', async () => {
    const s = stripeSubscription(base);
    const r = await mirrorOf({ ...s, items: { ...s.items, has_more: true } }, catalog);
    expect(r).toEqual({
      refused: 'price not in the allow-list',
      priceIds: ['price_crawlmouse_pro_monthly'],
    });
  });

  it('refuses 26 extra sites as extras the plan does not sell', async () => {
    const r = await mirrorOf(stripeSubscription({ ...base, plan: 'agency', sites: 26 }), catalog);
    expect(r).toMatchObject({ refused: 'extras the plan does not sell' });
    const ok = await mirrorOf(stripeSubscription({ ...base, plan: 'agency', sites: 25 }), catalog);
    expect(ok).toMatchObject({ extras: { seats: 0, sites: 25 } });
  });

  it('a catalog that fails propagates instead of refusing', async () => {
    const failing: Catalog = { ...catalog, planOfPrice: () => Promise.reject(new Error('down')) };
    await expect(mirrorOf(stripeSubscription(base), failing)).rejects.toThrow('down');
  });
});

describe('keptMirror', () => {
  it('takes Stripe’s fields and the stored plan', () => {
    const s = stripeSubscription({ ...base, status: 'canceled', priceIds: ['price_retired'] });
    expect(
      keptMirror(s, {
        accountId: 'a',
        plan: 'agency',
        interval: 'year',
        seatQuantity: 2,
        extraSiteQuantity: 4,
      }),
    ).toEqual({
      id: 'sub_m1',
      status: 'canceled',
      plan: 'agency',
      interval: 'year',
      seat_quantity: 2,
      extra_site_quantity: 4,
      current_period_end: '2030-03-17T17:46:40.000Z',
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: '2030-03-17T17:46:40.000Z',
      ended_at: '2030-03-17T17:46:40.000Z',
      price_ids: ['price_retired'],
    });
  });
});
