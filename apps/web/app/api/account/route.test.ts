import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PATCH and DELETE /api/account (CC-27b D2, D3, D4, D6): the route's own decisions — the flag, the
// session, the role read before any service-role client, which verb each role may use, and what it
// hands on. What the handed-on functions do is their own files' tests (profile, deletion,
// email-change); here they are recorders.

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const OWNER_EMAIL = 'owner@example.com';

const h = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  role: 'owner' as string | null,
  /** The kind of the account the viewer acts in. */
  kind: 'personal' as 'personal' | 'agency',
  log: [] as string[],
  saved: [] as { accountId: string; columns: Record<string, unknown> }[],
  deletions: [] as unknown[],
  changes: [] as unknown[],
  deletionAnswer: { ok: true } as { ok: true } | { ok: false; status: number; code: string },
  changeAnswer: { ok: true } as { ok: true } | { ok: false; status: number; code: string },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => {
        h.log.push('getUser');
        return { data: { user: h.user }, error: null };
      },
    },
    rpc: async (fn: string, args: { p_account: string }) => {
      h.log.push(`rpc ${fn} ${args.p_account}`);
      return { data: h.role, error: null };
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    const chain: Record<string, unknown> = {
      single: async () => ({ data: { users: { email: OWNER_EMAIL } }, error: null }),
    };
    chain.select = chain.eq = () => chain;
    return { from: () => chain };
  },
}));
vi.mock('@/lib/v2/account/viewer', () => ({
  loadViewer: async () =>
    h.user
      ? { kind: 'viewer', viewer: { account: { id: ACCOUNT, kind: h.kind } } }
      : { kind: 'signed_out' },
}));
vi.mock('@/lib/v2/account/profile', async (orig) => ({
  ...(await orig<typeof import('@/lib/v2/account/profile')>()),
  supabaseProfilePorts: () => ({
    updateAccount: async (accountId: string, columns: Record<string, unknown>) => {
      h.saved.push({ accountId, columns });
    },
  }),
}));
vi.mock('@/lib/v2/account/deletion-ports', () => ({ routeDeletionPorts: () => ({}) }));
vi.mock('@/lib/v2/account/deletion', () => ({
  requestAccountDeletion: async (_ports: unknown, input: unknown) => {
    h.deletions.push(input);
    return h.deletionAnswer;
  },
}));
vi.mock('@/lib/v2/account/email-change-ports', () => ({ emailChangePorts: () => ({}) }));
vi.mock('@/lib/v2/account/email-change', () => ({
  requestEmailChange: async (_ports: unknown, input: unknown) => {
    h.changes.push(input);
    return h.changeAnswer;
  },
}));

const URL_ = 'https://crawlmouse.com/api/account';
const json = (method: string, body: unknown) =>
  new Request(URL_, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
const form = (fields: Record<string, string>) =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

async function route() {
  return import('./route');
}

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  h.user = { id: '00000000-0000-4000-8000-0000000000b1', email: OWNER_EMAIL };
  h.role = 'owner';
  h.kind = 'personal';
  h.log = [];
  h.saved = [];
  h.deletions = [];
  h.changes = [];
  h.deletionAnswer = { ok: true };
  h.changeAnswer = { ok: true };
});
afterEach(() => vi.unstubAllEnvs());

