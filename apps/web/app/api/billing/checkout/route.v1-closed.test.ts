import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/billing/checkout while V2_CHECKS_PUBLIC is on and V2_BILLING is off (CC-45 hotfix): the
// v2 product is public but v2 billing is not, so a v1 purchase would sell a v1 entitlement the v2
// product does not read. The v1 branch refuses before it reads anything or calls Stripe. The harness is
// route.v1-pin.test.ts's; that file pins both flags off, route.test.ts pins V2_BILLING on.

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
  process.env.V2_CHECKS_PUBLIC = '1';
  process.env.NEXT_PUBLIC_BASE_URL = SITE;
  process.env.STRIPE_PRICE_ID_PRO_MONTHLY = MONTHLY;
  process.env.STRIPE_PRICE_ID_PRO_YEARLY = YEARLY;
  h.calls.length = 0;
  h.state.user = { id: 'u1', email: 'owner@example.com' };
  h.state.usersRow = null;
  h.create.mockReset().mockResolvedValue({ url: SESSION_URL });
});

const CLOSED = {
  status: 403,
  type: 'application/json',
  body: '{"error":"purchases_closed","message":"Paid plans open shortly. Nothing was charged."}',
};

describe('POST /api/billing/checkout, V2_CHECKS_PUBLIC on and V2_BILLING off', () => {
  it.each([
    ['the monthly price', JSON.stringify({ priceId: MONTHLY })],
    ['the yearly price', JSON.stringify({ priceId: YEARLY })],
    ['a body that is not JSON', 'not json'],
    ['a price that is not one of the env prices', JSON.stringify({ priceId: 'price_other' })],
  ])('refuses a signed-in purchase (%s) before any read or Stripe call', async (_, body) => {
    h.state.usersRow = { stripe_customer_id: 'cus_v1_1' };
    expect(await answer(await post(body))).toEqual(CLOSED);
    expect(h.calls).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('still answers 401 auth_required without a session', async () => {
    h.state.user = null;
    expect(await answer(await post(JSON.stringify({ priceId: MONTHLY })))).toEqual({
      status: 401,
      type: 'application/json',
      body: '{"error":"auth_required"}',
    });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('opens the v1 Checkout again when V2_CHECKS_PUBLIC is off (the guard is the flag, not the route)', async () => {
    delete process.env.V2_CHECKS_PUBLIC;
    expect((await post(JSON.stringify({ priceId: MONTHLY }))).status).toBe(200);
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});
