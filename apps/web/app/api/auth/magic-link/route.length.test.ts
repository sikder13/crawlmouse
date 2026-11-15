import { beforeEach, describe, expect, it, vi } from 'vitest';

// CC-37 A-4: an address longer than 254 characters (RFC 5321's path limit) is refused with the
// route's 400 before any rate-limit bucket, Turnstile check or Supabase call. Every dependency that
// spends something is a spy, so the test sees what the refusal reached.
const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  turnstileGate: vi.fn(async () => 'ok' as const),
  signInWithOtp: vi.fn(async () => ({ error: null })),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { signInWithOtp: h.signInWithOtp } }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.checkRateLimit }));
// A real client address, so the per-IP bucket would be spent too if the request reached it.
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '198.51.100.7' }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => true }));
vi.mock('@/lib/turnstile-gate', () => ({ turnstileGate: h.turnstileGate }));

import { POST } from './route';

const call = (email: string) =>
  POST(
    new Request('http://localhost/api/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  );

/** A syntactically valid address of exactly `n` characters: a 64-character local part, labels of at most 63. */
function addressOfLength(n: number): string {
  const local = 'a'.repeat(64);
  const tld = '.com';
  let rest = n - local.length - 1 - tld.length;
  const labels: string[] = [];
  while (rest > 0) {
    // Each label after the first costs its dot as well.
    const room = labels.length === 0 ? rest : rest - 1;
    const len = Math.min(63, room);
    labels.push('b'.repeat(len));
    rest -= labels.length === 1 ? len : len + 1;
  }
  const address = `${local}@${labels.join('.')}${tld}`;
  if (address.length !== n) throw new Error(`built ${address.length}, wanted ${n}`);
  return address;
}

describe('POST /api/auth/magic-link — address length (A-4)', () => {
  beforeEach(() => {
    h.checkRateLimit.mockClear();
    h.turnstileGate.mockClear();
    h.signInWithOtp.mockClear();
  });

  it('a 255-character address is a 400 invalid_email and spends no bucket, Turnstile check or send', async () => {
    const res = await call(addressOfLength(255));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid email', code: 'invalid_email' });
    expect(h.checkRateLimit).not.toHaveBeenCalled();
    expect(h.turnstileGate).not.toHaveBeenCalled();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });

  it('a 254-character valid address proceeds to the buckets and the send', async () => {
    const email = addressOfLength(254);
    const res = await call(email);
    expect(res.status).toBe(200);
    expect(h.checkRateLimit).toHaveBeenCalledWith(
      `magic:email:${email}`,
      expect.any(Number),
      expect.any(Number),
    );
    expect(h.signInWithOtp).toHaveBeenCalledTimes(1);
  });
});
