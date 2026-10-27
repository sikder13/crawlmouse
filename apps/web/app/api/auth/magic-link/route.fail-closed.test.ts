import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Turnstile on the sign-in route must fail CLOSED in production when the secret is missing, and stay
// permissive on preview/development. Unlike route.test.ts (which mocks the gate away to test the return
// cookie), this file runs the REAL turnstile-gate, turnstile-policy and verifyTurnstileToken; only I/O
// (Supabase, rate-limit RPC, fetch) is faked.
vi.mock('server-only', () => ({}));
const signInWithOtp = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { signInWithOtp } }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '1.2.3.4' }));

import { POST } from './route';

const KEYS = ['TURNSTILE_SECRET_KEY', 'VERCEL_ENV', 'NODE_ENV'] as const;
type Key = (typeof KEYS)[number];
let saved: Partial<Record<Key, string | undefined>>;
function setEnv(env: Partial<Record<Key, string>>) {
  const target = process.env as Record<string, string | undefined>;
  for (const k of KEYS) {
    if (env[k] === undefined) delete target[k];
    else target[k] = env[k];
  }
}

const fetchMock = vi.fn();
const call = (body: unknown) =>
  POST(
    new Request('http://localhost/api/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  signInWithOtp.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const target = process.env as Record<string, string | undefined>;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete target[k];
    else target[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/auth/magic-link — Turnstile with no secret configured', () => {
  it('production: a request WITH a token is rejected and no email is sent', async () => {
    setEnv({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
    const res = await call({ email: 'a@b.com', turnstileToken: 'tok' });
    expect(res.status).toBe(400);
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('production: a request WITHOUT a token is rejected and no email is sent', async () => {
    setEnv({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
    const res = await call({ email: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('preview (NODE_ENV=production): the permissive path stays — the email is sent', async () => {
    setEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'production' });
    const res = await call({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });
});
