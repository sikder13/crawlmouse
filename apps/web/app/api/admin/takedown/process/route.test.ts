import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The route's collaborators are stubbed so the test exercises ONLY auth + validation + rate
// limiting + status mapping (the route's own logic), never a real DB or the live purge path.
const { processTakedown, checkRateLimit } = vi.hoisted(() => ({
  processTakedown: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/takedown', () => ({ processTakedown }));
const SB = {};
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => SB }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }));
// @/ alias is not resolved in this test context — stub these pure modules so the route loads.
// getClientIp's real header parse is unit-tested in lib/client-ip; here a faithful minimal
// version is enough to drive the throttle (returns the x-forwarded-for IP or 'unknown').
vi.mock('@/lib/client-ip', () => ({
  getClientIp: (req: Request) =>
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown',
}));
vi.mock('@/lib/limits', () => ({ ADMIN_TAKEDOWN_PER_IP_PER_HOUR: 30 }));

import { POST } from './route';

const SECRET = 'a-long-random-admin-secret-value';

function req(opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  return new Request('http://localhost/api/admin/takedown/process', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { slug: 'abc123' }),
  });
}

describe('POST /api/admin/takedown/process', () => {
  beforeEach(() => {
    processTakedown.mockReset();
    processTakedown.mockResolvedValue(undefined);
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: new Date() });
  });
  afterEach(() => {
    delete process.env.ADMIN_SECRET;
  });

  it('is closed by default — 401 when ADMIN_SECRET is unset, even with a Bearer token', async () => {
    delete process.env.ADMIN_SECRET;
    const res = await POST(req({ token: 'anything' }));
    expect(res.status).toBe(401);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('401 on a wrong token of the SAME length (timing-safe compare rejects it)', async () => {
    process.env.ADMIN_SECRET = SECRET;
    const wrongSameLen = 'X'.repeat(SECRET.length);
    const res = await POST(req({ token: wrongSameLen }));
    expect(res.status).toBe(401);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('401 on a SHORTER token without throwing (the length guard must run before timingSafeEqual)', async () => {
    process.env.ADMIN_SECRET = SECRET;
    // timingSafeEqual throws on unequal-length buffers; the `a.length === b.length &&`
    // short-circuit is load-bearing. A reorder regression would throw here and surface as a
    // rejected promise / 500 — this asserts a clean 401 instead.
    const res = await POST(req({ token: 'short' }));
    expect(res.status).toBe(401);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('401 on a LONGER token without throwing (length guard, other direction)', async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await POST(req({ token: SECRET + 'extra' }));
    expect(res.status).toBe(401);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('401 when the Authorization header has no Bearer prefix', async () => {
    process.env.ADMIN_SECRET = SECRET;
    const r = new Request('http://localhost/api/admin/takedown/process', {
      method: 'POST',
      headers: { authorization: SECRET }, // raw, no "Bearer " prefix
      body: JSON.stringify({ slug: 'abc123' }),
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('200 + { ok: true } and calls processTakedown once with the slug on a correct token', async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await POST(req({ token: SECRET, body: { slug: 'good-slug' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(processTakedown).toHaveBeenCalledTimes(1);
    expect(processTakedown).toHaveBeenCalledWith(SB, 'good-slug');
  });

  it('400 on an empty slug (below the zod min) — authorized but invalid', async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await POST(req({ token: SECRET, body: { slug: '' } }));
    expect(res.status).toBe(400);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('400 on an oversized slug (above the zod max of 64)', async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await POST(req({ token: SECRET, body: { slug: 'x'.repeat(65) } }));
    expect(res.status).toBe(400);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('400 on a non-string / missing slug', async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await POST(req({ token: SECRET, body: {} }));
    expect(res.status).toBe(400);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('500 when processTakedown throws (failure is contained, not leaked)', async () => {
    process.env.ADMIN_SECRET = SECRET;
    processTakedown.mockRejectedValue(new Error('db down'));
    const res = await POST(req({ token: SECRET, body: { slug: 'abc123' } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'could not process' });
  });

  it('429 when the per-IP throttle is exceeded — and does NOT action the takedown', async () => {
    process.env.ADMIN_SECRET = SECRET;
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });
    const r = new Request('http://localhost/api/admin/takedown/process', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ slug: 'abc123' }),
    });
    const res = await POST(r);
    expect(res.status).toBe(429);
    expect(processTakedown).not.toHaveBeenCalled();
  });

  it('does NOT consult the rate limiter for an unauthorized request (auth fails first)', async () => {
    delete process.env.ADMIN_SECRET;
    await POST(req({ token: 'anything' }));
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
