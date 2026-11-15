import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { agencyTrial } from './agency-trial';
import type { BillingAccount, CheckoutDeps } from './checkout-v2';
import { FREE_START, type EntitlementSnapshot } from './state-machine';

const ACCOUNT = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';
const USER = '0e6b8f2a-3c1d-4f5e-9a7b-2c8d1e0f3a4b';
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
const customersCreate = vi.fn();
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
        create: async (params, options) => {
          log.push('customers.create');
          customersCreate(params, options);
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
  customersCreate.mockReset();
  sessionsExpire.mockReset();
  priceFor
    .mockReset()
    .mockImplementation(async (plan: string, interval: string, kind: string) =>
      plan === 'agency' && kind === 'base' ? `price_agency_${interval}` : 'price_wrong',
    );
});

const start = (interval: 'month' | 'year' = 'month') =>
  agencyTrial(deps(), { accountId: ACCOUNT, userId: USER, email: 'owner@example.com', interval });

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
      agencyTrial(d, { accountId: ACCOUNT, userId: USER, email: null, interval: 'month' }),
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
          metadata: { account_id: ACCOUNT, posthog_person_distinct_id: USER },
          line_items: [{ price: 'price_agency_year', quantity: 1 }],
          payment_method_types: ['card'],
          payment_method_collection: 'always',
          automatic_tax: { enabled: true },
          customer_update: { address: 'auto', name: 'auto' },
          expires_at: Date.UTC(2026, 10, 8, 12, 31, 0) / 1000,
          subscription_data: {
            metadata: { account_id: ACCOUNT, posthog_person_distinct_id: USER },
            trial_period_days: 14,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
          },
          // The agency's workspace, where the new account is one press away (CC-31 Q8).
          success_url: `${ORIGIN}/agency`,
          cancel_url: `${ORIGIN}/agency-trial`,
        },
      ],
    ]);
  });

  it('creates a missing customer keyed to the account and to its owner as a PostHog person', async () => {
    account = { snapshot: FREE_START, stripeCustomerId: null };
    await start();
    expect(customersCreate.mock.calls).toEqual([
      [
        {
          email: 'owner@example.com',
          metadata: { account_id: ACCOUNT, posthog_person_distinct_id: USER },
        },
        { idempotencyKey: `customer:${ACCOUNT}` },
      ],
    ]);
    expect(sessionsCreate.mock.calls[0]![0].customer).toBe('cus_new');
  });

  it("expires the customer's open sessions first (finding 1)", async () => {
    await start();
    expect(log).toEqual(['sessions.list', 'sessions.expire cs_open', 'sessions.create']);
  });
});
