import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `server-only` is a Next-bundled marker with no resolvable entry outside the Next build; stub it.
vi.mock('server-only', () => ({}));

import { verifyTurnstileToken } from './turnstile';

// The three env vars the rule reads. Each test sets exactly the ones it means; the rest are DELETED
// (not set to ''), because "unset" is the case under test and an empty string is a different value.
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
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const target = process.env as Record<string, string | undefined>;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete target[k];
    else target[k] = saved[k];
  }
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

describe('verifyTurnstileToken — a missing secret', () => {
  it('rejects and logs when the secret is missing in production', async () => {
    setEnv({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
    await expect(verifyTurnstileToken('tok', '1.2.3.4')).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/TURNSTILE_SECRET_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects off-Vercel when NODE_ENV=production and VERCEL_ENV is unset', async () => {
    setEnv({ NODE_ENV: 'production' });
    await expect(verifyTurnstileToken('tok')).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows when the secret is missing in development (local permissive path)', async () => {
    setEnv({ NODE_ENV: 'development' });
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows on a Vercel preview with NODE_ENV=production and no secret', async () => {
    setEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'production' });
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('verifyTurnstileToken — a configured secret', () => {
  it('verifies the token with Cloudflare and returns its verdict', async () => {
    setEnv({
      TURNSTILE_SECRET_KEY: 'test-secret-value',
      VERCEL_ENV: 'production',
      NODE_ENV: 'production',
    });
    fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true }) });
    await expect(verifyTurnstileToken('good-token', '1.2.3.4')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('secret')).toBe('test-secret-value');
    expect(body.get('response')).toBe('good-token');
    expect(body.get('remoteip')).toBe('1.2.3.4');

    fetchMock.mockResolvedValueOnce({ json: async () => ({ success: false }) });
    await expect(verifyTurnstileToken('bad-token')).resolves.toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
