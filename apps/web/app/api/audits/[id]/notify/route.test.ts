import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC 04 §2 — V3 (the email-me-when-done valve, capture side). Contracts:
//   - per-IP AND per-email daily caps via the existing rate_limits pattern (abuse control);
//   - only a pending/crawling audit accepts a request (a finished audit -> 409: just look);
//   - the email is validated + never echoed back; the capability id alone authorizes (anon ok);
//   - a DB failure degrades to 503 (fail-soft; the wait UI simply keeps working without it).

const rlCalls: string[] = [];
let ipAllowed = true;
let emailAllowed = true;
let updatedRows: Array<{ id: string }> = [{ id: 'aud-1' }];
let updateError: { message: string } | null = null;
const updateMock = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => {
    rlCalls.push(key);
    const allowed = key.startsWith('notify:ip:') ? ipAllowed : key.startsWith('notify:email:') ? emailAllowed : true;
    return Promise.resolve({ allowed, remaining: 0, resetAt: new Date() });
  },
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '9.9.9.9' }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (payload: unknown) => {
        updateMock(payload);
        return {
          eq: () => ({
            in: () => ({ select: () => Promise.resolve({ data: updatedRows, error: updateError }) }),
          }),
        };
      },
    }),
  }),
}));

import { POST } from './route';

const AUD = '123e4567-e89b-12d3-a456-426614174000';
const req = (body: unknown) =>
  new Request(`http://localhost/api/audits/${AUD}/notify`, { method: 'POST', body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: AUD }) };

beforeEach(() => {
  rlCalls.length = 0;
  ipAllowed = true;
  emailAllowed = true;
  updatedRows = [{ id: 'aud-1' }];
  updateError = null;
  updateMock.mockClear();
});

describe('POST /api/audits/[id]/notify', () => {
  it('stores the email for a running audit and returns ok WITHOUT echoing the address', async () => {
    const res = await POST(req({ email: 'me@example.com' }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(JSON.stringify(body)).not.toContain('me@example.com');
    expect(updateMock).toHaveBeenCalledTimes(1);
    const payload = updateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.notify_email).toBe('me@example.com');
    expect(payload).toHaveProperty('notify_requested_at');
  });

  it('rejects an invalid email with 400 before touching any bucket or the DB', async () => {
    const res = await POST(req({ email: 'not-an-email' }), params);
    expect(res.status).toBe(400);
    expect(rlCalls.length).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('enforces the per-IP daily cap (429) without writing', async () => {
    ipAllowed = false;
    const res = await POST(req({ email: 'me@example.com' }), params);
    expect(res.status).toBe(429);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('enforces the per-email daily cap (429), keyed on the normalized address', async () => {
    emailAllowed = false;
    const res = await POST(req({ email: 'ME@EXAMPLE.COM' }), params);
    expect(res.status).toBe(429);
    expect(rlCalls.some((k) => k === 'notify:email:me@example.com')).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the audit has already finished (0 rows matched the pending/crawling guard)', async () => {
    updatedRows = [];
    const res = await POST(req({ email: 'me@example.com' }), params);
    expect(res.status).toBe(409);
  });

  it('degrades to 503 on a DB error (fail-soft: the wait experience continues without the valve)', async () => {
    updateError = { message: 'column "notify_email" does not exist' };
    const res = await POST(req({ email: 'me@example.com' }), params);
    expect(res.status).toBe(503);
  });

  it('rejects a non-UUID audit id with 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/audits/nope/notify', { method: 'POST', body: JSON.stringify({ email: 'me@example.com' }) }),
      { params: Promise.resolve({ id: 'nope' }) },
    );
    expect(res.status).toBe(400);
  });
});
