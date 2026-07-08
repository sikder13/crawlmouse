import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC 04 §3/§9 (V5 hide half) — self-service hide for the minter, CAPABILITY-scoped: possession of
// the audit UUID authorizes hiding the report minted from it (symmetric with mint). Sets hidden_at
// (→ the report 404s) and purges the cached render. Deploy-order-safe: if hidden_at doesn't exist yet
// (pre-Runbook-B) → 503.

let updatedSlug: { slug: string } | null = { slug: 'slug-1' };
let updateError: { code?: string } | null = null;
let rlAllowed = true;
const purgeMock = vi.fn();
const updateMock = vi.fn();

vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '9.9.9.9' }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => Promise.resolve({ allowed: rlAllowed, remaining: 0, resetAt: new Date() }) }));
vi.mock('@/lib/reports', () => ({ purgePublicReport: (s: string) => purgeMock(s) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        updateMock(payload);
        return { eq: () => ({ is: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: updatedSlug, error: updateError }) }) }) }) };
      },
    }),
  }),
}));

import { POST } from './route';

const AUD = '123e4567-e89b-12d3-a456-426614174000';
const req = (body: unknown) => new Request('http://localhost/api/reports/hide', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => { updatedSlug = { slug: 'slug-1' }; updateError = null; rlAllowed = true; purgeMock.mockClear(); updateMock.mockClear(); });

describe('POST /api/reports/hide', () => {
  it('hides the report for the given audit capability, sets hidden_at, and purges its cache', async () => {
    const res = await POST(req({ auditId: AUD }));
    expect(res.status).toBe(200);
    expect((updateMock.mock.calls[0]![0] as Record<string, unknown>)).toHaveProperty('hidden_at');
    expect(purgeMock).toHaveBeenCalledWith('slug-1');
  });

  it('404 when no (visible) report exists for that audit', async () => {
    updatedSlug = null;
    const res = await POST(req({ auditId: AUD }));
    expect(res.status).toBe(404);
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it('429 when the per-IP hide cap is exhausted (no write)', async () => {
    rlAllowed = false;
    const res = await POST(req({ auditId: AUD }));
    expect(res.status).toBe(429);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('deploy-order: 42703 (pre-Runbook-B, no hidden_at column) → 503 fail-soft', async () => {
    updateError = { code: '42703' };
    const res = await POST(req({ auditId: AUD }));
    expect(res.status).toBe(503);
  });

  it('rejects a non-UUID auditId with 400 before any work', async () => {
    const res = await POST(req({ auditId: 'nope' }));
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
