import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sign-in landing (CC-25 D3, SECURITY J7): GET never verifies, POST does. Supabase, the anon
// session and the door are mocked (unavailable in a unit test); applyNoStore, the cookie handling,
// the origin check and the redirect rules are the real implementation.
const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
const getUser = vi.fn(async () => ({ data: { user: null } }));
// The anon claim's query, as the route builds it: the table, the update, and each filter in order.
const anonUpdate = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { verifyOtp, exchangeCodeForSession, getUser } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      update: (v: unknown) => ({
        eq: (eqCol: string, eqVal: unknown) => ({
          is: async (isCol: string, isVal: unknown) =>
            anonUpdate({ table, update: v, eq: [eqCol, eqVal], is: [isCol, isVal] }),
        }),
      }),
    }),
  }),
}));
const anon = { id: null as string | null, throws: false };
const clearAnonSession = vi.fn(async () => {});
vi.mock('@/lib/anon-session', () => ({
  readAnonSessionId: async () => {
    if (anon.throws) throw new Error('cookie store unavailable');
    return anon.id;
  },
  clearAnonSession: () => clearAnonSession(),
}));
const afterSignIn = vi.fn();
vi.mock('@/lib/auth/landing', () => ({ afterSignIn: (...a: unknown[]) => afterSignIn(...a) }));
vi.mock('@/lib/auth/door-deps', () => ({ doorDeps: () => ({ firstLogin: {}, claim: {} }) }));
const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureMessage }));

import { GET, POST } from './route';
import { emailBinding } from '@/lib/auth/continue-intent';

const ORIGIN = 'https://crawlmouse.com';
const CANARY = 'link-canary-one';
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

// The binding this browser holds when it asked for the link it is now opening (A-8).
const OWN = emailBinding(USER.email);

const otp = (value = CANARY) => JSON.stringify({ kind: 'token_hash', value, type: 'magiclink' });

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
  anon.throws = false;
  clearAnonSession.mockClear();
  captureMessage.mockClear();
  delete process.env.V2_ACCOUNT_DOOR;
});