describe('the flag and the session', () => {
  it('answers 404 to every verb with the flag off, before reading the session', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const r = await route();
    for (const res of [
      await r.PATCH(json('PATCH', { name: 'x' })),
      await r.DELETE(json('DELETE', { hostname: 'x' })),
      await r.POST(form({ _method: 'PATCH', name: 'x' })),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(h.log).toEqual([]);
  });

  it('answers 401 with no session and makes no service-role client', async () => {
    h.user = null;
    const res = await (await route()).PATCH(json('PATCH', { name: 'x' }));
    expect(res.status).toBe(401);
    expect(h.log).toEqual(['getUser']);
  });

  it('reads the role of the viewer’s account through the session before the service role', async () => {
    await (await route()).PATCH(json('PATCH', { name: 'New name' }));
    const role = h.log.indexOf(`rpc member_role ${ACCOUNT}`);
    expect(role).toBeGreaterThan(-1);
    expect(h.log.indexOf('supabaseAdmin')).toBeGreaterThan(role);
  });

  it('answers 404 to a caller with no seat on the account, with no service-role client', async () => {
    h.role = null;
    const res = await (await route()).PATCH(json('PATCH', { name: 'x' }));
    expect(res.status).toBe(404);
    expect(h.log).not.toContain('supabaseAdmin');
    expect(h.saved).toEqual([]);
  });
});

describe('PATCH: the profile', () => {
  it('saves an account manager’s name on the viewer’s account', async () => {
    h.role = 'account_manager';
    const res = await (await route()).PATCH(json('PATCH', { name: '  Studio  ' }));
    expect(res.status).toBe(200);
    expect(h.saved).toEqual([{ accountId: ACCOUNT, columns: { name: 'Studio' } }]);
  });

  it('refuses a developer with 403 and saves nothing', async () => {
    h.role = 'developer';
    const res = await (await route()).PATCH(json('PATCH', { name: 'x' }));
    expect(res.status).toBe(403);
    expect(h.saved).toEqual([]);
  });

  it('refuses a manager’s changed address with 403, saving nothing in the request', async () => {
    h.role = 'account_manager';
    const res = await (
      await route()
    ).PATCH(json('PATCH', { name: 'x', newEmail: 'someone-else@example.com' }));
    expect(res.status).toBe(403);
    expect(h.saved).toEqual([]);
    expect(h.changes).toEqual([]);
  });

  it('hands the owner’s changed address to the email change instead of saving it', async () => {
    const res = await (await route()).PATCH(json('PATCH', { newEmail: 'New@Example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: {}, emailChange: 'sent' });
    expect(h.saved).toEqual([]);
    expect(h.changes).toEqual([
      {
        accountId: ACCOUNT,
        userId: h.user!.id,
        currentEmail: OWNER_EMAIL,
        newEmail: 'new@example.com',
        ip: '203.0.113.9',
      },
    ]);
  });

  it('acting in an agency account: a changed address is 409 personal_account_only and nothing is saved', async () => {
    h.kind = 'agency';
    const res = await (
      await route()
    ).PATCH(json('PATCH', { name: 'Studio', newEmail: 'new@example.com' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'personal_account_only' });
    expect(h.changes).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it('acting in an agency account: its name is saved on that account', async () => {
    h.kind = 'agency';
    const res = await (await route()).PATCH(json('PATCH', { name: 'Summit Digital' }));
    expect(res.status).toBe(200);
    expect(h.saved).toEqual([{ accountId: ACCOUNT, columns: { name: 'Summit Digital' } }]);
  });

  it('saves nothing when the owner’s email change is refused', async () => {
    h.changeAnswer = { ok: false, status: 429, code: 'rate_limited' };
    const res = await (
      await route()
    ).PATCH(json('PATCH', { name: 'Studio', newEmail: 'new@example.com' }));
    expect(res.status).toBe(429);
    expect(h.changes).toHaveLength(1);
    expect(h.saved).toEqual([]);
  });

  it('saves the name with an accepted email change', async () => {
    const res = await (
      await route()
    ).PATCH(json('PATCH', { name: 'Studio', newEmail: 'new@example.com' }));
    expect(res.status).toBe(200);
    expect(h.saved).toEqual([{ accountId: ACCOUNT, columns: { name: 'Studio' } }]);
  });

  it('takes the address Settings posts back unchanged as no change', async () => {
    const res = await (
      await route()
    ).POST(form({ _method: 'PATCH', newEmail: OWNER_EMAIL, name: 'Kept' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/settings?saved=1');
    expect(h.changes).toEqual([]);
    expect(h.saved).toEqual([{ accountId: ACCOUNT, columns: { name: 'Kept' } }]);
  });

  it('refuses a field the profile does not have', async () => {
    const res = await (await route()).PATCH(json('PATCH', { name: 'x', accountId: ACCOUNT }));
    expect(res.status).toBe(400);
    expect(h.saved).toEqual([]);
  });
});

describe('DELETE: the deletion request', () => {
  it('hands the owner’s request on with the typed hostname, the account and the client address', async () => {
    const res = await (await route()).DELETE(json('DELETE', { hostname: 'shop.example' }));
    expect(res.status).toBe(202);
    expect(h.deletions).toEqual([
      { userId: h.user!.id, accountId: ACCOUNT, hostname: 'shop.example', ip: '203.0.113.9' },
    ]);
  });

  it('acting in an agency account: deletion is 409 personal_account_only, with nothing handed on', async () => {
    h.kind = 'agency';
    const res = await (await route()).DELETE(json('DELETE', { hostname: 'shop.example' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'personal_account_only' });
    expect(h.deletions).toEqual([]);
  });

  it.each(['account_manager', 'developer'])('refuses a %s with 403', async (role) => {
    h.role = role;
    const res = await (await route()).DELETE(json('DELETE', { hostname: 'shop.example' }));
    expect(res.status).toBe(403);
    expect(h.deletions).toEqual([]);
  });

  it('a form posts it as POST with _method, and goes back to the delete step', async () => {
    const res = await (await route()).POST(form({ _method: 'DELETE', hostname: 'shop.example' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/settings/delete?sent=1');
    expect(h.deletions).toHaveLength(1);
  });

  it('passes no address when the request carries none', async () => {
    const req = new Request(URL_, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: 'shop.example' }),
    });
    await (await route()).DELETE(req);
    expect(h.deletions).toEqual([expect.objectContaining({ ip: null })]);
  });

  it('answers the deletion’s refusal with its status and code', async () => {
    h.deletionAnswer = { ok: false, status: 422, code: 'hostname_mismatch' };
    const res = await (await route()).DELETE(json('DELETE', { hostname: 'wrong.example' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ code: 'hostname_mismatch' });
  });

  it('refuses a body with more than the hostname', async () => {
    const res = await (
      await route()
    ).DELETE(json('DELETE', { hostname: 'shop.example', accountId: ACCOUNT }));
    expect(res.status).toBe(400);
    expect(h.deletions).toEqual([]);
  });
});

describe('a refused form', () => {
  it('goes back to the delete step with the refusal’s code', async () => {
    h.deletionAnswer = { ok: false, status: 422, code: 'hostname_mismatch' };
    const res = await (await route()).POST(form({ _method: 'DELETE', hostname: 'wrong.example' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/settings/delete?error=hostname_mismatch');
  });

  it('goes back to Settings with the refusal’s code, saving nothing', async () => {
    h.role = 'developer';
    const res = await (await route()).POST(form({ _method: 'PATCH', name: 'x' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/settings?error=role_refused');
    expect(h.saved).toEqual([]);
  });

  it('JSON is still answered with the status and code', async () => {
    h.role = 'developer';
    const res = await (await route()).PATCH(json('PATCH', { name: 'x' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'role_refused' });
  });
});

describe('a form’s verb', () => {
  it('refuses a POST whose _method is neither PATCH nor DELETE', async () => {
    const res = await (await route()).POST(form({ _method: 'PUT', name: 'x' }));
    expect(res.status).toBe(405);
    expect(h.saved).toEqual([]);
  });
});
