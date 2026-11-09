import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/billing/portal with V2_BILLING unset answers as on main (CC-03 D1): each v1 branch is
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
  stripe: { billingPortal: { sessions: { create: (...a: unknown[]) => h.create(...a) } } },
}));

import { POST } from './route';

const SITE = 'https://crawlmouse.com';
const PORTAL_URL = 'https://billing.stripe.com/p/session/test_1';

function post(origin: string | null = SITE) {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.origin = origin;
  return POST(new Request(`${SITE}/api/billing/portal`, { method: 'POST', headers }));
}

async function answer(res: Response) {
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

const USERS_READ = [
  ['from', 'users'],
  ['select', 'stripe_customer_id'],
  ['eq', 'id', 'u1'],
  ['maybeSingle'],
];

beforeEach(() => {
  delete process.env.V2_BILLING;
  process.env.NEXT_PUBLIC_BASE_URL = SITE;
  h.calls.length = 0;
  h.state.user = { id: 'u1', email: 'owner@example.com' };
  h.state.usersRow = null;
  h.create.mockReset().mockResolvedValue({ url: PORTAL_URL });
});

describe('POST /api/billing/portal, V2_BILLING unset (v1, as on main)', () => {
  it('401 auth_required without a session, and nothing read or created', async () => {
    h.state.user = null;
    expect(await answer(await post())).toEqual({
      status: 401,
      type: 'application/json',
      body: '{"error":"auth_required"}',
    });
    expect(h.calls).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it.each([
    ['no users row', null],
    ['a row with no customer', { stripe_customer_id: null }],
  ])('400 no_customer for %s', async (_, row) => {
    h.state.usersRow = row;
    expect(await answer(await post())).toEqual({
      status: 400,
      type: 'application/json',
      body: '{"error":"no_customer"}',
    });
    expect(h.calls).toEqual(USERS_READ);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("opens the portal on the user's customer and returns to the dashboard", async () => {
    h.state.usersRow = { stripe_customer_id: 'cus_v1_1' };
    expect(await answer(await post())).toEqual({
      status: 200,
      type: 'application/json',
      body: `{"url":"${PORTAL_URL}"}`,
    });
    expect(h.calls).toEqual(USERS_READ);
    expect(h.create.mock.calls).toStrictEqual([
      [{ customer: 'cus_v1_1', return_url: `${SITE}/dashboard` }],
    ]);
  });

  it.each([
    ['a foreign Origin', 'https://evil.example', SITE],
    ['no Origin', null, SITE],
    ['the local dev Origin', 'http://localhost:3000', 'http://localhost:3000'],
  ])('returns to the configured origin for %s', async (_, origin, base) => {
    h.state.usersRow = { stripe_customer_id: 'cus_v1_1' };
    await post(origin);
    expect(h.create.mock.calls).toStrictEqual([
      [{ customer: 'cus_v1_1', return_url: `${base}/dashboard` }],
    ]);
  });
});
