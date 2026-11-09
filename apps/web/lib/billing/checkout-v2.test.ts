import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { NO_EXTRAS } from '../entitlement-v2';
import type { Catalog } from './catalog';
import {
  checkoutV2,
  parseCheckout,
  supabaseCheckoutAccounts,
  type BillingAccount,
  type CheckoutAccounts,
  type CheckoutDeps,
} from './checkout-v2';
import { FREE_START, type EntitlementSnapshot } from './state-machine';
import { CatalogError } from './stripe-catalog';

const ACCOUNT = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const ORIGIN = 'https://crawlmouse.com';
const NOW = new Date('2026-11-08T12:00:00.000Z');
// Thirty-one minutes after NOW, in Unix seconds, computed here rather than by the module.
const EXPIRES_AT = Date.UTC(2026, 10, 8, 12, 31, 0) / 1000;
const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_new';

const snap = (over: Partial<EntitlementSnapshot>): EntitlementSnapshot => ({
  ...FREE_START,
  ...over,
});
const SUB = 'sub_1Followed';
const T = new Date('2026-10-01T00:00:00.000Z');
const STATES = {
  free: snap({}),
  freeAfterUnpaid: snap({ subscriptionId: SUB, lastChangeAt: T }),
  noCardTrial: snap({
    state: 'pro_trial',
    tier: 'pro',
    trialVariant: 'no_card',
    trialEndsAt: new Date('2026-11-20T00:00:00.000Z'),
    trialUsedAt: T,
  }),
  cardTrial: snap({
    state: 'pro_trial',
    tier: 'pro',
    trialVariant: 'card_required',
    trialEndsAt: new Date('2026-11-20T00:00:00.000Z'),
    trialUsedAt: T,
    subscriptionId: SUB,
  }),
  pro: snap({ state: 'pro', tier: 'pro', subscriptionId: SUB, lastChangeAt: T }),
  agencyTrial: snap({
    state: 'agency_trial',
    tier: 'agency',
    trialEndsAt: new Date('2026-11-20T00:00:00.000Z'),
    trialUsedAt: T,
    subscriptionId: SUB,
  }),
  agency: snap({ state: 'agency', tier: 'agency', subscriptionId: SUB, extras: NO_EXTRAS }),
  pastDue: snap({
    state: 'past_due',
    tier: 'pro',
    pastDueTier: 'pro',
    pastDueSince: T,
    subscriptionId: SUB,
  }),
} satisfies Record<string, EntitlementSnapshot>;

interface World {
  log: string[];
  account: BillingAccount | null;
  /** What the account holds after a bind lost to another request. */
  storedByOther: string | null;
  openSessions: string[];
  createCustomer: () => Promise<{ id: string }>;
  priceFor: Catalog['priceFor'];
}

let w: World;
const customersCreate = vi.fn();
const sessionsCreate = vi.fn();
const sessionsList = vi.fn();
const sessionsExpire = vi.fn();
const bindCustomer = vi.fn();
const report = vi.fn();

function deps(): CheckoutDeps {
  const accounts: CheckoutAccounts = {
    async read() {
      w.log.push('read');
      return w.account;
    },
    async bindCustomer(accountId, customerId) {
      w.log.push(`bind ${customerId}`);
      bindCustomer(accountId, customerId);
      if (w.account!.stripeCustomerId !== null || w.storedByOther !== null) {
        w.account = { ...w.account!, stripeCustomerId: w.storedByOther };
        return false;
      }
      w.account = { ...w.account!, stripeCustomerId: customerId };
      return true;
    },
  };
  return {
    accounts,
    origin: ORIGIN,
    now: () => NOW,
    report,
    catalog: {
      priceFor: (...a) => {
        w.log.push('priceFor');
        return w.priceFor(...a);
      },
      planOfPrice: async () => null,
    },
    stripe: {
      customers: {
        create: async (params, options) => {
          w.log.push('customers.create');
          customersCreate(params, options);
          return w.createCustomer();
        },
      },
      checkout: {
        sessions: {
          list: (params) => {
            w.log.push('sessions.list');
            sessionsList(params);
            const ids = w.openSessions;
            return (async function* () {
              for (const id of ids) yield { id };
            })();
          },
          expire: async (id) => {
            w.log.push(`sessions.expire ${id}`);
            sessionsExpire(id);
            return {};
          },
          create: async (params) => {
            w.log.push('sessions.create');
            sessionsCreate(params);
            return { url: SESSION_URL };
          },
        },
      },
    },
  };
}

const PRICES: Record<string, string> = {
  'pro month': 'price_pro_m',
  'pro year': 'price_pro_y',
  'agency month': 'price_agency_m',
  'agency year': 'price_agency_y',
};

