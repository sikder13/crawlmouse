import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route deps are mocked; authorizeCancel (lib/audit-cancel) is exercised for real through the route.
const sendMock = vi.fn();
let auditRow: { id: string; user_id: string | null; anonymous_session_id: string | null; status: string } | null = null;
let getUserResult: { data: { user: { id: string } | null } } = { data: { user: null } };
let anonId: string | null = null;
let updatedRows: { id: string }[] = [{ id: 'aud-1' }];

vi.mock('@/lib/inngest', () => ({ inngest: { send: (...args: unknown[]) => sendMock(...args) } }));
vi.mock('@/lib/anon-session', () => ({ readAnonSessionId: () => Promise.resolve(anonId) }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({ auth: { getUser: () => Promise.resolve(getUserResult) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      // load: .select(...).eq(...).maybeSingle()
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: auditRow }) }) }),
      // cancel: .update(...).eq(...).in(...).select()
      update: () => ({ eq: () => ({ in: () => ({ select: () => Promise.resolve({ data: updatedRows, error: null }) }) }) }),
    }),
  }),
}));

import { POST } from './route';

const req = () => new Request('http://localhost/api/audits/aud-1/cancel', { method: 'POST' });
const params = Promise.resolve({ id: 'aud-1' });

beforeEach(() => {
  sendMock.mockClear();
  auditRow = { id: 'aud-1', user_id: null, anonymous_session_id: 'sess-1', status: 'crawling' };
  getUserResult = { data: { user: null } };
  anonId = 'sess-1';
  updatedRows = [{ id: 'aud-1' }];
});

describe('POST /api/audits/[id]/cancel', () => {
  it('404 when the audit does not exist', async () => {
    auditRow = null;
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('403 when the caller is neither the owner nor the matching anon-session', async () => {
    anonId = 'someone-else';
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('409 when the audit is already terminal (authorizeCancel)', async () => {
    auditRow = { ...auditRow!, status: 'completed' };
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('409 (and no cancel event) when the conditional update matches 0 rows — finished between read & write', async () => {
    updatedRows = []; // TOCTOU: the row left pending/crawling just before our guarded write
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('cancels an anon audit for the matching anon-session and sends audit.cancel.requested', async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'canceled' });
    expect(sendMock).toHaveBeenCalledWith({ name: 'audit.cancel.requested', data: { auditId: 'aud-1' } });
  });

  it('cancels a logged-in audit for its owner', async () => {
    auditRow = { id: 'aud-1', user_id: 'u1', anonymous_session_id: null, status: 'crawling' };
    getUserResult = { data: { user: { id: 'u1' } } };
    anonId = null;
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
