import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/billing/cancel (CC-03 D8). The session client, the service-role client and the Stripe
// client are fakes; the handler (lib/billing/cancel.ts) runs for real.

const h = vi.hoisted(() => {
  const ACCOUNT = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
  const log: string[] = [];
  const state = {
    user: { id: 'u1' } as unknown,
    seats: [{ account_id: ACCOUNT }] as unknown[],
    role: 'owner' as unknown,
    followed: null as unknown,
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
  return { ACCOUNT, log, state, session, update: vi.fn() };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => h.session }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return { tag: 'admin' };
  },
}));
vi.mock('@/lib/billing/stripe-account', () => ({
  stripeAccount: () => ({
    subscriptions: {
      retrieve: async (id: string) => {
        h.log.push(`stripe.subscriptions.retrieve ${id}`);
        return { id, status: 'active', trial_end: null, items: { data: [] } };
      },
      update: async (...args: unknown[]) => {
        h.log.push('stripe.subscriptions.update');
        h.update(...args);
        return {
          status: 'active',
          trial_end: null,
          items: { data: [{ current_period_end: Date.parse('2026-12-01T00:00:00Z') / 1000 }] },
        };
      },
      cancel: async () => {
        h.log.push('stripe.subscriptions.cancel');
        return {};
      },
    },
  }),
}));
vi.mock('@/lib/billing/cancel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/cancel')>()),
  supabaseCancelAccounts: (admin: { tag: string }) => {
    h.log.push(`accounts over ${admin.tag}`);
    return { followed: async () => h.state.followed };
  },
}));

import { POST } from './route';

const SITE = 'https://crawlmouse.com';
const { ACCOUNT } = h;
const OTHER = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';
const SUB = 'sub_1Followed';

const post = (body: string, type = 'application/x-www-form-urlencoded') =>
  POST(
    new Request(`${SITE}/api/billing/cancel`, {
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
  h.state.user = { id: 'u1' };
  h.state.seats = [{ account_id: ACCOUNT }];
  h.state.role = 'owner';
  h.state.followed = {
    id: SUB,
    mirror: {
      status: 'active',
      trialEnd: null,
      currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
    },
  };
  h.update.mockReset();
});

describe('POST /api/billing/cancel', () => {
  it('401 auth_required without a session, flag set or not', async () => {
    h.state.user = null;
    for (const flag of ['1', undefined]) {
      if (flag === undefined) delete process.env.V2_BILLING;
      h.log.length = 0;
      const res = await post('confirm=true');
      expect([res.status, await res.json()]).toEqual([401, { error: 'auth_required' }]);
      expect(h.log).toEqual(['getUser']);
    }
  });

  it('404 not_found with V2_BILLING unset, after the session and before anything else', async () => {
    delete process.env.V2_BILLING;
    const res = await post('confirm=true');
    expect([res.status, await res.json()]).toEqual([404, { error: 'not_found' }]);
    expect(h.log).toEqual(['getUser']);
  });

  it('the first click sends the form back to Settings › Plan, with no Stripe call', async () => {
    const res = await post('');
    expect([res.status, res.headers.get('location')]).toEqual([
      303,
      `${SITE}/settings/plan?cancel=confirm`,
    ]);
    expect(stripeCalls()).toEqual([]);
    expect(h.log).toEqual([
      'getUser',
      'session.from seats',
      `rpc member_role {"p_account":"${ACCOUNT}"}`,
      'supabaseAdmin',
      'accounts over admin',
    ]);
  });

  it('the first click answers JSON with the step and when it would end', async () => {
    const res = await post('{}', 'application/json');
    expect([res.status, await res.json()]).toEqual([
      200,
      { step: 'confirm', endsAt: '2026-12-01T00:00:00.000Z' },
    ]);
    expect(stripeCalls()).toEqual([]);
  });

  it('the second click cancels at the period end, once', async () => {
    const res = await post('{"confirm":true}', 'application/json');
    expect([res.status, await res.json()]).toEqual([
      200,
      { step: 'done', endsAt: '2026-12-01T00:00:00.000Z' },
    ]);
    expect(stripeCalls()).toEqual([
      `stripe.subscriptions.retrieve ${SUB}`,
      'stripe.subscriptions.update',
    ]);
    expect(h.update.mock.calls).toEqual([[SUB, { cancel_at_period_end: true }]]);
  });

  it('a form second click goes back to Settings › Plan, done', async () => {
    const res = await post('confirm=true');
    expect([res.status, res.headers.get('location')]).toEqual([
      303,
      `${SITE}/settings/plan?cancel=done`,
    ]);
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it('409 no_subscription for an account that follows none', async () => {
    h.state.followed = null;
    const res = await post('confirm=true');
    expect([res.status, await res.json()]).toEqual([409, { error: 'no_subscription' }]);
    expect(stripeCalls()).toEqual([]);
  });

  it('400 invalid for a body it does not read, before any account check', async () => {
    const res = await post('confirm=yes');
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid' }]);
    expect(h.log).toEqual(['getUser']);
  });

  it('403 not_owner without an owner seat, before any Stripe call', async () => {
    h.state.seats = [];
    const res = await post('confirm=true');
    expect([res.status, await res.json()]).toEqual([403, { error: 'not_owner' }]);
    expect(h.log).toEqual(['getUser', 'session.from seats']);
  });

  it('403 not_owner for a manager of the account the request names, before any Stripe call', async () => {
    h.state.role = 'account_manager';
    const res = await post(`confirm=true&accountId=${OTHER}`);
    expect([res.status, await res.json()]).toEqual([403, { error: 'not_owner' }]);
    expect(h.log).toEqual(['getUser', `rpc member_role {"p_account":"${OTHER}"}`]);
  });

  it('an owner of two accounts naming neither acts on the one their switcher names, and on neither when it names a third', async () => {
    h.state.seats = [{ account_id: ACCOUNT }, { account_id: OTHER }];
    const withChoice = (accountId: string) =>
      POST(
        new Request(`${SITE}/api/billing/cancel`, {
          method: 'POST',
          headers: {
            origin: SITE,
            'content-type': 'application/x-www-form-urlencoded',
            cookie: `theme=dark; cm_account=${accountId}`,
          },
          body: '',
        }),
      );
    await withChoice(OTHER);
    expect(h.log).toContain(`rpc member_role {"p_account":"${OTHER}"}`);
    h.log.length = 0;
    const third = await withChoice('9a1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f');
    expect([third.status, await third.json()]).toEqual([409, { error: 'account_ambiguous' }]);
    expect(h.log.filter((l) => l.startsWith('rpc member_role'))).toEqual([]);
  });

  it('409 account_ambiguous for an owner of two accounts naming neither', async () => {
    h.state.seats = [{ account_id: ACCOUNT }, { account_id: OTHER }];
    const res = await post('confirm=true');
    expect([res.status, await res.json()]).toEqual([409, { error: 'account_ambiguous' }]);
    expect(stripeCalls()).toEqual([]);
  });
});