beforeEach(() => {
  for (const f of [
    customersCreate,
    sessionsCreate,
    sessionsList,
    sessionsExpire,
    bindCustomer,
    report,
  ])
    f.mockReset();
  w = {
    log: [],
    account: { snapshot: STATES.free, stripeCustomerId: null },
    storedByOther: null,
    openSessions: [],
    createCustomer: async () => ({ id: 'cus_new' }),
    priceFor: async (plan, interval) => PRICES[`${plan} ${interval}`]!,
  };
});

const buy = (plan: 'pro' | 'agency' = 'pro', interval: 'month' | 'year' = 'month') =>
  checkoutV2(deps(), { accountId: ACCOUNT, email: 'owner@example.com', plan, interval });

const STRIPE_CALLS = ['customers.create', 'sessions.list', 'sessions.create'];
const noStripe = () => expect(w.log.filter((l) => /^(customers|sessions)\./.test(l))).toEqual([]);

describe('parseCheckout', () => {
  it.each([
    ['form', { plan: 'pro', interval: 'month' }],
    ['json', { plan: 'agency', interval: 'year' }],
    ['form', { plan: 'pro', interval: 'year', accountId: ACCOUNT }],
  ] as const)('reads a %s body %j', (kind, fields) => {
    expect(parseCheckout({ kind, fields })).toEqual(fields);
  });

  it.each([
    ['no plan', { interval: 'month' }],
    ['no interval', { plan: 'pro' }],
    ['a plan that is not sold', { plan: 'enterprise', interval: 'month' }],
    ['the Free plan', { plan: 'free', interval: 'month' }],
    ['an interval that is not sold', { plan: 'pro', interval: 'week' }],
    ['a price id', { plan: 'pro', interval: 'month', priceId: 'price_pro_m' }],
    ['an account id that is not a uuid', { plan: 'pro', interval: 'month', accountId: 'acc' }],
    ['an empty account id', { plan: 'pro', interval: 'month', accountId: '' }],
  ])('refuses %s', (_, fields) => {
    expect(parseCheckout({ kind: 'form', fields })).toBeNull();
    expect(parseCheckout({ kind: 'json', fields })).toBeNull();
  });
});

describe('checkoutV2 refusals (questions Q3), before any Stripe call', () => {
  it.each([
    ['Pro, buying Pro', STATES.pro, 'pro'],
    ['Agency, buying Agency', STATES.agency, 'agency'],
    ['Agency, buying Pro', STATES.agency, 'pro'],
  ] as const)('409 plan_held: %s', async (_, snapshot, plan) => {
    w.account = { snapshot, stripeCustomerId: 'cus_1' };
    expect(await buy(plan)).toEqual({ ok: false, status: 409, error: 'plan_held' });
    noStripe();
    expect(w.log).toEqual(['read']);
  });

  it.each([
    ['Pro, buying Agency', STATES.pro, 'agency'],
    ['past due', STATES.pastDue, 'pro'],
    ['an Agency trial', STATES.agencyTrial, 'agency'],
    ['a card Pro trial', STATES.cardTrial, 'pro'],
    ['Free, still following an unpaid subscription', STATES.freeAfterUnpaid, 'pro'],
  ] as const)('409 subscription_open, pointing to the portal: %s', async (_, snapshot, plan) => {
    w.account = { snapshot, stripeCustomerId: 'cus_1' };
    expect(await buy(plan)).toEqual({
      ok: false,
      status: 409,
      error: 'subscription_open',
      detail: { next: 'portal' },
    });
    noStripe();
    expect(w.log).toEqual(['read']);
  });

  it.each([
    ['Free', STATES.free, 'pro'],
    ['Free, buying Agency', STATES.free, 'agency'],
    ['a no-card Pro trial keeping Pro', STATES.noCardTrial, 'pro'],
    ['a no-card Pro trial choosing Agency', STATES.noCardTrial, 'agency'],
  ] as const)('opens a checkout for %s', async (_, snapshot, plan) => {
    w.account = { snapshot, stripeCustomerId: 'cus_1' };
    expect(await buy(plan)).toEqual({ ok: true, url: SESSION_URL });
  });

  it('503 billing_unavailable when the catalog cannot be resolved, reported, and nothing written', async () => {
    w.priceFor = async () => {
      throw new CatalogError('unresolved lookup keys: crawlmouse_pro_monthly');
    };
    expect(await buy()).toEqual({ ok: false, status: 503, error: 'billing_unavailable' });
    noStripe();
    expect(bindCustomer).not.toHaveBeenCalled();
    expect(report.mock.calls).toEqual([
      ['billing.catalog-unavailable', { reason: 'unresolved lookup keys: crawlmouse_pro_monthly' }],
    ]);
  });

  it('lets an error that is not the catalog through', async () => {
    w.priceFor = async () => {
      throw new Error('bug');
    };
    await expect(buy()).rejects.toThrow('bug');
  });

  it('throws for an account that cannot be read', async () => {
    w.account = null;
    await expect(buy()).rejects.toThrow(`account ${ACCOUNT} not found`);
  });
});

