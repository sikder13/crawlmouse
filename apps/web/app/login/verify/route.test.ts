import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sign-in landing (CC-25 D3, SECURITY J7): GET never verifies, POST does. Supabase, the anon
// session and the door are mocked (unavailable in a unit test); applyNoStore, the cookie handling,
// the origin check and the redirect rules are the real implementation.
const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
const getUser = vi.fn(async () => ({ data: { user: null } }));
const anonUpdate = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { verifyOtp, exchangeCodeForSession, getUser } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ update: (v: unknown) => ({ eq: () => ({ is: async () => anonUpdate(v) }) }) }),
  }),
}));
const anon = { id: null as string | null };
vi.mock('@/lib/anon-session', () => ({
  readAnonSessionId: async () => anon.id,
  clearAnonSession: async () => {},
}));
const afterSignIn = vi.fn();
vi.mock('@/lib/auth/landing', () => ({ afterSignIn: (...a: unknown[]) => afterSignIn(...a) }));
vi.mock('@/lib/auth/door-deps', () => ({ doorDeps: () => ({ firstLogin: {}, claim: {} }) }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

import { GET, POST } from './route';

const ORIGIN = 'https://crawlmouse.com';
const TOKEN = 'tok_7f3a9c0e5b2d4a18';
const USER = {
  id: 'u1',
  email: 'ada@example.com',
  email_confirmed_at: '2026-11-05T12:00:00Z',
  last_sign_in_at: '2026-11-05T12:00:00Z',
};

function cookieHeader(jar: Record<string, string>) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
}

function post(
  jar: Record<string, string>,
  headers: Record<string, string> = { origin: ORIGIN },
): Request {
  return new Request(`${ORIGIN}/login/verify`, {
    method: 'POST',
    headers: { cookie: cookieHeader(jar), ...headers },
  });
}

const otp = (value = TOKEN) => JSON.stringify({ kind: 'token_hash', value, type: 'magiclink' });

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
  exchangeCodeForSession.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
  getUser.mockClear();
  anonUpdate.mockReset().mockResolvedValue({ error: null });
  afterSignIn.mockReset().mockResolvedValue({ dest: null, events: [] });
  anon.id = null;
  delete process.env.V2_ACCOUNT_DOOR;
});

