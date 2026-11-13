/**
 * POST /api/reports/mint with `{checkId}` (CC-29 D7, Q21), over the real `supabaseMintDeps` with
 * stand-in Supabase clients. v1's body keeps v1's path (route.test.ts); this file holds the union,
 * the flag, and the parity of the two paths' cap and Turnstile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  capAllowed: true,
  turnstileOk: true,
  member: true,
  limits: [] as [string, number, number][],
  verified: [] as [string, string | undefined][],
  /** Every call on the service-role client, as `table.method` or `rpc:name`. */
  admin: [] as string[],
  /** Every call on the caller's session client. */
  session: [] as string[],
}));

vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '9.9.9.9' }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number, windowMs: number) => {
    s.limits.push([key, limit, windowMs]);
    return { allowed: s.capAllowed, remaining: 0, resetAt: new Date() };
  },
}));
vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: async (token: string, ip?: string) => {
    s.verified.push([token, ip]);
    return s.turnstileOk;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: s.user } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            s.session.push(`${table}.select`);
            return { data: { site_id: 'site-1', status: 'finished' }, error: null };
          },
        }),
      }),
    }),
    rpc: async (name: string) => {
      s.session.push(`rpc:${name}`);
      return { data: s.member, error: null };
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => () => {
          s.admin.push(String(prop));
          throw new Error('service role reached');
        },
      },
    ),
}));

const { POST } = await import('./route');

const CHECK = '123e4567-e89b-12d3-a456-426614174001';
const AUDIT = '123e4567-e89b-12d3-a456-426614174000';
const req = (body: unknown) =>
  new Request('http://localhost/api/reports/mint', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  Object.assign(s, {
    user: { id: 'u-1' },
    capAllowed: true,
    turnstileOk: true,
    member: true,
    limits: [],
    verified: [],
    admin: [],
    session: [],
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/reports/mint, the body union', () => {
  it('with the flag off, a checkId body is the 400 an unknown body is, before any work', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const res = await POST(req({ checkId: CHECK }));
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid request' }]);
    expect([s.limits, s.session, s.admin]).toEqual([[], [], []]);
  });

  it('an unknown body is 400 with the flag on or off, as it is on main', async () => {
    for (const flag of ['', '1']) {
      vi.stubEnv('V2_CHECKS_PUBLIC', flag);
      const res = await POST(req({ siteId: CHECK }));
      expect([res.status, await res.json()]).toEqual([400, { error: 'invalid request' }]);
    }
  });

  it('auditId and checkId together are 400, flag on or off', async () => {
    for (const flag of ['', '1']) {
      vi.stubEnv('V2_CHECKS_PUBLIC', flag);
      expect((await POST(req({ auditId: AUDIT, checkId: CHECK }))).status).toBe(400);
    }
    expect(s.limits).toEqual([]);
  });

  it('a checkId that is not a uuid, or a field beside it, is 400', async () => {
    expect((await POST(req({ checkId: 'nope' }))).status).toBe(400);
    expect((await POST(req({ checkId: CHECK, extra: 1 }))).status).toBe(400);
    expect(s.limits).toEqual([]);
  });

  it('signed out is 401', async () => {
    s.user = null;
    const res = await POST(req({ checkId: CHECK }));
    expect([res.status, await res.json()]).toEqual([401, { error: 'auth_required' }]);
  });

  it('another account’s check is 404, read through the caller’s session, the service role untouched', async () => {
    s.member = false;
    const res = await POST(req({ checkId: CHECK }));
    expect([res.status, await res.json()]).toEqual([404, { error: 'not_found' }]);
    expect(s.session).toEqual(['checks.select', 'rpc:is_member_for_site']);
    expect(s.admin).toEqual([]);
  });
});

describe('the v2 mint’s cap and Turnstile are v1’s authed path’s', () => {
  /** What a body meets at the cap: the answer, and the bucket and token checks it made. */
  async function atTheCap(body: Record<string, unknown>) {
    s.limits = [];
    s.verified = [];
    const res = await POST(req(body));
    return { status: res.status, body: await res.json(), limits: s.limits, verified: s.verified };
  }

  it('the same bucket and cap', async () => {
    s.capAllowed = false;
    const v1 = await atTheCap({ auditId: AUDIT });
    const v2 = await atTheCap({ checkId: CHECK });
    expect(v2).toEqual(v1);
    expect(v1.limits).toEqual([['mint:u-1', 20, 24 * 60 * 60 * 1000]]);
    expect(v1.body).toEqual({ error: 'captcha_required' });
  });

  it('the same refusal of a bad token, checked with the same arguments', async () => {
    s.capAllowed = false;
    s.turnstileOk = false;
    const v1 = await atTheCap({ auditId: AUDIT, turnstileToken: 'spent' });
    const v2 = await atTheCap({ checkId: CHECK, turnstileToken: 'spent' });
    expect(v2).toEqual(v1);
    expect(v1).toMatchObject({ status: 429, body: { error: 'captcha_failed' } });
    expect(v1.verified).toEqual([['spent', '9.9.9.9']]);
  });
});
