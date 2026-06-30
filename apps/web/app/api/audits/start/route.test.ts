import { describe, it, expect, vi, beforeEach } from 'vitest';

// Deps mocked; tierLimits / normalizeDomain / limits run for real. The key behaviour under test is the
// ORDER of the metering gates: the per-IP/Turnstile gate must run BEFORE the per-domain check, so a
// captcha-blocked (or any pre-audit-rejected) request never increments/consumes the domain bucket
// (the live "false 'already audited'" phantom).
const sendMock = vi.fn();
const insertMock = vi.fn();
const rlCalls: string[] = [];
let getUserResult: { data: { user: { id: string } | null } } = { data: { user: null } };
let isPro = false;
let globalAllowed = true;
let ipAllowed = true;
let domainAllowed = true;
let turnstileOk = true;
let clientIp = '1.2.3.4';
let insertResult: { id: string } | null = { id: 'new-aud' };
let insertError: { message: string } | null = null;

vi.mock('@crawlmouse/engine', () => ({ validateUrlOrThrow: () => Promise.resolve() }));
vi.mock('@/lib/inngest', () => ({ inngest: { send: (...a: unknown[]) => sendMock(...a) } }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({ auth: { getUser: () => Promise.resolve(getUserResult) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (p: unknown) => { insertMock(p); return { select: () => ({ single: () => Promise.resolve({ data: insertResult, error: insertError }) }) }; },
    }),
  }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => {
    rlCalls.push(key);
    const allowed = key.startsWith('global') ? globalAllowed : key.startsWith('ip:') ? ipAllowed : key.startsWith('domain:') ? domainAllowed : true;
    return Promise.resolve({ allowed, remaining: 0, resetAt: new Date() });
  },
}));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: () => Promise.resolve(turnstileOk) }));
vi.mock('@/lib/pro', () => ({ userIsPro: () => Promise.resolve(isPro) }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => clientIp }));
vi.mock('@/lib/anon-session', () => ({ getOrCreateAnonSessionId: () => Promise.resolve('sess-1') }));

import { POST } from './route';

const req = (body: unknown) => new Request('http://localhost/api/audits/start', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  sendMock.mockClear();
  insertMock.mockClear();
  rlCalls.length = 0;
  getUserResult = { data: { user: null } };
  isPro = false;
  globalAllowed = true;
  ipAllowed = true;
  domainAllowed = true;
  turnstileOk = true;
  clientIp = '1.2.3.4';
  insertResult = { id: 'new-aud' };
  insertError = null;
});

describe('POST /api/audits/start — gate order (phantom-increment fix)', () => {
  it('captcha-blocked request (no token, IP exhausted) does NOT touch the domain bucket', async () => {
    ipAllowed = false; // shared CGNAT IP exhausted
    const res = await POST(req({ url: 'https://fresh-domain.example' })); // no token
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('captcha_required');
    // THE FIX: the per-IP/Turnstile gate ran first, so the domain bucket was never consumed.
    expect(rlCalls.some((k) => k.startsWith('domain:'))).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('post-Turnstile retry (valid token, IP exhausted) passes the gate and starts the audit on a fresh domain', async () => {
    ipAllowed = false; turnstileOk = true; domainAllowed = true;
    const res = await POST(req({ url: 'https://fresh-domain.example', turnstileToken: 'tok' }));
    expect(res.status).toBe(200);
    expect((await res.json()).auditId).toBe('new-aud');
    expect(rlCalls.some((k) => k.startsWith('domain:'))).toBe(true); // domain checked AFTER the gate
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('a bad/exhausted Turnstile token (IP exhausted) is rejected WITHOUT consuming the domain bucket', async () => {
    ipAllowed = false; turnstileOk = false;
    const res = await POST(req({ url: 'https://fresh-domain.example', turnstileToken: 'spent' }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('Captcha failed');
    expect(rlCalls.some((k) => k.startsWith('domain:'))).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('normal under-limit request starts the audit (no captcha needed)', async () => {
    const res = await POST(req({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('still enforces the per-domain limit for an authorized (gate-passed) request', async () => {
    domainAllowed = false; // domain genuinely over its hourly cap
    const res = await POST(req({ url: 'https://example.com' }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('Another audit for this domain');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('global ceiling fails closed FIRST (503) — before any per-IP/domain work', async () => {
    globalAllowed = false;
    const res = await POST(req({ url: 'https://example.com' }));
    expect(res.status).toBe(503);
    expect(rlCalls.some((k) => k.startsWith('ip:') || k.startsWith('domain:'))).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('Pro user skips the per-domain limit (entitlement) and still audits', async () => {
    getUserResult = { data: { user: { id: 'u1' } } };
    isPro = true;
    const res = await POST(req({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    expect(rlCalls.some((k) => k.startsWith('domain:'))).toBe(false);
  });
});