describe("checkoutV2's Stripe customer", () => {
  it('creates one with the idempotency key customer:<account> and stores it where none is', async () => {
    await buy();
    expect(customersCreate.mock.calls).toEqual([
      [
        { email: 'owner@example.com', metadata: { account_id: ACCOUNT } },
        { idempotencyKey: `customer:${ACCOUNT}` },
      ],
    ]);
    expect(bindCustomer.mock.calls).toEqual([[ACCOUNT, 'cus_new']]);
    expect(sessionsCreate.mock.calls[0]![0].customer).toBe('cus_new');
  });

  it('creates one without an email when the caller has none', async () => {
    await checkoutV2(deps(), { accountId: ACCOUNT, email: null, plan: 'pro', interval: 'month' });
    expect(customersCreate.mock.calls[0]![0]).toEqual({ metadata: { account_id: ACCOUNT } });
  });

  it('reuses the stored one: no customer created, nothing stored', async () => {
    w.account = { snapshot: STATES.free, stripeCustomerId: 'cus_stored' };
    await buy();
    expect(customersCreate).not.toHaveBeenCalled();
    expect(bindCustomer).not.toHaveBeenCalled();
    expect(sessionsCreate.mock.calls[0]![0].customer).toBe('cus_stored');
  });

  it('uses the customer another request stored first', async () => {
    w.storedByOther = 'cus_other';
    await buy();
    expect(bindCustomer.mock.calls).toEqual([[ACCOUNT, 'cus_new']]);
    expect(sessionsCreate.mock.calls[0]![0].customer).toBe('cus_other');
  });

  describe('when Stripe refuses the idempotency key (finding 18)', () => {
    beforeEach(() => {
      w.createCustomer = async () => {
        throw new Stripe.errors.StripeIdempotencyError({ message: 'Keys for idempotent requests' });
      };
    });

    it('re-reads the account and uses the customer it now holds', async () => {
      const deps0 = deps();
      const read = vi
        .spyOn(deps0.accounts, 'read')
        .mockResolvedValueOnce({ snapshot: STATES.free, stripeCustomerId: null })
        .mockResolvedValueOnce({ snapshot: STATES.free, stripeCustomerId: 'cus_bound' });
      const result = await checkoutV2(deps0, {
        accountId: ACCOUNT,
        email: 'owner@example.com',
        plan: 'pro',
        interval: 'month',
      });
      expect(result).toEqual({ ok: true, url: SESSION_URL });
      expect(read).toHaveBeenCalledTimes(2);
      expect(sessionsCreate.mock.calls[0]![0].customer).toBe('cus_bound');
      expect(report).not.toHaveBeenCalled();
    });

    it('503 billing_unavailable and a report when the account still has none', async () => {
      expect(await buy()).toEqual({ ok: false, status: 503, error: 'billing_unavailable' });
      expect(report.mock.calls).toEqual([['billing.customer-unavailable', { accountId: ACCOUNT }]]);
      expect(bindCustomer).not.toHaveBeenCalled();
      expect(sessionsCreate).not.toHaveBeenCalled();
    });
  });

  it('lets any other Stripe error through', async () => {
    w.createCustomer = async () => {
      throw new Stripe.errors.StripeAPIError({ message: 'Stripe is down' });
    };
    await expect(buy()).rejects.toThrow('Stripe is down');
    expect(report).not.toHaveBeenCalled();
  });
});

describe("checkoutV2's session", () => {
  it("expires the customer's open sessions before opening one (finding 1)", async () => {
    w.account = { snapshot: STATES.free, stripeCustomerId: 'cus_stored' };
    w.openSessions = ['cs_old_1', 'cs_old_2'];
    await buy();
    expect(sessionsList.mock.calls).toEqual([
      [{ customer: 'cus_stored', status: 'open', limit: 100 }],
    ]);
    expect(w.log).toEqual([
      'read',
      'priceFor',
      'sessions.list',
      'sessions.expire cs_old_1',
      'sessions.expire cs_old_2',
      'sessions.create',
    ]);
  });

  it('is a subscription checkout for the account, card only, taxed, expiring in 31 minutes', async () => {
    expect(await buy('agency', 'year')).toEqual({ ok: true, url: SESSION_URL });
    expect(w.log.filter((l) => STRIPE_CALLS.includes(l))).toEqual(STRIPE_CALLS);
    expect(sessionsCreate.mock.calls).toEqual([
      [
        {
          mode: 'subscription',
          customer: 'cus_new',
          client_reference_id: ACCOUNT,
          metadata: { account_id: ACCOUNT },
          line_items: [{ price: 'price_agency_y', quantity: 1 }],
          payment_method_types: ['card'],
          automatic_tax: { enabled: true },
          customer_update: { address: 'auto', name: 'auto' },
          expires_at: EXPIRES_AT,
          subscription_data: { metadata: { account_id: ACCOUNT } },
          success_url: `${ORIGIN}/settings/plan?checkout=done`,
          cancel_url: `${ORIGIN}/settings/plan`,
        },
      ],
    ]);
  });

  it.each([
    ['pro', 'month', 'price_pro_m'],
    ['pro', 'year', 'price_pro_y'],
    ['agency', 'month', 'price_agency_m'],
  ] as const)('charges %s each %s at %s', async (plan, interval, price) => {
    await buy(plan, interval);
    expect(sessionsCreate.mock.calls[0]![0].line_items).toEqual([{ price, quantity: 1 }]);
  });

  it('throws when Stripe answers a session with no URL', async () => {
    const d = deps();
    d.stripe.checkout.sessions.create = async () => ({ url: null });
    await expect(
      checkoutV2(d, { accountId: ACCOUNT, email: null, plan: 'pro', interval: 'month' }),
    ).rejects.toThrow('the Checkout Session has no url');
  });
});

