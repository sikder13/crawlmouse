import { describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../../billing/catalog';
import { fakeCatalog, fakePriceId } from '../../billing/catalog.fake';
import { CatalogError } from '../../billing/stripe-catalog';
import { stripeSubscription, type FakeSubscription } from '../../billing/stripe.fake';
import { mirrorOf } from '../../billing/subscription-mirror';
import { GATES } from '../../entitlement-v2';
import {
  changeExtras,
  extrasResponse,
  LOWER,
  MAX_EXTRA_SEATS,
  parseExtras,
  RAISE,
  type ExtrasAccount,
  type ExtrasDeps,
} from './extras';
import { fakeExtrasStripe } from './extras.fake';

// `changeExtras` against a Stripe subscription in memory (extras.fake.ts) and CC-03's fake catalog,
// whose price ids are `price_<lookup key>`. Each subscription the fake answers is read back through
// `mirrorOf`, the webhook's own reading, so a change that the webhook would not take as the asked
// extras fails here.

// stripe-catalog.ts, which defines CatalogError, reaches the Stripe client's module.
vi.mock('server-only', () => ({}));

const ACCOUNT = '6f1c2a8e-0000-4000-8000-00000000000a';
const NOW = new Date('2026-11-12T12:00:00.000Z');

const agency: FakeSubscription = {
  id: 'sub_extras1',
  customer: 'cus_extras1',
  status: 'active',
  plan: 'agency',
  interval: 'month',
  seats: 0,
  sites: 0,
  trialEnd: null,
  periodEnd: 1_900_000_000,
  cancelAtPeriodEnd: false,
};

const catalog = fakeCatalog();

function world(sub: Partial<FakeSubscription> = {}, account: Partial<ExtrasAccount> = {}) {
  const stripe = fakeExtrasStripe(stripeSubscription({ ...agency, ...sub }));
  const held: ExtrasAccount = {
    subscription: { id: agency.id, lastEventId: 'evt_1' },
    seatsInUse: 1,
    sitesInUse: 0,
    ...account,
  };
  const deps: ExtrasDeps = {
    accounts: { read: async () => held },
    stripe,
    catalog,
    now: () => NOW,
  };
  const change = (seats: number, sites: number) =>
    changeExtras(deps, { accountId: ACCOUNT, want: { seats, sites } });
  const extras = async () => {
    const m = await mirrorOf(stripe.current(), catalog);
    return 'refused' in m ? m.refused : m.extras;
  };
  return { stripe, deps, held, change, extras };
}

describe('the two proration rules (owner ruling, Q4)', () => {
  it('a raise is invoiced at once and refused when unpaid; a lowering is not credited', () => {
    expect(RAISE).toEqual({
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
    });
    expect(LOWER).toEqual({ proration_behavior: 'none' });
  });
});

describe('parseExtras', () => {
  const json = (fields: Record<string, unknown>) => parseExtras({ kind: 'json', fields });
  const form = (fields: Record<string, unknown>) => parseExtras({ kind: 'form', fields });

  it('reads the two quantities, as numbers or as a form’s digits, and an account id', () => {
    expect(json({ seats: 2, sites: 0 })).toEqual({ seats: 2, sites: 0 });
    expect(form({ seats: '3', sites: '25' })).toEqual({ seats: 3, sites: 25 });
    expect(json({ seats: 0, sites: 0, accountId: ACCOUNT })).toEqual({
      seats: 0,
      sites: 0,
      accountId: ACCOUNT,
    });
  });

  it('has no field for a limit or a price, and refuses what is not a whole number ≥ 0', () => {
    const refused = [
      { seats: 1, sites: 0, seatLimit: 50 },
      { seats: 1, sites: 0, seat_limit: 50 },
      { seats: 1, sites: 0, siteLimit: 50 },
      { seats: 1, sites: 0, price: 'price_x' },
      { seats: 1, sites: 0, priceId: 'price_x' },
      { seats: -1, sites: 0 },
      { seats: 1.5, sites: 0 },
      { seats: '1e2', sites: 0 },
      { seats: '', sites: 0 },
      { seats: 1 },
      { sites: 1 },
      {},
    ];
    expect(refused.map((f) => json(f))).toEqual(refused.map(() => null));
  });
});

describe('changeExtras: a raise', () => {
  it('adds the seat item at the catalog’s price for the base item’s interval, with RAISE', async () => {
    const w = world();
    expect(await w.change(2, 0)).toEqual({
      ok: true,
      extras: { seats: 2, sites: 0 },
      changed: true,
    });
    expect(w.stripe.updates).toHaveLength(1);
    expect(w.stripe.updates[0]!.id).toBe(agency.id);
    expect(w.stripe.updates[0]!.params).toEqual({
      items: [{ price: fakePriceId('crawlmouse_seat_monthly'), quantity: 2 }],
      ...RAISE,
    });
    expect(await w.extras()).toEqual({ seats: 2, sites: 0 });
  });

  it('on a yearly plan, adds the yearly prices', async () => {
    const w = world({ interval: 'year' });
    await w.change(1, 3);
    expect(w.stripe.updates[0]!.params.items).toEqual([
      { price: fakePriceId('crawlmouse_seat_yearly'), quantity: 1 },
      { price: fakePriceId('crawlmouse_site_yearly'), quantity: 3 },
    ]);
    expect(await w.extras()).toEqual({ seats: 1, sites: 3 });
  });

  it('changes an item the subscription holds by its id, and leaves one that stays out of the update', async () => {
    const w = world({ seats: 2, sites: 5 });
    await w.change(4, 5);
    expect(w.stripe.updates[0]!.params).toEqual({
      items: [{ id: `si_${agency.id}_seat`, quantity: 4 }],
      ...RAISE,
    });
    expect(await w.extras()).toEqual({ seats: 4, sites: 5 });
  });

  it('with one quantity rising and one falling, is refused before any update, either way round', async () => {
    const w = world({ seats: 2, sites: 5 });
    expect(await w.change(3, 0)).toEqual({ ok: false, status: 400, code: 'mixed_change' });
    expect(await w.change(1, 6)).toEqual({ ok: false, status: 400, code: 'mixed_change' });
    expect(w.stripe.updates).toEqual([]);
    expect(await w.extras()).toEqual({ seats: 2, sites: 5 });
  });

  it('a declined card is 402, and the subscription is as it was', async () => {
    const stripe = fakeExtrasStripe(stripeSubscription(agency), { declines: true });
    const w = world();
    const res = await changeExtras(
      { ...w.deps, stripe },
      { accountId: ACCOUNT, want: { seats: 1, sites: 0 } },
    );
    expect(res).toEqual({ ok: false, status: 402, code: 'payment_failed' });
    expect(stripe.updates[0]!.params.payment_behavior).toBe('error_if_incomplete');
    expect(await mirrorOf(stripe.current(), catalog)).toMatchObject({
      extras: { seats: 0, sites: 0 },
    });
  });

  it('a trialing subscription is changed too', async () => {
    const w = world({ status: 'trialing', trialEnd: 1_800_000_000 });
    expect((await w.change(1, 0)).ok).toBe(true);
    expect(await w.extras()).toEqual({ seats: 1, sites: 0 });
  });
});

describe('changeExtras: a lowering', () => {
  it('sets the lower quantity with LOWER, and no payment behaviour', async () => {
    const w = world({ seats: 4, sites: 5 }, { seatsInUse: 6 });
    expect(await w.change(1, 5)).toEqual({
      ok: true,
      extras: { seats: 1, sites: 5 },
      changed: true,
    });
    expect(w.stripe.updates[0]!.params).toEqual({
      items: [{ id: `si_${agency.id}_seat`, quantity: 1 }],
      ...LOWER,
    });
    expect(w.stripe.updates[0]!.params).not.toHaveProperty('payment_behavior');
  });

  it('to none deletes the item, since the mirror takes no item of quantity 0 as none', async () => {
    const w = world({ seats: 2, sites: 5 });
    await w.change(0, 0);
    expect(w.stripe.updates[0]!.params).toEqual({
      items: [
        { id: `si_${agency.id}_seat`, deleted: true },
        { id: `si_${agency.id}_site`, deleted: true },
      ],
      ...LOWER,
    });
    expect(await w.extras()).toEqual({ seats: 0, sites: 0 });
    expect(w.stripe.current().items.data).toHaveLength(1);
  });
});

describe('changeExtras: refused before any Stripe call', () => {
  const untouched = (w: ReturnType<typeof world>) =>
    expect([w.stripe.retrieved, w.stripe.updates]).toEqual([[], []]);

  it('quantities the plan does not sell, and more seats than one request may ask for', async () => {
    const w = world();
    const extraSites = GATES.agency.maxSites - GATES.agency.sites;
    for (const [seats, sites] of [
      [0, extraSites + 1],
      [MAX_EXTRA_SEATS + 1, 0],
      [-1, 0],
      [1.5, 0],
    ] as const) {
      expect(await w.change(seats, sites), `${seats}, ${sites}`).toEqual({
        ok: false,
        status: 400,
        code: 'invalid',
      });
    }
    untouched(w);
    expect((await w.change(MAX_EXTRA_SEATS, extraSites)).ok).toBe(true);
  });

  it('a seat limit below the seats in use, and a site limit below the sites in use', async () => {
    const seats = world({ seats: 3 }, { seatsInUse: GATES.agency.seats + 2 });
    expect(await seats.change(1, 0)).toEqual({
      ok: false,
      status: 409,
      code: 'in_use',
      detail: { what: 'seats', inUse: GATES.agency.seats + 2 },
    });
    untouched(seats);
    expect((await seats.change(2, 0)).ok).toBe(true);

    const sites = world({ sites: 10 }, { sitesInUse: GATES.agency.sites + 4 });
    expect(await sites.change(0, 3)).toEqual({
      ok: false,
      status: 409,
      code: 'in_use',
      detail: { what: 'sites', inUse: GATES.agency.sites + 4 },
    });
    untouched(sites);
    expect((await sites.change(0, 4)).ok).toBe(true);
  });

  it('an account with no subscription, and no such account', async () => {
    const none = world({}, { subscription: null });
    expect(await none.change(1, 0)).toEqual({ ok: false, status: 409, code: 'no_subscription' });
    untouched(none);
    const w = world();
    const missing = await changeExtras(
      { ...w.deps, accounts: { read: async () => null } },
      { accountId: ACCOUNT, want: { seats: 1, sites: 0 } },
    );
    expect(missing).toEqual({ ok: false, status: 404, code: 'not_found' });
    untouched(w);
  });
});

describe('changeExtras: refused once the subscription is read, with no update', () => {
  it.each([
    [{ cancelAtPeriodEnd: true }, 'subscription_ending'],
    [{ status: 'past_due' as const }, 'subscription_not_active'],
    [{ status: 'unpaid' as const }, 'subscription_not_active'],
    [{ status: 'canceled' as const }, 'subscription_not_active'],
    [{ plan: 'pro' as const }, 'not_agency_subscription'],
    [{ priceIds: ['price_someone_elses'] }, 'not_agency_subscription'],
  ])('%j → %s', async (sub, code) => {
    const w = world(sub);
    expect(await w.change(1, 0)).toEqual({ ok: false, status: 409, code });
    expect(w.stripe.retrieved).toEqual([agency.id]);
    expect(w.stripe.updates).toEqual([]);
  });

  it('the quantities it already holds: answered as unchanged', async () => {
    const w = world({ seats: 2, sites: 5 });
    expect(await w.change(2, 5)).toEqual({
      ok: true,
      extras: { seats: 2, sites: 5 },
      changed: false,
    });
    expect(w.stripe.updates).toEqual([]);
  });

  it('a catalog that cannot be resolved is 503', async () => {
    const w = world();
    const broken: Catalog = {
      planOfPrice: (id) => catalog.planOfPrice(id),
      priceFor: async () => {
        throw new CatalogError('unresolved lookup keys');
      },
    };
    const res = await changeExtras(
      { ...w.deps, catalog: broken },
      { accountId: ACCOUNT, want: { seats: 1, sites: 0 } },
    );
    expect(res).toEqual({ ok: false, status: 503, code: 'billing_unavailable' });
    expect(w.stripe.updates).toEqual([]);
  });
});

describe('changeExtras: the idempotency key', () => {
  it('is the same for a retry of one request, so Stripe applies it once', async () => {
    const first = world();
    await first.change(2, 0);
    // The retry finds the subscription as the first attempt found it.
    const retry = world();
    await retry.change(2, 0);
    expect(retry.stripe.updates[0]!.idempotencyKey).toBe(first.stripe.updates[0]!.idempotencyKey);
  });

  it('differs when the same quantities are bought, lowered and bought again, so the third is applied', async () => {
    const w = world();
    await w.change(2, 0);
    await w.change(0, 0);
    expect(await w.change(2, 0)).toEqual({
      ok: true,
      extras: { seats: 2, sites: 0 },
      changed: true,
    });
    const keys = w.stripe.updates.map((u) => u.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    expect(await w.extras()).toEqual({ seats: 2, sites: 0 });
  });

  it('differs once the mirror has applied another event, where no invoice tells two changes apart', async () => {
    const before = world({ status: 'trialing' });
    const after = world(
      { status: 'trialing' },
      { subscription: { id: agency.id, lastEventId: 'evt_2' } },
    );
    await before.change(0, 2);
    await after.change(0, 2);
    expect(after.stripe.updates[0]!.idempotencyKey).not.toBe(
      before.stripe.updates[0]!.idempotencyKey,
    );
  });

  it('names the subscription and neither the account nor a person', async () => {
    const w = world();
    await w.change(1, 1);
    const key = w.stripe.updates[0]!.idempotencyKey;
    expect(key).toContain(agency.id);
    expect(key).not.toContain(ACCOUNT);
  });
});

describe('extrasResponse', () => {
  const location = (r: Response) => [r.status, r.headers.get('location')];

  it('JSON: the quantities, or the refusal with its detail', async () => {
    const ok = extrasResponse('json', { ok: true, extras: { seats: 2, sites: 1 }, changed: true });
    expect([ok.status, await ok.json()]).toEqual([200, { seats: 2, sites: 1, changed: true }]);
    const refused = extrasResponse('json', {
      ok: false,
      status: 409,
      code: 'in_use',
      detail: { what: 'seats', inUse: 7 },
    });
    expect([refused.status, await refused.json()]).toEqual([
      409,
      { code: 'in_use', what: 'seats', inUse: 7 },
    ]);
  });

  it('a form: back to Seats with a notice', () => {
    expect(
      location(extrasResponse('form', { ok: true, extras: { seats: 2, sites: 1 }, changed: true })),
    ).toEqual([303, '/seats?notice=extras_changed']);
    expect(
      location(
        extrasResponse('form', { ok: true, extras: { seats: 2, sites: 1 }, changed: false }),
      ),
    ).toEqual([303, '/seats?notice=extras_unchanged']);
    expect(
      location(extrasResponse('form', { ok: false, status: 402, code: 'payment_failed' })),
    ).toEqual([303, '/seats?notice=payment_failed']);
    expect(
      location(extrasResponse('form', { ok: false, status: 409, code: 'subscription_ending' })),
    ).toEqual([303, '/seats?notice=subscription_unchangeable']);
    // No page to go back to for an account that is not there.
    expect(extrasResponse('form', { ok: false, status: 404, code: 'not_found' }).status).toBe(404);
  });
});
