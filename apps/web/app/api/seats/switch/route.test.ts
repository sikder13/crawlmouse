import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import type { Call } from '@/__tests__/helpers/postgrest-pglite';
import {
  addSeat,
  person,
  removeSeat,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { ACCOUNT_COOKIE } from '@/lib/v2/account/viewer-cookie';
import { agencyAccount, type AgencyAccount } from '@/lib/v2/agency/test-support';

// POST /api/seats/switch (CC-31 D2b). The session client is the PostgREST stand-in over PGlite with
// every migration applied, so `is_member` and the accounts policy run for real. The service-role
// client throws: the route has no use for it.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** Each request the caller's client sent, as its chain of calls. */
  calls: [] as Call[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user, h.calls),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    throw new Error('the switch asks the service role for nothing');
  },
}));

import * as route from './route';

let owner: Person;
let agency: AgencyAccount;
let colleague: Person;
let stranger: Person;

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  owner = await person(h.db, 'owner');
  agency = await agencyAccount(h.db, owner);
  colleague = await person(h.db, 'colleague');
  stranger = await person(h.db, 'stranger');
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(() => {
  h.user = null;
  h.calls.length = 0;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const ORIGIN = 'https://crawlmouse.com';

const form = (fields: Record<string, string>, origin = ORIGIN) =>
  new Request(`${origin}/api/seats/switch`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

const json = (value: unknown) =>
  new Request(`${ORIGIN}/api/seats/switch`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });

/** The cookie's attributes as a set, and its `name=value`. */
function cookieOf(res: Response) {
  const header = res.headers.get('set-cookie');
  if (header === null) return null;
  const [pair, ...attributes] = header.split(';').map((p) => p.trim());
  return { pair, attributes: new Set(attributes.map((a) => a.toLowerCase())) };
}

/** What the caller's client was asked, one entry a request: the function, or the table read. */
const asked = () => h.calls.map(([first]) => `${first![0]} ${String(first![1])}`);

const defaults = async () =>
  (
    await h.db.query<{ id: string; default_account_id: string | null }>(
      `select id, default_account_id from public.users order by id`,
    )
  ).rows;

describe('POST /api/seats/switch', () => {
  it('is a 404 while V2_CHECKS_PUBLIC is off', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    as(owner);
    const res = await route.POST(form({ accountId: agency.accountId }));
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('asks a signed-out caller to sign in and sets nothing', async () => {
    const res = await route.POST(form({ accountId: agency.accountId }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'auth_required' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('sends a form to the matrix for an agency account, with the choice in the cookie', async () => {
    as(owner);
    const res = await route.POST(form({ accountId: agency.accountId }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/agency');
    expect(cookieOf(res)).toEqual({
      pair: `${ACCOUNT_COOKIE}=${agency.accountId}`,
      attributes: new Set(['path=/', 'max-age=31536000', 'httponly', 'secure', 'samesite=lax']),
    });
  });

  it('sends a form to the dashboard for a personal account', async () => {
    as(owner);
    const res = await route.POST(form({ accountId: owner.accountId }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard');
    expect(cookieOf(res)?.pair).toBe(`${ACCOUNT_COOKIE}=${owner.accountId}`);
  });

  it('answers JSON with the account it switched to', async () => {
    as(owner);
    const res = await route.POST(json({ accountId: agency.accountId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accountId: agency.accountId });
    expect(cookieOf(res)?.pair).toBe(`${ACCOUNT_COOKIE}=${agency.accountId}`);
  });

  it('leaves Secure off the cookie where the request is not HTTPS', async () => {
    as(owner);
    const res = await route.POST(form({ accountId: agency.accountId }, 'http://localhost:3000'));
    expect(res.status).toBe(303);
    expect(cookieOf(res)?.attributes).toEqual(
      new Set(['path=/', 'max-age=31536000', 'httponly', 'samesite=lax']),
    );
  });

  it('switches a colleague with an active seat, whatever their role', async () => {
    const seat = await addSeat(h.db, agency.accountId, colleague, 'developer');
    as(colleague);
    const res = await route.POST(form({ accountId: agency.accountId }));
    expect(res.status).toBe(303);
    expect(cookieOf(res)?.pair).toBe(`${ACCOUNT_COOKIE}=${agency.accountId}`);
    await h.db.query(`delete from public.seats where id = $1`, [seat]);
  });

  it('is a 404 with no cookie for an account the caller has no seat on', async () => {
    as(stranger);
    for (const res of [
      await route.POST(form({ accountId: agency.accountId })),
      await route.POST(json({ accountId: owner.accountId })),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: 'not_found' });
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('asks is_member for the named account and, refused, reads nothing after it', async () => {
    as(stranger);
    expect((await route.POST(form({ accountId: agency.accountId }))).status).toBe(404);
    expect(h.calls).toEqual([[['rpc', 'is_member', { p_account: agency.accountId }]]]);
    h.calls.length = 0;
    as(owner);
    expect((await route.POST(form({ accountId: agency.accountId }))).status).toBe(303);
    expect(asked()).toEqual(['rpc is_member', 'from accounts']);
  });

  it('is a 404 with no cookie for an account the caller’s seat was removed from', async () => {
    const leaver = await person(h.db, 'leaver');
    const seat = await addSeat(h.db, agency.accountId, leaver, 'account_manager');
    await removeSeat(h.db, seat);
    as(leaver);
    const res = await route.POST(form({ accountId: agency.accountId }));
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('is a 404 with no cookie for an invitation that was not accepted', async () => {
    const invited = await person(h.db, 'invited');
    await h.db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status)
       values ($1, $2, $3, 'developer', 'invited')`,
      [agency.accountId, invited.id, invited.email],
    );
    as(invited);
    const res = await route.POST(form({ accountId: agency.accountId }));
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('is a 404 with no cookie for an account marked for deletion', async () => {
    const marked = await agencyAccount(h.db, owner, 'Marked Agency');
    await h.db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days'
        where id = $1`,
      [marked.accountId],
    );
    as(owner);
    const res = await route.POST(form({ accountId: marked.accountId }));
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('is a 404 for an id that is not an account id, and a 400 for a body it cannot read', async () => {
    as(owner);
    const malformed = await route.POST(form({ accountId: 'not-an-id' }));
    expect(malformed.status).toBe(404);
    expect(malformed.headers.get('set-cookie')).toBeNull();
    for (const req of [
      form({}),
      form({ accountId: agency.accountId, next: 'https://evil.example' }),
      json({ accountId: 7 }),
      new Request(`${ORIGIN}/api/seats/switch`, { method: 'POST', body: 'accountId=x' }),
    ]) {
      const res = await route.POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'invalid' });
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('writes no default account: every users row is as it was', async () => {
    const before = await defaults();
    as(owner);
    expect((await route.POST(form({ accountId: agency.accountId }))).status).toBe(303);
    expect((await route.POST(json({ accountId: owner.accountId }))).status).toBe(200);
    expect(await defaults()).toEqual(before);
    expect(before.find((u) => u.id === owner.id)?.default_account_id).toBe(owner.accountId);
  });

  it('has no handler but POST: no GET sets the cookie', () => {
    expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))).toEqual(['POST']);
  });
});
