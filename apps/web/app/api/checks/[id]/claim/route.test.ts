import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/checks/[id]/claim (CC-25 D8). The session and the claim are mocked; the flag guard, the
// origin check and the status mapping are the route's own.
vi.mock('server-only', () => ({}));
const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { getUser } }) }));
vi.mock('@/lib/auth/door-deps', () => ({
  doorDeps: () => ({ firstLogin: {}, claim: { tag: 'claim-deps' } }),
}));
const claimCheck = vi.fn();
vi.mock('@/lib/auth/claim', () => ({ claimCheck: (...a: unknown[]) => claimCheck(...a) }));

import { POST } from './route';

const ORIGIN = 'https://crawlmouse.com';
const CHECK = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const call = (id = CHECK, headers: Record<string, string> = { origin: ORIGIN }) =>
  POST(new Request(`${ORIGIN}/api/checks/${id}/claim`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  process.env.V2_ACCOUNT_DOOR = '1';
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
  claimCheck.mockReset().mockResolvedValue({ ok: true, siteId: 's1' });
});

describe('POST /api/checks/[id]/claim', () => {
  it('is a 404 with the door off, before any session read', async () => {
    delete process.env.V2_ACCOUNT_DOOR;
    expect((await call()).status).toBe(404);
    expect(getUser).not.toHaveBeenCalled();
    expect(claimCheck).not.toHaveBeenCalled();
  });

  it('refuses a cross-site post', async () => {
    expect((await call(CHECK, { origin: 'https://evil.example' })).status).toBe(403);
    expect(claimCheck).not.toHaveBeenCalled();
  });

  it('is a 401 without a session', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call()).status).toBe(401);
    expect(claimCheck).not.toHaveBeenCalled();
  });

  it('is a 404 for an id that is not a uuid, without a lookup', async () => {
    expect((await call('../x')).status).toBe(404);
    expect(claimCheck).not.toHaveBeenCalled();
  });

  it('claims for the session user and answers with the site', async () => {
    const res = await call();
    expect(claimCheck).toHaveBeenCalledWith(
      { tag: 'claim-deps' },
      { checkId: CHECK, userId: 'u1' },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ siteId: 's1' });
  });

  it.each([
    [404, 'not_found'],
    [409, 'already_claimed'],
    [409, 'site_limit'],
    [410, 'expired'],
  ])('answers a refusal with its status %i and code %s', async (status, code) => {
    claimCheck.mockResolvedValue({ ok: false, status, code });
    const res = await call();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ code });
  });
});
