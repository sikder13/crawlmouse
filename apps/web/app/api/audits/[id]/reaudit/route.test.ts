import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route deps are mocked; authorizeReaudit (lib/reaudit) + tierLimits (lib/tier) run for real.
const sendMock = vi.fn();
const insertMock = vi.fn();
let auditRow: { id: string; url: string; user_id: string | null } | null = null;
let getUserResult: { data: { user: { id: string } | null } } = { data: { user: null } };
let isProResult = true;
let globalAllowed = true;
let ipAllowed = true;
let clientIp = 'unknown';
let turnstileOk = true;
let insertResult: { id: string } | null = { id: 'new-aud' };
let insertError: { message: string } | null = null;
const rateLimitCalls: { key: string; opts: unknown }[] = [];

vi.mock('@/lib/inngest', () => ({ inngest: { send: (...a: unknown[]) => sendMock(...a) } }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({ auth: { getUser: () => Promise.resolve(getUserResult) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: auditRow }) }) }),
      insert: (payload: unknown) => {
        insertMock(payload);
        return { select: () => ({ single: () => Promise.resolve({ data: insertResult, error: insertError }) }) };
      },
    }),
  }),
}));
vi.mock('@/lib/pro', () => ({ userIsPro: () => Promise.resolve(isProResult) }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string, _limit: number, _window: number, opts?: unknown) => {
    rateLimitCalls.push({ key, opts });
    return Promise.resolve({ allowed: key.startsWith('global') ? globalAllowed : ipAllowed, resetAt: new Date() });
  },
}));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: () => Promise.resolve(turnstileOk) }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => clientIp }));

import { POST } from './route';

const req = (body: unknown = {}) =>
  new Request('http://localhost/api/audits/aud-1/reaudit', { method: 'POST', body: JSON.stringify(body) });
const params = Promise.resolve({ id: 'aud-1' });

beforeEach(() => {
  sendMock.mockClear();
  insertMock.mockClear();
  rateLimitCalls.length = 0;
  auditRow = { id: 'aud-1', url: 'https://x.com/', user_id: 'u1' };
  getUserResult = { data: { user: { id: 'u1' } } };
  isProResult = true;
  globalAllowed = true;
  ipAllowed = true;
  clientIp = 'unknown';
  turnstileOk = true;
  insertResult = { id: 'new-aud' };
  insertError = null;
});

describe('POST /api/audits/[id]/reaudit — Pro + owner gate', () => {
  it('401 when not signed in', async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(req(), { params });
    expect(res.status).toBe(401);
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('404 when the audit does not exist', async () => {
    auditRow = null;
    expect((await POST(req(), { params })).status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('404 (not 403) when signed in but not the owner — no existence leak', async () => {
    getUserResult = { data: { user: { id: 'intruder' } } };
    expect((await POST(req(), { params })).status).toBe(404);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('402 when the owner is not Pro (monitoring is a Pro feature)', async () => {
    isProResult = false;
    expect((await POST(req(), { params })).status).toBe(402);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/audits/[id]/reaudit — metered (same abuse path, not a backdoor)', () => {
  it('503 when the global daily ceiling is tripped (fails closed)', async () => {
    globalAllowed = false;
    expect((await POST(req(), { params })).status).toBe(503);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('429 captcha_required when the per-IP bucket is exhausted with no token', async () => {
    clientIp = '1.2.3.4';
    ipAllowed = false;
    const res = await POST(req(), { params });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('captcha_required');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('proceeds when the exhausted IP presents a valid Turnstile token', async () => {
    clientIp = '1.2.3.4';
    ipAllowed = false;
    turnstileOk = true;
    expect((await POST(req({ turnstileToken: 'tok' }), { params })).status).toBe(200);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('global ceiling is fail-CLOSED but the per-IP bucket is NOT (cost-guard wiring)', async () => {
    clientIp = '1.2.3.4'; // make the per-IP check run too
    await POST(req(), { params });
    const global = rateLimitCalls.find((c) => c.key === 'global:audits:day');
    const ip = rateLimitCalls.find((c) => c.key.startsWith('ip:'));
    expect(global?.opts).toEqual({ failClosed: true }); // a global RPC error sheds load (503), never fails open
    expect(ip?.opts).toBeUndefined(); // per-IP fails open (a blip mustn't block a legit Pro re-audit)
  });
});

describe('POST /api/audits/[id]/reaudit — success', () => {
  it('creates a predecessor-linked re-audit, fires audit.requested, returns ReauditResponse', async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newAuditId: 'new-aud', previousAuditId: 'aud-1', status: 'queued' });
    // the new audit LINKS its predecessor (monitoring delta) + is a Pro audit (no TTL expiry)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', url: 'https://x.com/', status: 'pending', previous_audit_id: 'aud-1', expires_at: null }),
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'audit.requested', data: expect.objectContaining({ auditId: 'new-aud', url: 'https://x.com/' }) }),
    );
  });

  it('500 when the insert fails', async () => {
    insertResult = null;
    insertError = { message: 'boom' };
    expect((await POST(req(), { params })).status).toBe(500);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
