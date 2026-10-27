import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The /developers waitlist must fail CLOSED on Turnstile in production when the secret is missing, and
// stay permissive on preview/development. The real turnstile-policy and verifyTurnstileToken run; only
// I/O (Supabase insert, rate-limit RPC, fetch) is faked.
vi.mock('server-only', () => ({}));
const insertMock = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: insertMock }) }),
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
    new Request('http://localhost/api/developers', { method: 'POST', body: JSON.stringify(body) }),
  );

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  insertMock.mockClear();
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

describe('POST /api/developers — Turnstile with no secret configured', () => {
  it('production: a request WITH a token is rejected and nothing is inserted', async () => {
    setEnv({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
    const res = await call({ email: 'dev@example.com', turnstileToken: 'tok' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('captcha_failed');
    expect(insertMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('production: a request WITHOUT a token is rejected and nothing is inserted', async () => {
    setEnv({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
    const res = await call({ email: 'dev@example.com' });
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('preview (NODE_ENV=production): the permissive path stays — the signup is inserted', async () => {
    setEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'production' });
    const res = await call({ email: 'dev@example.com' });
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
