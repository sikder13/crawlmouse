import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_POLICIES } from '../../lib/security/route-policy';
import { routeFile } from './route-source';

// Every signed-in route, called with no session, refuses, and writes nothing on the way: no
// service-role or session write, no rate-limit bucket, no Stripe, Inngest or claim call. Reads are
// recorded and allowed (a route may look a row up before it decides), and the ones that happen are
// listed below, so a new one shows up in review.

const calls = vi.hoisted(() => [] as string[]);

/** A Supabase client stand-in: records every call; awaiting any chain gives { data: null }. */
const recorder = vi.hoisted(() => (name: string): unknown => {
  const chain: unknown = new Proxy(() => undefined, {
    get(_, prop) {
      if (prop === 'then')
        return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return (...args: unknown[]) => {
        calls.push(
          `${name}.${String(prop)}${prop === 'from' || prop === 'rpc' ? `(${String(args[0])})` : ''}`,
        );
        return chain;
      };
    },
  });
  return chain;
});

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    const client = recorder('session') as Record<string, unknown>;
    return new Proxy(client, {
      get(target, prop) {
        if (prop === 'then') return undefined; // the client itself is not a promise
        if (prop === 'auth')
          return { getUser: async () => ({ data: { user: null }, error: null }) };
        return (target as Record<string | symbol, unknown>)[prop];
      },
    });
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => recorder('admin') }));
vi.mock('@/lib/stripe', () => ({ stripe: recorder('stripe') }));
vi.mock('@/lib/inngest', () => ({ inngest: recorder('inngest') }));
vi.mock('@/lib/auth/door-deps', () => ({ doorDeps: () => recorder('door') }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string) => {
    calls.push(`rateLimit(${key.split(':')[0]})`);
    return { allowed: true };
  },
}));
vi.mock('next/cache', () => ({
  revalidatePath: () => calls.push('revalidatePath'),
  revalidateTag: () => calls.push('revalidateTag'),
  unstable_cache: (fn: unknown) => fn,
}));

const WRITES =
  /\.(insert|update|upsert|delete|rpc|upload|remove|send|create)\b|^(stripe|inngest|door)\.|^rateLimit|^revalidate/;

/** What each signed-in route answers a caller with no session, and the reads it makes first. */
const ANONYMOUS: Record<
  string,
  { status: number; body?: unknown; location?: string; reads?: string[] }
> = {
  'api/alert-rules': { status: 401, body: { code: 'auth_required' } },
  'api/audits/[id]/export': { status: 401, body: { error: 'auth_required' } },
  'api/audits/[id]/llms-txt': { status: 401, body: { error: 'auth_required' } },
  // authorizeReaudit decides with the audit row in hand, so the row is read first.
  'api/audits/[id]/reaudit': {
    status: 401,
    reads: ['admin.from(audits)', 'admin.select', 'admin.eq', 'admin.maybeSingle'],
  },
  'api/billing/agency-trial': { status: 401, body: { error: 'auth_required' } },
  'api/billing/cancel': { status: 401, body: { error: 'auth_required' } },
  'api/billing/checkout': { status: 401, body: { error: 'auth_required' } },
  'api/billing/portal': { status: 401, body: { error: 'auth_required' } },
  'api/billing/status': { status: 401, body: { pro: false } },
  'api/checks/[id]/claim': { status: 401, body: { code: 'auth_required' } },
  'api/reports/[slug]/claim': { status: 401, body: { error: 'auth_required' } },
  'api/reports/[slug]/logo': { status: 401, body: { error: 'auth_required' } },
  // The owner island's probe: a caller with no session gets the deny answer before any read.
  'api/reports/[slug]/mine': { status: 200, body: { owned: false } },
  'api/reports/[slug]/visibility': { status: 401, body: { error: 'auth_required' } },
  'api/reports/[slug]/white-label': { status: 401, body: { error: 'auth_required' } },
  'api/verify/check/[id]': { status: 401, body: { error: 'auth required' } },
  'api/verify/start': { status: 401, body: { error: 'auth required' } },
  billing: { status: 307, location: 'https://crawlmouse.com/login' },
};

const signedIn = ROUTE_POLICIES.filter((p) => p.class === 'user' || p.class === 'member');
const ID = '6f1c2a8e-0000-4000-8000-000000000000';

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv('V2_ACCOUNT_DOOR', '1');
  // The CC-27b routes answer 404 with V2_CHECKS_PUBLIC unset.
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});
afterEach(() => vi.unstubAllEnvs());

describe('a signed-in route refuses a caller with no session, and writes nothing', () => {
  it('every user and member route has an expected anonymous answer here', () => {
    expect(signedIn.map((p) => p.route).sort()).toEqual(Object.keys(ANONYMOUS).sort());
  });

  it.each(signedIn.flatMap((p) => p.methods.map((m) => [p.route, m] as const)))(
    '%s %s',
    async (route, method) => {
      const mod = (await import(routeFile(route))) as Record<string, unknown>;
      const handler = mod[method] as (req: Request, ctx: unknown) => Promise<Response>;
      const url = `https://crawlmouse.com/${route.replace(/\[id\]/, ID).replace(/\[[^\]]+\]/g, 'sample')}`;
      const req = new Request(url, {
        method,
        headers: { origin: 'https://crawlmouse.com', 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      const res = await handler(req, { params: Promise.resolve({ id: ID, slug: 'sample' }) });

      const want = ANONYMOUS[route]!;
      expect(res.status).toBe(want.status);
      if (want.body !== undefined) expect(await res.json()).toEqual(want.body);
      if (want.location !== undefined) expect(res.headers.get('location')).toBe(want.location);
      expect(calls.filter((c) => WRITES.test(c))).toEqual([]);
      expect(calls).toEqual(want.reads ?? []);
    },
  );
});

describe('the recorder sees what it guards against', () => {
  it('a write through any client is caught by the write pattern', () => {
    for (const c of [
      'admin.insert',
      'session.update',
      'admin.rpc(increment_rate_limit)',
      'stripe.billingPortal',
      'inngest.send',
      'rateLimit(verify)',
    ]) {
      expect(WRITES.test(c), c).toBe(true);
    }
    for (const c of ['admin.from(audits)', 'admin.select', 'session.eq', 'admin.maybeSingle']) {
      expect(WRITES.test(c), c).toBe(false);
    }
  });
});