describe('GET /login/verify renders, never verifies', () => {
  it('moves the token into a one-shot cookie and sends the browser to a page whose URL has no token', async () => {
    const res = await GET(
      new Request(`${ORIGIN}/login/verify?token_hash=${CANARY}&type=magiclink`),
    );
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
      const res = await GET(new Request(`${ORIGIN}/login/verify?token_hash=${CANARY}`));
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
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: CANARY, type: 'magiclink' });
  });

  it('signs in, consumes the token cookie, and lands on /dashboard with no-store', async () => {
    const res = await POST(post({ cm_auth_otp: otp() }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(setCookies(res).find((c) => c.startsWith('cm_auth_otp='))).toMatch(/Max-Age=0/);
  });

  it('a new account’s link keeps its type through the cookie: GET then POST verifies as signup', async () => {
    // The Confirm-signup template links with type=signup (scripts/supabase/auth-config.ts); a carry
    // that dropped or defaulted the type would verify a signup token as magiclink.
    const got = await GET(new Request(`${ORIGIN}/login/verify?token_hash=${CANARY}&type=signup`));
    const carried = setCookies(got).find((c) => c.startsWith('cm_auth_otp='))!;
    const pair = carried.split(';')[0]!;
    const res = await POST(
      new Request(`${ORIGIN}/login/verify`, {
        method: 'POST',
        headers: { cookie: pair, origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(303);
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: CANARY, type: 'signup' });
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

  it('claims the anonymous v1 audits of a browser that asked for this address (A-8)', async () => {
    anon.id = 'anon-1';
    await POST(post({ cm_auth_otp: otp(), cm_auth_for: OWN }));
    expect(anonUpdate).toHaveBeenCalledTimes(1);
    expect(anonUpdate.mock.calls[0]![0]).toMatchObject({
      table: 'audits',
      update: { user_id: 'u1' },
      eq: ['anonymous_session_id', 'anon-1'],
    });
  });

  it('claims only audits no account owns yet: the update is filtered on user_id is null', async () => {
    anon.id = 'anon-1';
    await POST(post({ cm_auth_otp: otp(), cm_auth_for: OWN }));
    expect(anonUpdate.mock.calls[0]![0].is).toEqual(['user_id', null]);
  });

  it('skips the v1 claim when the link signs in an address other than the one this browser asked for (D9)', async () => {
    anon.id = 'anon-1';
    await POST(post({ cm_auth_otp: otp(), cm_auth_for: emailBinding('someone-else@example.com') }));
    expect(anonUpdate).not.toHaveBeenCalled();
    expect(clearAnonSession).not.toHaveBeenCalled();
  });

  it("keeps this browser's own door request (binding, named site, return target) after someone else's link", async () => {
    const jar = {
      cm_auth_otp: otp(),
      cm_auth_for: emailBinding('someone-else@example.com'),
      cm_auth_signup: JSON.stringify({ site: 'mine.example' }),
      post_login_next: '/r/abc',
    };
    const kept = setCookies(await POST(post(jar)));
    for (const name of ['cm_auth_for', 'cm_auth_signup', 'post_login_next'])
      expect(
        kept.find((c) => c.startsWith(`${name}=`)),
        name,
      ).toBeUndefined();
    const own = setCookies(await POST(post({ ...jar, cm_auth_for: emailBinding(USER.email) })));
    for (const name of ['cm_auth_for', 'cm_auth_signup', 'post_login_next'])
      expect(
        own.find((c) => c.startsWith(`${name}=`)),
        name,
      ).toMatch(/Max-Age=0/);
  });

  it('A-8: with no cm_auth_for the browser asked for no link, so nothing is claimed', async () => {
    anon.id = 'anon-1';
    const res = await POST(post({ cm_auth_otp: otp() }));
    expect(anonUpdate).not.toHaveBeenCalled();
    expect(clearAnonSession).not.toHaveBeenCalled();
    // The sign-in itself still happens.
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
  });

  it('A-8: a matching cm_auth_for claims, and is cleared after the claim', async () => {
    anon.id = 'anon-1';
    const res = await POST(post({ cm_auth_otp: otp(), cm_auth_for: OWN }));
    expect(anonUpdate).toHaveBeenCalledTimes(1);
    expect(setCookies(res).find((c) => c.startsWith('cm_auth_for='))).toMatch(/Max-Age=0/);
  });

  it('A-8: a cm_auth_for that is not a binding of the verified address claims nothing', async () => {
    anon.id = 'anon-1';
    for (const bound of ['', 'not-a-hash', emailBinding('ADA@example.com ').toUpperCase()]) {
      await POST(post({ cm_auth_otp: otp(), cm_auth_for: bound }));
    }
    expect(anonUpdate).not.toHaveBeenCalled();
  });

  it('ends the anonymous session after claiming it, and not before a sign-in', async () => {
    anon.id = 'anon-1';
    await POST(post({ cm_auth_otp: otp(), cm_auth_for: OWN }));
    expect(clearAnonSession).toHaveBeenCalledTimes(1);
    clearAnonSession.mockClear();
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { status: 403, code: 'otp_expired' },
    });
    await POST(post({ cm_auth_otp: otp() }));
    expect(clearAnonSession).not.toHaveBeenCalled();
  });

  it('a throw clears the token cookie and lands on the expired state, never a bare 500', async () => {
    const throwers: Array<[string, () => void]> = [
      ['verify', () => verifyOtp.mockRejectedValue(new Error('network'))],
      ['anon-claim', () => (anon.throws = true)],
      ['anon-claim', () => anonUpdate.mockRejectedValue(new Error('db'))],
    ];
    for (const [stage, arm] of throwers) {
      verifyOtp.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
      anonUpdate.mockReset().mockResolvedValue({ error: null });
      anon.throws = false;
      anon.id = 'anon-1';
      captureMessage.mockClear();
      arm();
      for (const accept of [undefined, 'application/json']) {
        const res = await POST(
          post(
            { cm_auth_otp: otp(), cm_auth_for: OWN },
            accept ? { origin: ORIGIN, accept } : { origin: ORIGIN },
          ),
        );
        expect(res.status, `${stage}, ${accept ?? 'form'}`).toBe(accept ? 200 : 303);
        const dest = accept
          ? (await res.json()).next
          : new URL(res.headers.get('location')!).pathname +
            new URL(res.headers.get('location')!).search;
        expect(dest).toBe('/login/verify/continue?state=expired');
        expect(setCookies(res).find((c) => c.startsWith('cm_auth_otp='))).toMatch(/Max-Age=0/);
      }
      const reported = captureMessage.mock.calls.filter((c) => c[0] === 'auth.verify-threw');
      expect(reported.map((c) => (c[1] as { extra: { stage: string } }).extra.stage)).toEqual([
        stage,
        stage,
      ]);
      expect(JSON.stringify(reported)).not.toContain(CANARY);
    }
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
            cm_auth_for: emailBinding(USER.email),
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
        boundTo: emailBinding(USER.email),
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
      email: USER.email,
    });
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('answers JSON on the expired state too, so the page can show it', async () => {
    const res = await POST(post({}, { origin: ORIGIN, accept: 'application/json' }));
    expect(await res.json()).toEqual({ next: '/login/verify/continue?state=expired', events: [] });
  });

  // Q3(b): the Continue page names the account the link signed in, so a person handed someone
  // else's link sees it before working inside that account.
  it.each([
    ['off', undefined],
    ['on', '1'],
  ])('with the door %s, names the signed-in address in the JSON answer only', async (_, flag) => {
    if (flag) process.env.V2_ACCOUNT_DOOR = flag;
    else delete process.env.V2_ACCOUNT_DOOR;
    const json = await POST(
      post({ cm_auth_otp: otp() }, { origin: ORIGIN, accept: 'application/json' }),
    );
    expect(await json.json()).toMatchObject({ next: '/dashboard', email: USER.email });
    // The no-script post is a redirect: the address is in no header and no body.
    const plain = await POST(post({ cm_auth_otp: otp() }));
    expect(plain.status).toBe(303);
    expect(plain.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
    for (const [name, value] of plain.headers)
      expect(`${name}: ${value}`).not.toContain(USER.email);
    expect(await plain.text()).not.toContain(USER.email);
  });

  it('names no address when the link is refused or the landing throws', async () => {
    verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { status: 403 } });
    const refused = await POST(
      post({ cm_auth_otp: otp() }, { origin: ORIGIN, accept: 'application/json' }),
    );
    expect(await refused.json()).not.toHaveProperty('email');
    anon.throws = true;
    const threw = await POST(
      post(
        { cm_auth_otp: otp(), cm_auth_for: OWN },
        { origin: ORIGIN, accept: 'application/json' },
      ),
    );
    expect(await threw.json()).toEqual({
      next: '/login/verify/continue?state=expired',
      events: [],
    });
  });
});