describe('GET /login/verify renders, never verifies', () => {
  it('moves the token into a one-shot cookie and sends the browser to a page whose URL has no token', async () => {
    const res = await GET(new Request(`${ORIGIN}/login/verify?token_hash=${TOKEN}&type=magiclink`));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login/verify/continue`);
    const carried = setCookies(res).find((c) => c.startsWith('cm_auth_otp='))!;
    expect(carried).toMatch(/HttpOnly/i);
    expect(carried).toMatch(/Path=\/login\/verify(;|$)/);
    expect(carried).toMatch(/Max-Age=900/);
    expect(carried).toMatch(/SameSite=lax/i);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
  });

  it('marks the cookie Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const res = await GET(new Request(`${ORIGIN}/login/verify?token_hash=${TOKEN}`));
      expect(setCookies(res).find((c) => c.startsWith('cm_auth_otp='))).toMatch(/Secure/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('carries a PKCE code the same way, and still never exchanges it on GET', async () => {
    const res = await GET(new Request(`${ORIGIN}/login/verify?code=pkce_123`));
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login/verify/continue`);
  });

  it('a link with no token goes to the sign-in page, as before', async () => {
    const res = await GET(new Request(`${ORIGIN}/login/verify`));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=missing_token`);
  });
});

describe('POST /login/verify verifies', () => {
  it('refuses a cross-site post before anything else (login CSRF)', async () => {
    const crossSite: Record<string, string>[] = [
      { origin: 'https://evil.example' },
      {},
      { origin: 'null', 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of crossSite) {
      const res = await POST(post({ cm_auth_otp: otp() }, headers));
      expect(res.status).toBe(403);
    }
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('accepts a no-JS form post that sends Origin: null with Sec-Fetch-Site: same-origin', async () => {
    const res = await POST(
      post({ cm_auth_otp: otp() }, { origin: 'null', 'sec-fetch-site': 'same-origin' }),
    );
    expect(res.status).toBe(303);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: TOKEN, type: 'magiclink' });
  });

  it('signs in, consumes the token cookie, and lands on /dashboard with no-store', async () => {
    const res = await POST(post({ cm_auth_otp: otp() }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(setCookies(res).find((c) => c.startsWith('cm_auth_otp='))).toMatch(/Max-Age=0/);
  });

  it('exchanges a carried PKCE code', async () => {
    await POST(post({ cm_auth_otp: JSON.stringify({ kind: 'code', value: 'pkce_123' }) }));
    expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce_123');
  });

  it('a used or expired token lands on the expired state, clears the cookie, and runs nothing after', async () => {
    process.env.V2_ACCOUNT_DOOR = '1';
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { status: 403, code: 'otp_expired' },
    });
    anon.id = 'anon-1';
    const res = await POST(post({ cm_auth_otp: otp() }));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login/verify/continue?state=expired`);
    expect(setCookies(res).find((c) => c.startsWith('cm_auth_otp='))).toMatch(/Max-Age=0/);
    expect(setCookies(res).some((c) => c.startsWith('sb-'))).toBe(false);
    expect(anonUpdate).not.toHaveBeenCalled();
    expect(afterSignIn).not.toHaveBeenCalled();
  });

  it('no carried token (cookie expired, or a second click) is the expired state without a verify call', async () => {
    const res = await POST(post({}));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login/verify/continue?state=expired`);
  });

  it('returns the user to a validated same-origin `next` and clears it (R1 fold-in, moved from GET)', async () => {
    const res = await POST(post({ cm_auth_otp: otp(), post_login_next: '/r/abc' }));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/r/abc`);
    expect(setCookies(res).find((c) => c.startsWith('post_login_next='))).toMatch(/Max-Age=0/);
  });

  it('IGNORES an off-origin `next` cookie (no open redirect) → /dashboard', async () => {
    for (const evil of ['https://evil.com', '//evil.com', '/\\evil.com', '/.//evil.com']) {
      const res = await POST(post({ cm_auth_otp: otp(), post_login_next: evil }));
      expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
    }
  });

  it('still claims the anonymous v1 audits of this browser', async () => {
    anon.id = 'anon-1';
    await POST(post({ cm_auth_otp: otp() }));
    expect(anonUpdate).toHaveBeenCalledWith({ user_id: 'u1' });
  });

  it('with the door off, the v2 hook never runs, and a claim-shaped `next` lands on /dashboard', async () => {
    const res = await POST(
      post({
        cm_auth_otp: otp(),
        post_login_next: '/api/checks/0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11/claim?then=/dashboard',
      }),
    );
    expect(afterSignIn).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
  });

  it('with the door on, runs the hook with the verified user and the carried cookies', async () => {
    process.env.V2_ACCOUNT_DOOR = '1';
    afterSignIn.mockResolvedValue({ dest: '/dashboard?claim=site_limit', events: [] });
    const res = await POST(
      new Request(`${ORIGIN}/login/verify`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          'x-forwarded-for': '203.0.113.9',
          cookie: cookieHeader({
            cm_auth_otp: otp(),
            cm_auth_signup: JSON.stringify({ site: 'acme.com', tz: 'Europe/Kyiv' }),
            cm_auth_for: 'binding-hash',
            cm_auth_device: 'dev-1',
          }),
        },
      }),
    );
    expect(afterSignIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        user: USER,
        signup: { site: 'acme.com', tz: 'Europe/Kyiv' },
        boundTo: 'binding-hash',
        device: 'dev-1',
        ip: '203.0.113.9',
      }),
    );
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard?claim=site_limit`);
    expect(setCookies(res).find((c) => c.startsWith('cm_auth_signup='))).toMatch(/Max-Age=0/);
    expect(setCookies(res).find((c) => c.startsWith('cm_auth_for='))).toMatch(/Max-Age=0/);
  });

  it('a hook that throws does not fail the sign-in', async () => {
    process.env.V2_ACCOUNT_DOOR = '1';
    afterSignIn.mockRejectedValue(new Error('db down'));
    const res = await POST(post({ cm_auth_otp: otp() }));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
  });

  it('answers JSON with the events for the Continue page, and the token appears in no response', async () => {
    process.env.V2_ACCOUNT_DOOR = '1';
    afterSignIn.mockResolvedValue({
      dest: null,
      events: [{ name: 'trial_started', props: { kind: 'pro', variant: 'no_card' } }],
    });
    const res = await POST(
      post({ cm_auth_otp: otp() }, { origin: ORIGIN, accept: 'application/json' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      next: '/dashboard',
      events: [{ name: 'trial_started', props: { kind: 'pro', variant: 'no_card' } }],
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('answers JSON on the expired state too, so the page can show it', async () => {
    const res = await POST(post({}, { origin: ORIGIN, accept: 'application/json' }));
    expect(await res.json()).toEqual({ next: '/login/verify/continue?state=expired', events: [] });
  });
});
