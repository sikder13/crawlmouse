import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sign-in callback mints the session (Set-Cookie auth token) and redirects. Prove that redirect
// is marked no-store so no shared/CDN cache can retain the token — middleware can't backstop this
// path (no inbound auth cookie yet). Supabase/anon-session deps are mocked (unavailable in a unit
// test); applyNoStore (the behavior under test) is the real implementation.
const verifyOtp = vi.fn(async () => ({ error: null }));
const getUser = vi.fn(async () => ({ data: { user: null } }));

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { verifyOtp, exchangeCodeForSession: vi.fn(async () => ({ error: null })), getUser },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }) }),
}));
vi.mock('@/lib/anon-session', () => ({
  readAnonSessionId: async () => null,
  clearAnonSession: async () => {},
}));

// The post-login return target (R1 fold-in) rides a short-lived `post_login_next` cookie set at
// magic-link-send. `cookieState` is a const object (mutated per test) so the hoisted vi.mock factory
// captures it — the same pattern the supabase mock above uses.
const cookieState: { next?: string } = {};
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (n === 'post_login_next' && cookieState.next ? { value: cookieState.next } : undefined),
  }),
}));

import { GET } from './route';

describe('GET /login/verify', () => {
  beforeEach(() => {
    verifyOtp.mockClear();
    getUser.mockClear();
    cookieState.next = undefined;
  });

  it('marks the session-minting redirect no-store so a CDN cannot cache the auth cookie', async () => {
    const res = await GET(new Request('https://crawlmouse.com/login/verify?token_hash=abc&type=magiclink'));
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('returns the user to a validated same-origin `next` after sign-in, and clears the cookie (R1 fold-in)', async () => {
    cookieState.next = '/r/abc';
    const res = await GET(new Request('https://crawlmouse.com/login/verify?token_hash=abc&type=magiclink'));
    expect(res.headers.get('location')).toContain('/r/abc');
    expect(res.headers.get('location')).not.toContain('/dashboard');
    expect(res.headers.get('set-cookie') ?? '').toContain('post_login_next='); // cleared
  });

  it('IGNORES an off-origin / absolute `next` cookie (no open redirect) → /dashboard', async () => {
    for (const evil of ['https://evil.com', '//evil.com', '/\\evil.com', '/.//evil.com']) {
      cookieState.next = evil;
      const res = await GET(new Request('https://crawlmouse.com/login/verify?token_hash=abc&type=magiclink'));
      expect(res.headers.get('location')).toContain('/dashboard');
      expect(res.headers.get('location')).not.toContain('evil.com');
    }
  });
});
