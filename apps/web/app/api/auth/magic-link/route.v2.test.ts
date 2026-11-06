import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The v2 door's additions to the magic-link route (CC-25 scope 4, D1). Supabase, the rate-limit RPC
// and Turnstile are mocked; the flag, the cookie rules, the host check and the zone check are real.
vi.mock('server-only', () => ({}));
const signInWithOtp = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { signInWithOtp } }),
}));
const limit = { allowed: true };
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => limit }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '203.0.113.4' }));
const gate = { outcome: 'allow' as 'allow' | 'block' };
vi.mock('@/lib/turnstile-gate', () => ({ turnstileGate: async () => gate.outcome }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => true }));

import { POST } from './route';

const ORIGIN = 'https://crawlmouse.com';
const CHECK = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';

const call = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }, cookie = '') =>
  POST(
    new Request(`${ORIGIN}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

const cookieNamed = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const valueOf = (res: Response, name: string) =>
  decodeURIComponent(
    cookieNamed(res, name)
      ?.split(';')[0]!
      .slice(name.length + 1) ?? '',
  );

beforeEach(() => {
  signInWithOtp.mockClear();
  limit.allowed = true;
  gate.outcome = 'allow';
  process.env.V2_ACCOUNT_DOOR = '1';
});
afterEach(() => {
  delete process.env.V2_ACCOUNT_DOOR;
});

describe('with V2_ACCOUNT_DOOR off, the route is exactly v1', () => {
  beforeEach(() => {
    delete process.env.V2_ACCOUNT_DOOR;
  });

  it('ignores site, tz and claimCheckId: no v2 cookie, the client next honoured, 600 s', async () => {
    const res = await call({
      email: 'a@b.com',
      site: 'not a host!!',
      tz: 'Nope/Zone',
      claimCheckId: 'not-a-uuid',
      next: '/r/abc',
    });
    expect(res.status).toBe(200);
    expect(cookieNamed(res, 'cm_auth_signup')).toBeUndefined();
    expect(cookieNamed(res, 'cm_auth_device')).toBeUndefined();
    expect(valueOf(res, 'post_login_next')).toBe('/r/abc');
    expect(cookieNamed(res, 'post_login_next')).toMatch(/Max-Age=600/);
  });

  it('does not refuse a cross-site origin (v1 never did)', async () => {
    const res = await call({ email: 'a@b.com' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(200);
  });
});

describe('with V2_ACCOUNT_DOOR=1', () => {
  it('a Keep: next is the claim, set by the route, for the link lifetime; the client next is ignored', async () => {
    const res = await call({ email: 'a@b.com', claimCheckId: CHECK, tz: 'UTC', next: '/r/evil' });
    expect(res.status).toBe(200);
    expect(valueOf(res, 'post_login_next')).toBe(`/api/checks/${CHECK}/claim?then=/dashboard`);
    expect(cookieNamed(res, 'post_login_next')).toMatch(/Max-Age=900/);
  });

  it('a sign-up: next is /dashboard, and cm_auth_signup carries the normalised host and the zone', async () => {
    const res = await call({
      email: 'a@b.com',
      site: 'https://Acme-Outdoors.com/x',
      tz: 'Asia/Kolkata',
    });
    expect(res.status).toBe(200);
    expect(valueOf(res, 'post_login_next')).toBe('/dashboard');
    expect(JSON.parse(valueOf(res, 'cm_auth_signup'))).toEqual({
      site: 'acme-outdoors.com',
      tz: 'Asia/Kolkata',
    });
    const c = cookieNamed(res, 'cm_auth_signup')!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Max-Age=900/);
  });

  it('an unknown zone is dropped, never refused: a sign-in does not fail over a zone', async () => {
    for (const tz of ['Mars/Olympus', 'x'.repeat(500), 42]) {
      const res = await call({ email: 'a@b.com', tz });
      expect(res.status).toBe(200);
      expect(JSON.parse(valueOf(res, 'cm_auth_signup') || '{}').tz).toBeUndefined();
    }
  });

  it('a zone Node does not list but the browser reports is kept (Europe/Kyiv, Asia/Kolkata)', async () => {
    for (const tz of ['Europe/Kyiv', 'Asia/Kolkata', 'UTC']) {
      const res = await call({ email: 'a@b.com', tz });
      expect(JSON.parse(valueOf(res, 'cm_auth_signup')).tz).toBe(tz);
    }
  });

  it('a site that is not a host is a 400 invalid_site, after the rate limits and Turnstile', async () => {
    gate.outcome = 'block';
    expect((await call({ email: 'a@b.com', site: '10.0.0.1' })).status).toBe(400);
    expect(await (await call({ email: 'a@b.com', site: '10.0.0.1' })).json()).toMatchObject({
      code: 'verification',
    });
    gate.outcome = 'allow';
    const res = await call({ email: 'a@b.com', site: '10.0.0.1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_site' });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('a claimCheckId that is not a uuid is a 400 before anything is sent', async () => {
    const res = await call({ email: 'a@b.com', claimCheckId: '../../etc' });
    expect(res.status).toBe(400);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('sets cm_auth_device when absent (random, httpOnly, a year) and leaves an existing one alone', async () => {
    const res = await call({ email: 'a@b.com', tz: 'UTC' });
    const c = cookieNamed(res, 'cm_auth_device')!;
    expect(valueOf(res, 'cm_auth_device')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(new RegExp(`Max-Age=${365 * 24 * 60 * 60}`));
    const again = await call(
      { email: 'a@b.com', tz: 'UTC' },
      { origin: ORIGIN },
      'cm_auth_device=kept',
    );
    expect(cookieNamed(again, 'cm_auth_device')).toBeUndefined();
  });

  it('binds a door request to its address in cm_auth_for, as a hash', async () => {
    const res = await call({ email: 'Ada@Example.com', tz: 'UTC' });
    expect(valueOf(res, 'cm_auth_for')).toMatch(/^[0-9a-f]{64}$/);
    expect(valueOf(res, 'cm_auth_for')).not.toContain('ada');
    expect(cookieNamed(res, 'cm_auth_for')).toMatch(/HttpOnly/i);
  });

  it('sets cm_auth_device on a sign-in without the door fields too (v1 /login, a bare resend)', async () => {
    const res = await call({ email: 'a@b.com' });
    expect(valueOf(res, 'cm_auth_device')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookieNamed(res, 'cm_auth_signup')).toBeUndefined();
  });

  it('refuses a cross-site browser post, so another site cannot plant the door cookies', async () => {
    for (const headers of [
      { origin: 'https://evil.example' },
      { origin: 'null', 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'cross-site' },
    ] as Record<string, string>[]) {
      const res = await call({ email: 'a@b.com', site: 'acme.com' }, headers);
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('errors carry a code the forms read, beside the existing message', async () => {
    limit.allowed = false;
    const res = await call({ email: 'a@b.com' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: 'Too many sign-in requests. Try again later.',
      code: 'rate_limited',
    });
    limit.allowed = true;
    expect(await (await call({ email: 'nope' })).json()).toEqual({
      error: 'Invalid email',
      code: 'invalid_email',
    });
  });

  it('the sign-in email still goes to /login/verify, with the address as typed lowercased', async () => {
    await call({ email: 'Ada@Example.com', site: 'acme.com' });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      options: {
        shouldCreateUser: true,
        emailRedirectTo: expect.stringMatching(/\/login\/verify$/),
      },
    });
  });
});