describe('supabaseCheckoutAccounts', () => {
  /** A service-role client whose queries are recorded and answered in order. */
  function admin(answers: { data: unknown; error: unknown }[]) {
    const calls: unknown[][] = [];
    const sb = {
      from(table: string) {
        calls.push(['from', table]);
        const answer = answers.shift()!;
        const chain: Record<string, unknown> = {
          then: (resolve: (v: unknown) => unknown) => resolve(answer),
        };
        for (const m of ['select', 'update', 'eq', 'is', 'maybeSingle']) {
          chain[m] = (...args: unknown[]) => {
            calls.push([m, ...args]);
            return chain;
          };
        }
        return chain;
      },
    } as unknown as SupabaseClient;
    return { sb, calls };
  }

  const ROW = {
    state: 'pro',
    tier: 'pro',
    trial_variant: null,
    trial_ends_at: null,
    trial_used_at: null,
    past_due_tier: null,
    past_due_since: null,
    disputed_at: null,
    seat_limit: 2,
    site_limit: 5,
    competitor_limit: 1,
    entitlement_version: 3,
    current_subscription_id: SUB,
    entitlement_changed_at: '2026-10-01T00:00:00.000Z',
    state_history: [],
    stripe_customer_id: 'cus_1',
  };

  it("reads the machine's columns and the customer, and builds the snapshot", async () => {
    const { sb, calls } = admin([{ data: ROW, error: null }]);
    expect(await supabaseCheckoutAccounts(sb).read(ACCOUNT)).toEqual({
      snapshot: STATES.pro,
      stripeCustomerId: 'cus_1',
    });
    expect(calls).toEqual([
      ['from', 'accounts'],
      [
        'select',
        'state, tier, trial_variant, trial_ends_at, trial_used_at, past_due_tier, past_due_since, ' +
          'disputed_at, seat_limit, site_limit, competitor_limit, entitlement_version, ' +
          'current_subscription_id, entitlement_changed_at, state_history, stripe_customer_id',
      ],
      ['eq', 'id', ACCOUNT],
      ['maybeSingle'],
    ]);
  });

  it('answers null for no row, and throws on a failed read', async () => {
    expect(
      await supabaseCheckoutAccounts(admin([{ data: null, error: null }]).sb).read(ACCOUNT),
    ).toBeNull();
    await expect(
      supabaseCheckoutAccounts(admin([{ data: null, error: { message: 'boom' } }]).sb).read(
        ACCOUNT,
      ),
    ).rejects.toThrow('accounts read failed: boom');
  });

  it('stores the customer only where the account has none', async () => {
    const { sb, calls } = admin([{ data: [{ id: ACCOUNT }], error: null }]);
    expect(await supabaseCheckoutAccounts(sb).bindCustomer(ACCOUNT, 'cus_new')).toBe(true);
    expect(calls).toEqual([
      ['from', 'accounts'],
      ['update', { stripe_customer_id: 'cus_new' }],
      ['eq', 'id', ACCOUNT],
      ['is', 'stripe_customer_id', null],
      ['select', 'id'],
    ]);
  });

  it('answers false when another customer was stored first, and throws on a failed write', async () => {
    expect(
      await supabaseCheckoutAccounts(admin([{ data: [], error: null }]).sb).bindCustomer(
        ACCOUNT,
        'cus_new',
      ),
    ).toBe(false);
    await expect(
      supabaseCheckoutAccounts(admin([{ data: null, error: { message: 'dup' } }]).sb).bindCustomer(
        ACCOUNT,
        'cus_new',
      ),
    ).rejects.toThrow('accounts customer write failed: dup');
  });
});
