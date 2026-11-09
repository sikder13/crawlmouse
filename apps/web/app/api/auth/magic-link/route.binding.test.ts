import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, type NextFetchEvent } from 'next/server';

// A-8: every magic-link request binds this browser to the address it asked for (cm_auth_for), with
// the door on or off, so /login/verify can claim anonymous audits only for a link this browser asked
// for. Supabase, the rate limit and Turnstile are mocked; the route, the cookie rules and the
// middleware are real.
vi.mock('server-only', () => ({}));
const signInWithOtp = vi.fn(async () => ({ error: null as null | { status: number } }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { signInWithOtp } }),
}));
const limit = { allowed: true };
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => limit }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '203.0.113.4' }));
vi.mock('@/lib/turnstile-gate', () => ({ turnstileGate: async () => 'allow' }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => true }));
vi.mock('@/lib/security/refusal-event', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/security/refusal-event')>()),
  reportRefusal: async () => {},
}));

import { POST } from './route';
import { middleware } from '../../../../middleware';
import { emailBinding } from '@/lib/auth/continue-intent';
import { AUTH_LINK_SECONDS } from '@/lib/auth/constants';

const ORIGIN = 'https://crawlmouse.com';

const request = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const binding = (res: Response) =>
  res.headers.getSetCookie().find((c) => c.startsWith('cm_auth_for='));

beforeEach(() => {
  signInWithOtp.mockClear();
  signInWithOtp.mockResolvedValue({ error: null });
  limit.allowed = true;
});
afterEach(() => {
  delete process.env.V2_ACCOUNT_DOOR;
});

describe.each([
  ['off', undefined],
  ['on', '1'],
])('cm_auth_for with V2_ACCOUNT_DOOR %s', (_label, flag) => {
  beforeEach(() => {
    if (flag) process.env.V2_ACCOUNT_DOOR = flag;
  });

  it.each([
    ['a v1 sign-in', { email: 'Ada@Example.com' }],
    ['a sign-in with a return target', { email: 'ada@example.com', next: '/r/abc' }],
  ])(
    '%s is bound to its address: a hash, httpOnly, Lax, for the link lifetime',
    async (_n, body) => {
      const res = await POST(request(body));
      expect(res.status).toBe(200);
      const cookie = binding(res);
      expect(cookie?.split(';')[0]).toBe(`cm_auth_for=${emailBinding('ada@example.com')}`);
      expect(cookie).not.toMatch(/ada/i);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(new RegExp(`Max-Age=${AUTH_LINK_SECONDS}(;|$)`));
      expect(cookie).toMatch(/Path=\//);
    },
  );

  it("a new binding disowns an earlier request's named site and return target", async () => {
    // An earlier request (say a Keep for another address) left these behind; a request that names
    // neither must clear them, or the new address's link would carry them into its account.
    const res = await POST(request({ email: 'ada@example.com' }));
    const set = res.headers.getSetCookie();
    expect(set.find((c) => c.startsWith('cm_auth_signup='))).toMatch(/Max-Age=0/);
    expect(set.find((c) => c.startsWith('post_login_next='))).toMatch(/Max-Age=0/);
  });

  it("a resend for the address already bound keeps that request's named site and return target", async () => {
    // The Expired page's resend posts only the address; for the same person the door's Keep and
    // named site must survive it.
    const res = await POST(
      request(
        { email: 'Ada@Example.com' },
        { origin: ORIGIN, cookie: `cm_auth_for=${emailBinding('ada@example.com')}` },
      ),
    );
    const set = res.headers.getSetCookie();
    expect(set.find((c) => c.startsWith('cm_auth_signup='))).toBeUndefined();
    expect(set.find((c) => c.startsWith('post_login_next='))).toBeUndefined();
    expect(binding(res)?.split(';')[0]).toBe(`cm_auth_for=${emailBinding('ada@example.com')}`);
  });

  it('a request for another address than the one bound clears them', async () => {
    const res = await POST(
      request(
        { email: 'ada@example.com' },
        { origin: ORIGIN, cookie: `cm_auth_for=${emailBinding('bob@example.com')}` },
      ),
    );
    const set = res.headers.getSetCookie();
    expect(set.find((c) => c.startsWith('cm_auth_signup='))).toMatch(/Max-Age=0/);
    expect(set.find((c) => c.startsWith('post_login_next='))).toMatch(/Max-Age=0/);
  });

  it('marks the binding Secure in production, and only there', async () => {
    expect(binding(await POST(request({ email: 'ada@example.com' })))).not.toMatch(/Secure/i);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(binding(await POST(request({ email: 'ada@example.com' })))).toMatch(/;\s*Secure/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a request that sends no link sets no binding', async () => {
    limit.allowed = false;
    expect(binding(await POST(request({ email: 'ada@example.com' })))).toBeUndefined();
    limit.allowed = true;
    signInWithOtp.mockResolvedValueOnce({ error: { status: 500 } });
    expect(binding(await POST(request({ email: 'ada@example.com' })))).toBeUndefined();
    expect(binding(await POST(request({ email: 'not an email' })))).toBeUndefined();
  });

  it('a cross-site POST is refused with 403 before the route runs', async () => {
    const event = { waitUntil: () => {} } as unknown as NextFetchEvent;
    for (const headers of [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
    ] as Record<string, string>[]) {
      const req = new NextRequest(request({ email: 'ada@example.com' }, headers));
      const res = await middleware(req, event);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
