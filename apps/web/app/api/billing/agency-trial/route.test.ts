import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/billing/agency-trial (CC-03 D7, questions Q15). The session client, the service-role
// client and the Stripe client are fakes; the handler (lib/billing/agency-trial.ts) runs for real.

const h = vi.hoisted(() => {
  const log: string[] = [];
  const state = {
    user: { id: 'u1', email: 'owner@example.com' } as unknown,
    role: 'owner' as unknown,
    snapshot: null as unknown,
  };
  const session = {
    auth: {
      getUser: async () => {
        log.push('getUser');
        return { data: { user: state.user }, error: null };
      },
    },
    from: (table: string) => {
      log.push(`session.from ${table}`);
      throw new Error('an agency trial names its account; the seats are not read');
    },
    rpc: async (fn: string, args: unknown) => {
      log.push(`rpc ${fn} ${JSON.stringify(args)}`);
      return { data: state.role, error: null };
    },
  };
  return { log, state, session, sessionsCreate: vi.fn(), capture: vi.fn() };
});

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: h.capture }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => h.session }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return { tag: 'admin' };
  },
}));
vi.mock('@/lib/billing/stripe-account', () => ({
  stripeAccount: () => ({
    customers: { create: async () => ({ id: 'cus_new' }) },
    checkout: {
      sessions: {
        list: () => (async function* () {})(),
        expire: async () => ({}),
        create: async (params: unknown) => {
          h.log.push('stripe.checkout.sessions.create');
          h.sessionsCreate(params);
          return { url: 'https://checkout.stripe.com/c/pay/cs_trial' };
        },
      },
    },
  }),
}));
vi.mock('@/lib/billing/stripe-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/stripe-catalog')>()),
  accountCatalog: () => ({
    priceFor: async (plan: string, interval: string) => `price_${plan}_${interval}`,
    planOfPrice: async () => null,
  }),
}));
vi.mock('@/lib/billing/checkout-v2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/checkout-v2')>()),
  supabaseCheckoutAccounts: (admin: { tag: string }) => {
    h.log.push(`accounts over ${admin.tag}`);
    return {
      read: async () => ({ snapshot: h.state.snapshot, stripeCustomerId: 'cus_1' }),
      bindCustomer: async () => true,
    };
  },
}));

import { FREE_START } from '@/lib/billing/state-machine';
import { POST } from './route';

const SITE = 'https://crawlmouse.com';
const AGENCY = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';

const post = (body: string, type = 'application/x-www-form-urlencoded') =>
  POST(
    new Request(`${SITE}/api/billing/agency-trial`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': type },
      body,
    }),
  );

const stripeCalls = () => h.log.filter((l) => l.startsWith('stripe.'));

beforeEach(() => {
  process.env.V2_BILLING = '1';
  process.env.NEXT_PUBLIC_BASE_URL = SITE;
  h.log.length = 0;
  h.state.user = { id: 'u1', email: 'owner@example.com' };
  h.state.role = 'owner';
  h.state.snapshot = FREE_START;
  h.sessionsCreate.mockReset();
});

describe('POST /api/billing/agency-trial', () => {
  it('401 auth_required without a session, flag set or not', async () => {
    h.state.user = null;
    for (const flag of ['1', undefined]) {
      if (flag === undefined) delete process.env.V2_BILLING;
      h.log.length = 0;
      const res = await post(`interval=month&accountId=${AGENCY}`);
      expect([res.status, await res.json()]).toEqual([401, { error: 'auth_required' }]);
      expect(h.log).toEqual(['getUser']);
    }
  });

  it('404 not_found with V2_BILLING unset, after the session and before anything else', async () => {
    delete process.env.V2_BILLING;
    const res = await post(`interval=month&accountId=${AGENCY}`);
    expect([res.status, await res.json()]).toEqual([404, { error: 'not_found' }]);
    expect(h.log).toEqual(['getUser']);
  });

  it("opens the trial checkout for the named account's owner: a form gets a 303", async () => {
    const res = await post(`interval=year&accountId=${AGENCY}`);
    expect([res.status, res.headers.get('location')]).toEqual([
      303,
      'https://checkout.stripe.com/c/pay/cs_trial',
    ]);
    expect(h.log).toEqual([
      'getUser',
      `rpc member_role {"p_account":"${AGENCY}"}`,
      'supabaseAdmin',
      'accounts over admin',
      'stripe.checkout.sessions.create',
    ]);
    expect(h.sessionsCreate.mock.calls[0]![0]).toMatchObject({
      client_reference_id: AGENCY,
      line_items: [{ price: 'price_agency_year', quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      cancel_url: `${SITE}/agency-trial`,
    });
  });

  it('answers JSON with {url}', async () => {
    const res = await post(
      JSON.stringify({ interval: 'month', accountId: AGENCY }),
      'application/json',
    );
    expect([res.status, await res.json()]).toEqual([
      200,
      { url: 'https://checkout.stripe.com/c/pay/cs_trial' },
    ]);
  });

  it.each([
    ['no account', 'interval=month'],
    ['no interval', `accountId=${AGENCY}`],
    ['a plan', `interval=month&accountId=${AGENCY}&plan=pro`],
  ])('400 invalid for %s, before any account check', async (_, body) => {
    const res = await post(body);
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid' }]);
    expect(h.log).toEqual(['getUser']);
  });

  it.each([
    ['a manager', 'account_manager'],
    ['not a member', null],
  ])('403 not_owner for %s of the account, before any Stripe call', async (_, role) => {
    h.state.role = role;
    const res = await post(`interval=month&accountId=${AGENCY}`);
    expect([res.status, await res.json()]).toEqual([403, { error: 'not_owner' }]);
    expect(h.log).toEqual(['getUser', `rpc member_role {"p_account":"${AGENCY}"}`]);
  });

  it('409 trial_refused with the reason, before any Stripe call', async () => {
    h.state.snapshot = { ...FREE_START, trialUsedAt: new Date('2026-01-01T00:00:00Z') };
    const res = await post(`interval=month&accountId=${AGENCY}`);
    expect([res.status, await res.json()]).toEqual([
      409,
      { error: 'trial_refused', reason: 'the account has used its trial' },
    ]);
    expect(stripeCalls()).toEqual([]);
  });
});
