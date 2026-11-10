import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleEdge } from '../../middleware';

// CC-03 D11: every v2 billing POST takes the strict origin rule. The request goes through the
// middleware and, when it passes, on to the real route with V2_BILLING=1, so a refusal is shown to
// happen before the route runs: no session read, no Stripe call. The session client answers a signed-in
// owner, so a request the middleware let through would reach Stripe.

const h = vi.hoisted(() => ({
  calls: [] as string[],
}));

const stripeProxy = (name: string): unknown =>
  new Proxy(() => undefined, {
    get(_, prop) {
      h.calls.push(`${name}.${String(prop)}`);
      return stripeProxy(`${name}.${String(prop)}`);
    },
    apply() {
      h.calls.push(`${name}()`);
      return Promise.resolve({ url: 'https://checkout.stripe.test/x', data: [] });
    },
  });

/** A query chain: records each call; awaiting it gives no rows. */
const chain = (name: string): unknown => {
  const link: unknown = new Proxy(() => undefined, {
    get(_, prop) {
      if (prop === 'then')
        return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return () => {
        h.calls.push(`${name}.${String(prop)}`);
        return link;
      };
    },
  });
  return link;
};

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: () => undefined }));
vi.mock('@/lib/stripe', () => ({ stripe: stripeProxy('v1-stripe') }));
vi.mock('@/lib/billing/stripe-account', () => ({
  stripeAccount: () => stripeProxy('stripe'),
  expectedLivemode: () => false,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.calls.push('supabaseAdmin()');
    return stripeProxy('admin');
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.calls.push('supabaseServer()');
    return {
      auth: {
        getUser: async () => {
          h.calls.push('getUser()');
          return { data: { user: { id: 'u1', email: 'a@b.co' } } };
        },
      },
      from: () => chain('session-db'),
      rpc: async () => ({ data: 'owner', error: null }),
    };
  },
}));

const ROUTES = [
  ['checkout', () => import('../../app/api/billing/checkout/route')],
  ['portal', () => import('../../app/api/billing/portal/route')],
  ['cancel', () => import('../../app/api/billing/cancel/route')],
  ['agency-trial', () => import('../../app/api/billing/agency-trial/route')],
] as const;

const BODY = new URLSearchParams({ plan: 'pro', interval: 'month' }).toString();

async function send(
  path: string,
  headers: Record<string, string>,
  load: () => Promise<{ POST: (r: Request) => Promise<Response> }>,
) {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: BODY,
  };
  const url = `https://crawlmouse.com/api/billing/${path}`;
  const edge = await handleEdge(
    new NextRequest(new Request(url, init)),
    (r) => Promise.resolve(NextResponse.next({ request: r })),
    () => {},
  );
  if (edge.headers.get('x-middleware-next') !== '1') return edge;
  const { POST } = await load();
  return POST(new Request(url, init));
}

beforeEach(() => {
  h.calls.length = 0;
  vi.stubEnv('V2_BILLING', '1');
});

describe.each(ROUTES)('POST /api/billing/%s (D11)', (path, load) => {
  it('refuses another site’s Origin with 403 before the route runs', async () => {
    const res = await send(path, { origin: 'https://evil.example' }, load);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Cross-site request refused', code: 'cross_site' });
    expect(h.calls).toEqual([]);
  });

  it('refuses a request with no Origin and no Sec-Fetch-Site with 403', async () => {
    const res = await send(path, {}, load);
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it('lets our own page’s form through to the route (the control)', async () => {
    const res = await send(path, { origin: 'https://crawlmouse.com' }, load);
    expect(h.calls).toContain('getUser()');
    // The route answered, not the middleware (whose 403 is `cross_site`).
    expect(await res.json()).not.toMatchObject({ code: 'cross_site' });
  });

  it('lets a no-JS form post that says it is same-origin through (the control)', async () => {
    await send(path, { 'sec-fetch-site': 'same-origin' }, load);
    expect(h.calls).toContain('getUser()');
  });
});
