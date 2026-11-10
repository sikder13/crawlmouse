import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/billing/checkout with V2_BILLING unset answers as on main (CC-03 D1): each v1 branch is
// pinned by its status, its body byte for byte, and every argument of every Supabase and Stripe call.
// The mocks are the modules main's route imports, so this file passes against main's route as well.

const h = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const state = { user: null as unknown, usersRow: null as unknown };
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') return undefined;
          return (...args: unknown[]) => {
            calls.push([prop, ...args]);
            return prop === 'maybeSingle'
              ? Promise.resolve({ data: state.usersRow, error: null })
              : chain();
          };
        },
      },
    );
  const client = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => {
      calls.push(['from', table]);
      return chain();
    },
  };
  return { calls, state, client, create: vi.fn() };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => h.client }));
vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: (...a: unknown[]) => h.create(...a) } } },
}));

import { POST } from './route';

const SITE = 'https://crawlmouse.com';
const MONTHLY = 'price_v1_monthly';
const YEARLY = 'price_v1_yearly';
const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_1';

function post(body: string, origin: string | null = SITE) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin !== null) headers.origin = origin;
  return POST(new Request(`${SITE}/api/billing/checkout`, { method: 'POST', headers, body }));
}

async function answer(res: Response) {
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

beforeEach(() => {
  delete process.env.V2_BILLING;
  process.env.NEXT_PUBLIC_BASE_URL = SITE;
  process.env.STRIPE_PRICE_ID_PRO_MONTHLY = MONTHLY;
  process.env.STRIPE_PRICE_ID_PRO_YEARLY = YEARLY;
  h.calls.length = 0;
  h.state.user = { id: 'u1', email: 'owner@example.com' };
  h.state.usersRow = null;
  h.create.mockReset().mockResolvedValue({ url: SESSION_URL });
});

const USERS_READ = [
  ['from', 'users'],
  ['select', 'stripe_customer_id'],
  ['eq', 'id', 'u1'],
  ['maybeSingle'],
];

describe('POST /api/billing/checkout, V2_BILLING unset (v1, as on main)', () => {
  it('401 auth_required without a session, and nothing read or created', async () => {
    h.state.user = null;
    expect(await answer(await post(JSON.stringify({ priceId: MONTHLY })))).toEqual({
      status: 401,
      type: 'application/json',
      body: '{"error":"auth_required"}',
    });
    expect(h.calls).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['no priceId', '{}'],
    ['a priceId that is not a string', '{"priceId":42}'],
  ])('400 invalid for %s, before any read', async (_, body) => {
    expect(await answer(await post(body))).toEqual({
      status: 400,
      type: 'application/json',
      body: '{"error":"invalid"}',
    });
    expect(h.calls).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('400 bad_price for a price that is not one of the two env prices, before any read', async () => {
    expect(await answer(await post(JSON.stringify({ priceId: 'price_other' })))).toEqual({
      status: 400,
      type: 'application/json',
      body: '{"error":"bad_price"}',
    });
    expect(h.calls).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('reuses the stored Stripe customer', async () => {
    h.state.usersRow = { stripe_customer_id: 'cus_v1_1' };
    expect(await answer(await post(JSON.stringify({ priceId: MONTHLY })))).toEqual({
      status: 200,
      type: 'application/json',
      body: `{"url":"${SESSION_URL}"}`,
    });
    expect(h.calls).toEqual(USERS_READ);
    expect(h.create.mock.calls).toStrictEqual([
      [
        {
          mode: 'subscription',
          line_items: [{ price: MONTHLY, quantity: 1 }],
          client_reference_id: 'u1',
          customer: 'cus_v1_1',
          allow_promotion_codes: true,
          success_url: `${SITE}/dashboard?upgraded=1`,
          cancel_url: `${SITE}/pricing`,
        },
      ],
    ]);
  });

  it.each([
    ['no users row', null],
    ['a row with no customer', { stripe_customer_id: null }],
  ])('passes the email for a new customer (%s)', async (_, row) => {
    h.state.usersRow = row;
    expect(await answer(await post(JSON.stringify({ priceId: YEARLY })))).toEqual({
      status: 200,
      type: 'application/json',
      body: `{"url":"${SESSION_URL}"}`,
    });
    expect(h.calls).toEqual(USERS_READ);
    expect(h.create.mock.calls).toStrictEqual([
      [
        {
          mode: 'subscription',
          line_items: [{ price: YEARLY, quantity: 1 }],
          client_reference_id: 'u1',
          customer_email: 'owner@example.com',
          allow_promotion_codes: true,
          success_url: `${SITE}/dashboard?upgraded=1`,
          cancel_url: `${SITE}/pricing`,
        },
      ],
    ]);
  });

  it('passes customer_email undefined for a user with no email', async () => {
    h.state.user = { id: 'u1' };
    await post(JSON.stringify({ priceId: MONTHLY }));
    expect(h.create.mock.calls).toStrictEqual([
      [
        {
          mode: 'subscription',
          line_items: [{ price: MONTHLY, quantity: 1 }],
          client_reference_id: 'u1',
          customer_email: undefined,
          allow_promotion_codes: true,
          success_url: `${SITE}/dashboard?upgraded=1`,
          cancel_url: `${SITE}/pricing`,
        },
      ],
    ]);
  });

  it.each([
    ['a foreign Origin', 'https://evil.example', SITE],
    ['no Origin', null, SITE],
    ['the local dev Origin', 'http://localhost:3000', 'http://localhost:3000'],
  ])('builds the return URLs on the configured origin for %s', async (_, origin, base) => {
    h.state.usersRow = { stripe_customer_id: 'cus_v1_1' };
    await post(JSON.stringify({ priceId: MONTHLY }), origin);
    const [args] = h.create.mock.calls[0] as [{ success_url: string; cancel_url: string }];
    expect([args.success_url, args.cancel_url]).toEqual([
      `${base}/dashboard?upgraded=1`,
      `${base}/pricing`,
    ]);
  });
});
