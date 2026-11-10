import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { agencyTrial, parseAgencyTrial } from './agency-trial';
import type { BillingAccount, CheckoutDeps } from './checkout-v2';
import { FREE_START, type EntitlementSnapshot } from './state-machine';

const ACCOUNT = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';
const ORIGIN = 'https://crawlmouse.com';
const NOW = new Date('2026-11-08T12:00:00.000Z');
const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_trial';

const snap = (over: Partial<EntitlementSnapshot>): EntitlementSnapshot => ({
  ...FREE_START,
  ...over,
});

let account: BillingAccount;
let clock: Date;
let log: string[];
const sessionsCreate = vi.fn();
const sessionsExpire = vi.fn();
const priceFor = vi.fn();

function deps(): CheckoutDeps {
  return {
    accounts: {
      read: async () => account,
      bindCustomer: async () => true,
    },
    catalog: { priceFor, planOfPrice: async () => null },
    origin: ORIGIN,
    now: () => clock,
    report: () => {},
    stripe: {
      customers: {
        create: async () => {
          log.push('customers.create');
          return { id: 'cus_new' };
        },
      },
      checkout: {
        sessions: {
          list: () => {
            log.push('sessions.list');
            return (async function* () {
              yield { id: 'cs_open' };
            })();
          },
          expire: async (id) => {
            log.push(`sessions.expire ${id}`);
            sessionsExpire(id);
            return {};
          },
          create: async (params) => {
            log.push('sessions.create');
            sessionsCreate(params);
            return { url: SESSION_URL };
          },
        },
      },
    },
  };
}

beforeEach(() => {
  account = { snapshot: FREE_START, stripeCustomerId: 'cus_stored' };
  clock = NOW;
  log = [];
  sessionsCreate.mockReset();
  sessionsExpire.mockReset();
  priceFor
    .mockReset()
    .mockImplementation(async (plan: string, interval: string, kind: string) =>
      plan === 'agency' && kind === 'base' ? `price_agency_${interval}` : 'price_wrong',
    );
});

const start = (interval: 'month' | 'year' = 'month') =>
  agencyTrial(deps(), { accountId: ACCOUNT, email: 'owner@example.com', interval });

describe('parseAgencyTrial', () => {
  it.each(['form', 'json'] as const)(
    'reads a %s body with the interval and the account',
    (kind) => {
      expect(parseAgencyTrial({ kind, fields: { interval: 'year', accountId: ACCOUNT } })).toEqual({
        interval: 'year',
        accountId: ACCOUNT,
      });
    },
  );

  it.each([
    ['no account (an Agency trial names the account it bills)', { interval: 'month' }],
    ['an account id that is not a uuid', { interval: 'month', accountId: 'nope' }],
    ['no interval', { accountId: ACCOUNT }],
    ['an interval that is not sold', { interval: 'day', accountId: ACCOUNT }],
    ['a plan', { interval: 'month', accountId: ACCOUNT, plan: 'agency' }],
    ['a price id', { interval: 'month', accountId: ACCOUNT, priceId: 'price_agency_month' }],
  ])('refuses %s', (_, fields) => {
    expect(parseAgencyTrial({ kind: 'json', fields })).toBeNull();
  });
});

describe('agencyTrial refusals: what the webhook would ignore, before any Stripe call', () => {
  it.each<[string, EntitlementSnapshot]>([
    [
      'only a Free account starts a trial',
      snap({ state: 'pro', tier: 'pro', subscriptionId: 'sub_1' }),
    ],
    ['the account has used its trial', snap({ trialUsedAt: new Date('2026-01-01T00:00:00Z') })],
    ['a disputed account gets no trial', snap({ disputedAt: new Date('2026-02-01T00:00:00Z') })],
    ['the account still has a subscription', snap({ subscriptionId: 'sub_kept' })],
    [
      'older than the last entitlement change',
      snap({ lastChangeAt: new Date(NOW.getTime() + 2000) }),
    ],
  ])('409 trial_refused: %s', async (reason, snapshot) => {
    account = { snapshot, stripeCustomerId: 'cus_stored' };
    expect(await start()).toEqual({
      ok: false,
      status: 409,
      error: 'trial_refused',
      detail: { reason },
    });
    expect(log).toEqual([]);
    expect(priceFor).not.toHaveBeenCalled();
  });

  it("decides on the handler's clock", async () => {
    account = {
      snapshot: snap({ lastChangeAt: new Date(NOW.getTime() + 2000) }),
      stripeCustomerId: null,
    };
    clock = new Date(NOW.getTime() + 3000);
    expect(await start()).toEqual({ ok: true, url: SESSION_URL });
  });

  it('throws for an account that cannot be read', async () => {
    const d = deps();
    d.accounts.read = async () => null;
    await expect(
      agencyTrial(d, { accountId: ACCOUNT, email: null, interval: 'month' }),
    ).rejects.toThrow(`account ${ACCOUNT} not found`);
  });
});

describe("agencyTrial's session", () => {
  it('is a 14-day Agency trial with a card taken now, ending into the plan unless cancelled', async () => {
    expect(await start('year')).toEqual({ ok: true, url: SESSION_URL });
    expect(priceFor.mock.calls).toEqual([['agency', 'year', 'base']]);
    expect(sessionsCreate.mock.calls).toEqual([
      [
        {
          mode: 'subscription',
          customer: 'cus_stored',
          client_reference_id: ACCOUNT,
          metadata: { account_id: ACCOUNT },
          line_items: [{ price: 'price_agency_year', quantity: 1 }],
          payment_method_types: ['card'],
          payment_method_collection: 'always',
          automatic_tax: { enabled: true },
          customer_update: { address: 'auto', name: 'auto' },
          expires_at: Date.UTC(2026, 10, 8, 12, 31, 0) / 1000,
          subscription_data: {
            metadata: { account_id: ACCOUNT },
            trial_period_days: 14,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
          },
          success_url: `${ORIGIN}/settings/plan?checkout=done`,
          cancel_url: `${ORIGIN}/agency-trial`,
        },
      ],
    ]);
  });

  it("expires the customer's open sessions first (finding 1)", async () => {
    await start();
    expect(log).toEqual(['sessions.list', 'sessions.expire cs_open', 'sessions.create']);
  });
});
