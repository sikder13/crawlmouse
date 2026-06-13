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

import { GET } from './route';

describe('GET /login/verify', () => {
  beforeEach(() => {
    verifyOtp.mockClear();
    getUser.mockClear();
  });

  it('marks the session-minting redirect no-store so a CDN cannot cache the auth cookie', async () => {
    const res = await GET(new Request('https://crawlmouse.com/login/verify?token_hash=abc&type=magiclink'));
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});
