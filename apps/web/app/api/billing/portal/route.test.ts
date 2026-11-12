import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/billing/portal with V2_BILLING=1 (CC-03 D8). The session client, the service-role client
// and both Stripe clients are fakes; the handler (lib/billing/portal-v2.ts) runs for real.

const h = vi.hoisted(() => {
  const ACCOUNT = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
  const log: string[] = [];
  const state = {
    user: { id: 'u1' } as unknown,
    seats: [{ account_id: ACCOUNT }] as unknown[],
    role: 'owner' as unknown,
    personal: [] as unknown[],
    customer: 'cus_1' as string | null,
  };
  const seatsChain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve({ data: state.seats, error: null }),
  };
  seatsChain.select = seatsChain.eq = () => seatsChain;
  // The caller's owned accounts that are personal (ownedAccountId, for several owner seats).
  const accountsChain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve({ data: state.personal, error: null }),
  };
  accountsChain.select = accountsChain.eq = accountsChain.in = () => accountsChain;
  const session = {
    auth: {
      getUser: async () => {
        log.push('getUser');
        return { data: { user: state.user }, error: null };
      },
    },
    from: (table: string) => {
      log.push(`session.from ${table}`);
      return table === 'accounts' ? accountsChain : seatsChain;
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
  return { ACCOUNT, log, state, session, v1Stripe, create: vi.fn() };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => h.session }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return { tag: 'admin' };
  },
}));
vi.mock('@/lib/stripe', () => ({ stripe: h.v1Stripe }));
vi.mock('@/lib/billing/stripe-account', () => ({
  stripeAccount: () => ({
    billingPortal: {
      sessions: {
        create: async (params: unknown) => {
          h.log.push('stripe.billingPortal.sessions.create');
          h.create(params);
          return { url: 'https://billing.stripe.com/p/session/v2' };
        },
      },
    },
  }),
}));
vi.mock('@/lib/billing/portal-config', () => ({
  accountPortalConfiguration: async () => {
    h.log.push('portal configuration');
    return 'bpc_ours';
  },
}));
vi.mock('@/lib/billing/portal-v2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/portal-v2')>()),
  supabasePortalAccounts: (admin: { tag: string }) => {
    h.log.push(`accounts over ${admin.tag}`);
    return { customerOf: async () => h.state.customer };
  },
}));

import { POST } from './route';

const SITE = 'https://crawlmouse.com';
const { ACCOUNT } = h;
const OTHER = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';

const post = (body: string, type = 'application/x-www-form-urlencoded') =>
  POST(
    new Request(`${SITE}/api/billing/portal`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': type },
      body,
    }),
  );

beforeEach(() => {
  process.env.V2_BILLING = '1';
  process.env.NEXT_PUBLIC_BASE_URL = SITE;
  h.log.length = 0;
  h.state.user = { id: 'u1' };
  h.state.seats = [{ account_id: ACCOUNT }];
  h.state.role = 'owner';
  h.state.personal = [];
  h.state.customer = 'cus_1';
  h.create.mockReset();
});

const stripeCalls = () => h.log.filter((l) => l.includes('stripe') || l.includes('portal'));

describe('POST /api/billing/portal, V2_BILLING=1', () => {
  it('401 auth_required without a session, and nothing else', async () => {
    h.state.user = null;
    const res = await post('');
    expect([res.status, await res.json()]).toEqual([401, { error: 'auth_required' }]);
    expect(h.log).toEqual(['getUser']);
  });

  it("opens v2's portal for the owner's account: a form gets a 303, and v1 is not reached", async () => {
    const res = await post('');
    expect([res.status, res.headers.get('location')]).toEqual([
      303,
      'https://billing.stripe.com/p/session/v2',
    ]);
    expect(h.log).toEqual([
      'getUser',
      'session.from seats',
      `rpc member_role {"p_account":"${ACCOUNT}"}`,
      'supabaseAdmin',
      'accounts over admin',
      'portal configuration',
      'stripe.billingPortal.sessions.create',
    ]);
    expect(h.create.mock.calls).toEqual([
      [{ customer: 'cus_1', configuration: 'bpc_ours', return_url: `${SITE}/settings/plan` }],
    ]);
  });

  it('answers JSON with {url}', async () => {
    const res = await post('{}', 'application/json');
    expect([res.status, await res.json()]).toEqual([
      200,
      { url: 'https://billing.stripe.com/p/session/v2' },
    ]);
  });

  it('400 no_customer for an account Stripe does not know', async () => {
    h.state.customer = null;
    const res = await post('');
    expect([res.status, await res.json()]).toEqual([400, { error: 'no_customer' }]);
    expect(stripeCalls()).toEqual([]);
  });

  it('400 invalid for a body that names a customer, before any account check', async () => {
    const res = await post('customer=cus_other');
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid' }]);
    expect(h.log).toEqual(['getUser']);
  });

  it('403 not_owner without an owner seat, before any Stripe call', async () => {
    h.state.seats = [];
    const res = await post('');
    expect([res.status, await res.json()]).toEqual([403, { error: 'not_owner' }]);
    expect(h.log).toEqual(['getUser', 'session.from seats']);
  });

  it('403 not_owner for a manager of the account the request names, before any Stripe call', async () => {
    h.state.role = 'account_manager';
    const res = await post(`accountId=${OTHER}`);
    expect([res.status, await res.json()]).toEqual([403, { error: 'not_owner' }]);
    expect(h.log).toEqual(['getUser', `rpc member_role {"p_account":"${OTHER}"}`]);
  });

  // Q26: Settings' Manage billing names no account; with the Agency trial's second owner seat it
  // opens the personal (default) account's portal.
  it('an owner of two accounts naming neither opens the personal one', async () => {
    h.state.seats = [{ account_id: ACCOUNT }, { account_id: OTHER }];
    h.state.personal = [{ id: OTHER }];
    const res = await post('');
    expect(res.status).toBe(303);
    expect(h.log.slice(0, 5)).toEqual([
      'getUser',
      'session.from seats',
      'session.from accounts',
      `rpc member_role {"p_account":"${OTHER}"}`,
      'supabaseAdmin',
    ]);
  });

  it('409 account_ambiguous for an owner of two accounts naming neither, neither personal', async () => {
    h.state.seats = [{ account_id: ACCOUNT }, { account_id: OTHER }];
    const res = await post('');
    expect([res.status, await res.json()]).toEqual([409, { error: 'account_ambiguous' }]);
    expect(stripeCalls()).toEqual([]);
    expect(h.log).not.toContain('supabaseAdmin');
  });
});
