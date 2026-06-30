import { describe, it, expect, vi, beforeEach } from 'vitest';

// Logout must genuinely invalidate the session SERVER-SIDE — the cookies that carry it MUST be
// expired on the response, and that must hold even when the Auth revoke fails (the shared/public-device
// guarantee). So we drive a fake cookie store and assert the sb-*-auth-token cookies are actually
// deleted on the happy path AND when signOut() returns an error AND when it throws. (A mock that only
// checks "signOut was called + 303" — like the first version of this test — cannot catch the real bug
// where auth-js returns before clearing cookies.)
const signOut = vi.fn(async (_opts?: unknown): Promise<{ error: unknown }> => ({ error: null }));

const deleted: string[] = [];
const cookieStore = {
  getAll: () => [
    { name: 'sb-proj-auth-token', value: 'a' },
    { name: 'sb-proj-auth-token.1', value: 'b' },
    { name: 'sb-proj-other', value: 'd' }, // sb-prefixed but NOT an auth token → must be kept
    { name: 'other-cookie', value: 'c' },
  ],
  delete: (name: string) => {
    deleted.push(name);
  },
  set: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signOut } }) }));
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));

import { POST } from './route';

const req = () => new Request('https://crawlmouse.com/api/auth/logout', { method: 'POST' });

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    signOut.mockClear();
    deleted.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('redirects home as a GET (303) and never caches the cookie-clearing response', async () => {
    const res = await POST(req());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://crawlmouse.com/');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('best-effort revokes the session server-side, scoped to this device (not all devices)', async () => {
    await POST(req());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('expires every sb-*-auth-token cookie (the real session invalidation) and leaves others alone', async () => {
    await POST(req());
    expect(deleted).toEqual(['sb-proj-auth-token', 'sb-proj-auth-token.1']);
    // Pins BOTH halves of the predicate: a non-auth sb-* cookie AND an unrelated cookie are kept.
    expect(deleted).not.toContain('sb-proj-other');
    expect(deleted).not.toContain('other-cookie');
  });

  it('STILL clears the cookies when the Auth revoke RETURNS an error (the shared-device guarantee)', async () => {
    signOut.mockResolvedValueOnce({ error: { message: 'network', status: 500 } });
    const res = await POST(req());
    expect(deleted).toEqual(['sb-proj-auth-token', 'sb-proj-auth-token.1']);
    expect(res.status).toBe(303);
  });

  it('STILL clears the cookies when the Auth revoke THROWS (cookies cleared regardless)', async () => {
    signOut.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(req());
    expect(deleted).toEqual(['sb-proj-auth-token', 'sb-proj-auth-token.1']);
    expect(res.status).toBe(303);
  });
});
