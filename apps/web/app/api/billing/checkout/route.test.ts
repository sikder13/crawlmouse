import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/billing/checkout with V2_BILLING=1 (CC-03 D6). The session client, the service-role
// client and both Stripe clients are fakes; the order of the checks, the refusals and the answers are
// the route's own, and the handler (lib/billing/checkout-v2.ts) runs for real behind them.

const h = vi.hoisted(() => {
  const ACCOUNT = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
  const log: string[] = [];
  const state = {
    user: { id: 'u1', email: 'owner@example.com' } as unknown,
    seats: [{ account_id: ACCOUNT }] as unknown[],
    role: 'owner' as unknown,
    defaultAccount: ACCOUNT as string | null,
    snapshot: null as unknown,
  };
  const seatsChain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve({ data: state.seats, error: null }),
  };
  seatsChain.select = seatsChain.eq = () => seatsChain;
  const session = {
    auth: {
      getUser: async () => {
        log.push('getUser');
        return { data: { user: state.user }, error: null };
      },
    },
    from: (table: string) => {
      log.push(`session.from ${table}`);
      return seatsChain;
    },
    rpc: async (fn: string, args: unknown) => {
      log.push(`rpc ${fn} ${JSON.stringify(args)}`);
      return { data: state.role, error: null };
    },
  };
  const v1Stripe = new Proxy(
    {},
    {
      get(_, prop) {
        log.push(`v1 stripe.${String(prop)}`);
        throw new Error('the v1 Stripe client was reached');
      },
    },
  );
  return { ACCOUNT, log, state, session, v1Stripe, capture: vi.fn(), sessionsCreate: vi.fn() };
});

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: h.capture }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => h.session }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return {
      tag: 'admin',
      // The caller's own default account (readDefaultAccountId), the one read made before the
      // owner check, and only for several owner seats.
      from: (table: string) => {
        h.log.push(`admin.from ${table}`);
        const chain: Record<string, unknown> = {
          maybeSingle: async () => ({
            data: { default_account_id: h.state.defaultAccount },
            error: null,
          }),
        };
        chain.select = chain.eq = () => chain;
        return chain;
      },
    };
  },
}));
vi.mock('@/lib/stripe', () => ({ stripe: h.v1Stripe }));
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
          return { url: 'https://checkout.stripe.com/c/pay/cs_v2' };
        },
      },
    },
  }),
}));
vi.mock('@/lib/billing/stripe-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/stripe-catalog')>()),
  accountCatalog: () => ({
    priceFor: async (plan: string, interval: string) => {
      if (plan === 'agency' && interval === 'year') {
        const { CatalogError } = await import('@/lib/billing/stripe-catalog');
        throw new CatalogError('unresolved lookup keys: crawlmouse_agency_yearly');
      }
      return `price_${plan}_${interval}`;
    },
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
const { ACCOUNT } = h;
const OTHER = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';

const form = (body: string) =>
  POST(
    new Request(`${SITE}/api/billing/checkout`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  );
const json = (body: unknown) =>
  POST(
    new Request(`${SITE}/api/billing/checkout`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const stripeWrites = () => h.log.filter((l) => l.includes('stripe'));

beforeEach(() => {
  process.env.V2_BILLING = '1';
  process.env.NEXT_PUBLIC_BASE_URL = SITE;
  h.log.length = 0;
  h.state.user = { id: 'u1', email: 'owner@example.com' };
  h.state.seats = [{ account_id: ACCOUNT }];
  h.state.role = 'owner';
  h.state.defaultAccount = ACCOUNT;
  h.state.snapshot = FREE_START;
  h.capture.mockReset();
  h.sessionsCreate.mockReset();
});

describe('POST /api/billing/checkout, V2_BILLING=1', () => {
  it('401 auth_required without a session, and nothing else', async () => {
    h.state.user = null;
    const res = await form('plan=pro&interval=month');
    expect([res.status, await res.json()]).toEqual([401, { error: 'auth_required' }]);
    expect(h.log).toEqual(['getUser']);
  });

  it('checks the session, the owner seat and member_role, and only then makes the service-role client', async () => {
    const res = await form('plan=pro&interval=month');
    expect(res.status).toBe(303);
    expect(h.log.slice(0, 5)).toEqual([
      'getUser',
      'session.from seats',
      `rpc member_role {"p_account":"${ACCOUNT}"}`,
      'supabaseAdmin',
      'accounts over admin',
    ]);
  });

  it('answers a form with a 303 to Stripe, and never reaches the v1 Stripe client', async () => {
    const res = await form('plan=pro&interval=month');
    expect([res.status, res.headers.get('location')]).toEqual([
      303,
      'https://checkout.stripe.com/c/pay/cs_v2',
    ]);
    expect(h.log.some((l) => l.startsWith('v1 '))).toBe(false);
    expect(h.sessionsCreate.mock.calls[0]![0]).toMatchObject({
      customer: 'cus_1',
      client_reference_id: ACCOUNT,
      line_items: [{ price: 'price_pro_month', quantity: 1 }],
      success_url: `${SITE}/settings/plan?checkout=done`,
    });
  });

  it('answers JSON with {url}', async () => {
    const res = await json({ plan: 'agency', interval: 'month' });
    expect([res.status, await res.json()]).toEqual([
      200,
      { url: 'https://checkout.stripe.com/c/pay/cs_v2' },
    ]);
  });

  it.each([
    ['a v1 price id', { priceId: 'price_v1_monthly' }],
    ['no interval', { plan: 'pro' }],
    ['a plan that is not sold', { plan: 'team', interval: 'month' }],
    ['a price id beside the plan', { plan: 'pro', interval: 'month', priceId: 'price_x' }],
  ])('400 invalid for %s, before any account check or Stripe call', async (_, body) => {
    const res = await json(body);
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid' }]);
    expect(h.log).toEqual(['getUser']);
  });

  it('400 invalid for a body that is neither a form nor JSON', async () => {
    const res = await POST(
      new Request(`${SITE}/api/billing/checkout`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'text/plain' },
        body: 'plan=pro&interval=month',
      }),
    );
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid' }]);
    expect(h.log).toEqual(['getUser']);
  });

  describe('a caller who is not the owner is refused before any Stripe call', () => {
    it('403 not_owner with no owner seat (a manager, or no seat)', async () => {
      h.state.seats = [];
      const res = await form('plan=pro&interval=month');
      expect([res.status, await res.json()]).toEqual([403, { error: 'not_owner' }]);
      expect(h.log).toEqual(['getUser', 'session.from seats']);
    });

    it.each([
      ['a manager', 'account_manager'],
      ['a developer', 'developer'],
      ['not a member', null],
    ])('403 not_owner for %s of the account the request names', async (_, role) => {
      h.state.role = role;
      const res = await form(`plan=pro&interval=month&accountId=${OTHER}`);
      expect([res.status, await res.json()]).toEqual([403, { error: 'not_owner' }]);
      expect(h.log).toEqual(['getUser', `rpc member_role {"p_account":"${OTHER}"}`]);
    });

    // Q26: Settings' Choose Pro names no account; with the Agency trial's second owner seat it
    // acts on the default (personal) account. The service role reads that one value first.
    it('an owner of two accounts naming neither checks out the default account', async () => {
      h.state.seats = [{ account_id: ACCOUNT }, { account_id: OTHER }];
      h.state.defaultAccount = OTHER;
      const res = await form('plan=pro&interval=month');
      expect(res.status).toBe(303);
      expect(h.log.slice(0, 5)).toEqual([
        'getUser',
        'session.from seats',
        'supabaseAdmin',
        'admin.from users',
        `rpc member_role {"p_account":"${OTHER}"}`,
      ]);
    });

    it.each([
      ['a default the caller does not own', '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b'],
      ['no default', null],
    ])(
      '409 account_ambiguous for an owner of two accounts naming neither, with %s',
      async (_, d) => {
        h.state.seats = [{ account_id: ACCOUNT }, { account_id: OTHER }];
        h.state.defaultAccount = d;
        const res = await form('plan=pro&interval=month');
        expect([res.status, await res.json()]).toEqual([409, { error: 'account_ambiguous' }]);
        expect(stripeWrites()).toEqual([]);
        expect(h.log.filter((l) => l.startsWith('rpc') || l.startsWith('accounts'))).toEqual([]);
      },
    );
  });

  it('acts on the account the request names, once member_role says owner', async () => {
    const res = await form(`plan=pro&interval=year&accountId=${OTHER}`);
    expect(res.status).toBe(303);
    expect(h.log).not.toContain('session.from seats');
    expect(h.sessionsCreate.mock.calls[0]![0]).toMatchObject({ client_reference_id: OTHER });
  });

  it('409 subscription_open with {next: portal} for an account that follows a subscription', async () => {
    h.state.snapshot = { ...FREE_START, subscriptionId: 'sub_1kept' };
    const res = await form('plan=pro&interval=month');
    expect([res.status, await res.json()]).toEqual([
      409,
      { error: 'subscription_open', next: 'portal' },
    ]);
    expect(stripeWrites()).toEqual([]);
  });

  it('503 billing_unavailable when the catalog cannot be resolved, as a Sentry error', async () => {
    const res = await form('plan=agency&interval=year');
    expect([res.status, await res.json()]).toEqual([503, { error: 'billing_unavailable' }]);
    expect(h.capture.mock.calls).toEqual([
      [
        'billing.catalog-unavailable',
        {
          level: 'error',
          tags: { signal: 'billing.catalog-unavailable' },
          extra: { reason: 'unresolved lookup keys: crawlmouse_agency_yearly' },
        },
      ],
    ]);
    expect(stripeWrites()).toEqual([]);
  });
});
