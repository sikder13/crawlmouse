import { describe, it, expect, vi, beforeEach } from 'vitest';

// R1 fold-in — the magic-link send remembers a validated same-origin return target in a short-lived
// `post_login_next` cookie so /login/verify can send an anon claimer back to their report. Off-origin
// values are dropped by the real safeNextPath (no open redirect). Deps are mocked; safeNextPath is real.
const signInWithOtp = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signInWithOtp } }) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => 'unknown' }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => true }));
vi.mock('@/lib/turnstile-gate', () => ({ turnstileGate: async () => 'ok' }));

import { POST } from './route';

const call = (body: unknown) =>
  POST(new Request('http://localhost/api/auth/magic-link', { method: 'POST', body: JSON.stringify(body) }));
const setCookie = (res: Response) => res.headers.get('set-cookie') ?? '';

describe('POST /api/auth/magic-link — post-login return cookie', () => {
  beforeEach(() => signInWithOtp.mockClear());

  it('sets post_login_next for a valid same-origin next, with security attributes', async () => {
    const res = await call({ email: 'a@b.com', next: '/r/abc' });
    expect(res.status).toBe(200);
    const cookie = setCookie(res);
    expect(decodeURIComponent(cookie)).toContain('post_login_next=/r/abc');
    // The attributes are load-bearing: HttpOnly (no JS theft), SameSite=Lax (sent on the email-link
    // navigation), and a bounded lifetime.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=600/i);
  });

  it('does NOT set the cookie for an off-origin / absolute next (no open redirect)', async () => {
    for (const evil of ['https://evil.com', '//evil.com', '/\\evil.com', '/.//evil.com']) {
      const res = await call({ email: 'a@b.com', next: evil });
      expect(res.status).toBe(200);
      expect(setCookie(res)).not.toContain('post_login_next');
    }
  });

  it('sets no cookie when next is absent (unchanged behavior)', async () => {
    const res = await call({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(setCookie(res)).not.toContain('post_login_next');
  });
});
