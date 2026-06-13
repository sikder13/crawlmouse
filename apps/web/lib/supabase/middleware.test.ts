import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { updateSession } from './middleware';

// Mirrors the real cookie name @supabase/ssr writes (sb-<project-ref>-auth-token[.n]).
const AUTH_COOKIE = 'sb-ezspnfeyzwsisymytssm-auth-token';

/** A request carrying a Supabase auth cookie — i.e. a logged-in visitor. */
function loggedInRequest(url = 'https://crawlmouse.com/dashboard') {
  const req = new NextRequest(new Request(url));
  req.cookies.set(AUTH_COOKIE, 'stale-token');
  return req;
}

describe('updateSession', () => {
  it('persists rotated auth cookies and the no-store headers onto the returned response', async () => {
    const res = await updateSession(loggedInRequest(), (cookies) => ({
      auth: {
        getUser: async () => {
          // Simulate a token refresh: @supabase/ssr writes the rotated cookies + the
          // cache-control headers that must accompany an auth-cookie response.
          cookies.setAll!(
            [{ name: AUTH_COOKIE, value: 'fresh-token', options: { path: '/' } }],
            { 'cache-control': 'private, no-store' },
          );
          return { data: { user: { id: 'u1' } } };
        },
      },
    }));
    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe('fresh-token');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('calls auth.getUser() when an auth cookie is present (DO NOT REMOVE the refresh)', async () => {
    const getUser = vi.fn(async () => ({ data: { user: null } }));
    await updateSession(loggedInRequest(), () => ({ auth: { getUser } }));
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('skips the Auth round-trip for anonymous requests (no auth cookie) — cost discipline', async () => {
    const getUser = vi.fn(async () => ({ data: { user: null } }));
    const req = new NextRequest(new Request('https://crawlmouse.com/'));
    const res = await updateSession(req, () => ({ auth: { getUser } }));
    expect(getUser).not.toHaveBeenCalled();
    expect(res).toBeDefined();
  });

  it('serves the page instead of throwing when the Auth call fails (a Supabase blip must not 500 every logged-in route)', async () => {
    const res = await updateSession(loggedInRequest(), () => ({
      auth: {
        getUser: async () => {
          throw new Error('fetch failed: Auth server unreachable');
        },
      },
    }));
    expect(res).toBeDefined();
  });

  it('is bounded by a timeout so a hung Auth endpoint cannot stall the response', async () => {
    // Real (tiny) timeout via the injectable param — no fake timers — so the test is deterministic
    // and immune to worker-scheduling contention under a busy parallel runner.
    const res = await updateSession(
      loggedInRequest(),
      () => ({ auth: { getUser: () => new Promise(() => {}) } }), // never resolves
      5, // 5ms auth-refresh timeout
    );
    expect(res).toBeDefined();
  });

  it('refreshes when the auth cookie is chunked (sb-<ref>-auth-token.0)', async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } } }));
    const req = new NextRequest(new Request('https://crawlmouse.com/dashboard'));
    req.cookies.set(`${AUTH_COOKIE}.0`, 'chunk0');
    await updateSession(req, () => ({ auth: { getUser } }));
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
