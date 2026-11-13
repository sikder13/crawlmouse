import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { agencyAccount } from '@/lib/v2/agency/test-support';

// The seat routes (CC-31 D3): POST /api/seats, PATCH, DELETE and POST (`_method`)
// /api/seats/id/[id], POST /api/seats/id/[id]/resend, POST /api/seats/accept and GET /invite/[token].
// The session and service-role clients are the PostgREST stand-in over PGlite with every migration
// applied, so `seat_may`, row security and migration 20261114000002's section A run for real;
// Inngest's send, the rate limit and the event capture are fakes.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  send: vi.fn(async (_e: unknown) => undefined),
  capture: vi.fn(async (..._a: unknown[]) => undefined),
  /** The switcher cookie's value on this request, or null for none. */
  chosen: null as string | null,
  /** Each rate-limit call, and the bucket kinds (`account`, `ip`) answered as over the limit. */
  limits: [] as { key: string; limit: number; windowMs: number; failClosed: boolean }[],
  over: new Set<string>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    const admin = adminOver(h.db);
    return {
      from: (table: string) => admin.from(table),
      rpc: (fn: string, args: object) => {
        h.log.push(`admin.rpc ${fn}`);
        return admin.rpc(fn, args);
      },
    };
  },
}));
vi.mock('../../../../../inngest/client', () => ({ inngest: { send: h.send } }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (
    key: string,
    limit: number,
    windowMs: number,
    opts?: { failClosed?: boolean },
  ) => {
    h.limits.push({ key, limit, windowMs, failClosed: opts?.failClosed === true });
    return {
      allowed: !h.over.has(key.split(':')[1]!),
      remaining: 0,
      resetAt: new Date(Date.now() + 90_000),
    };
  },
}));
vi.mock('@/lib/v2/agency/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/agency/events')>()),
  agencyCaptureFor: () => h.capture,
}));

import { GET as LAND } from '../../invite/[token]/route';
import { POST as ACCEPT } from './accept/route';
import { POST as RESEND } from './id/[id]/resend/route';
import { DELETE, PATCH, POST as SEAT_FORM } from './id/[id]/route';
import { POST } from './route';

const FORM = 'application/x-www-form-urlencoded';
const IP = '203.0.113.9';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(() => {
  h.log.length = 0;
  h.user = null;
  h.chosen = null;
  h.limits.length = 0;
  h.over = new Set();
  h.send.mockClear();
  h.capture.mockClear();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Pick<Person, 'id' | 'email'> | null) => {
  h.user = p && { id: p.id, email: p.email };
};

function request(
  path: string,
  method: string,
  body?: string,
  type = 'application/json',
  cookie?: string,
): Request {
  return new Request(`https://crawlmouse.com${path}`, {
    method,
    headers: {
      origin: 'https://crawlmouse.com',
      'x-forwarded-for': IP,
      ...(body === undefined ? {} : { 'content-type': type }),
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

const invite = (v: unknown) => POST(request('/api/seats', 'POST', JSON.stringify(v)));
const resend = (id: string, type = 'application/json') =>
  RESEND(request(`/api/seats/id/${id}/resend`, 'POST', type === FORM ? '' : '{}', type), ctx(id));
const inviteForm = (body: string) => POST(request('/api/seats', 'POST', body, FORM));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

interface SeatRow {
  id: string;
  user_id: string | null;
  invited_email: string;
  role: string;
  status: string;
  client_scope_all: boolean;
  invite_seq: number;
  invite_token_hash: string | null;
}

const seat = async (id: string) =>
  (await h.db.query<SeatRow>(`select * from public.seats where id = $1`, [id])).rows[0]!;

const seatsOf = async (accountId: string) =>
  (
    await h.db.query<{ invited_email: string; role: string; status: string }>(
      `select invited_email, role, status from public.seats where account_id = $1 order by created_at, invited_email`,
      [accountId],
    )
  ).rows;

const scopeOf = async (seatId: string) =>
  (
    await h.db.query<{ site_id: string }>(
      `select site_id from public.seat_sites where seat_id = $1 order by 1`,
      [seatId],
    )
  ).rows.map((r) => r.site_id);

/** An owner whose own account is on a paid plan. */
async function paidOwner(tier: 'pro' | 'agency' = 'agency'): Promise<Person> {
  const owner = await person(h.db, 'owner');
  await makePaid(h.db, owner.accountId, tier);
  return owner;
}

/** A person who holds a seat of `role` on `owner`'s account and acts in it. */
async function colleague(owner: Person, role: 'account_manager' | 'developer'): Promise<Person> {
  const p = await person(h.db, role);
  const seatId = await addSeat(h.db, owner.accountId, p, role);
  await h.db.query(`update public.users set default_account_id = $2 where id = $1`, [
    p.id,
    owner.accountId,
  ]);
  return { ...p, accountId: owner.accountId, seatId };
}

/** An invited seat with its link issued: the seat's id and the token its mail would carry. */
async function invited(accountId: string, email: string, role = 'developer') {
  const {
    rows: [i],
  } = await h.db.query<{ r: { seat_id: string; seq: number } }>(
    `select public.invite_seat($1, $2, $3, null, 100, now()) r`,
    [accountId, email, role],
  );
  const {
    rows: [link],
  } = await h.db.query<{ token: string }>(
    `select token from public.issue_seat_invite($1, $2, now())`,
    [i!.r.seat_id, i!.r.seq],
  );
  return { seatId: i!.r.seat_id, token: link!.token };
}

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const setCookies = (res: Response) => res.headers.getSetCookie();

describe('POST /api/seats', () => {
  it('with V2_CHECKS_PUBLIC unset: 404 before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    as(await paidOwner());
    const res = await invite({ email: 'a@example.com', role: 'developer', scope: 'all' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(h.log).toEqual([]);
  });

  it('signed out: 401, and no service-role client', async () => {
    const res = await invite({ email: 'a@example.com', role: 'developer', scope: 'all' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'auth_required' });
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('the owner invites a colleague to every client: the seat, one mail request naming two ids, one event', async () => {
    const owner = await paidOwner();
    as(owner);
    const res = await invite({
      email: ' Dana@Example.com ',
      role: 'account_manager',
      scope: 'all',
    });
    expect(res.status).toBe(201);
    const { seatId } = (await res.json()) as { seatId: string };
    expect(await seat(seatId)).toMatchObject({
      invited_email: 'dana@example.com',
      role: 'account_manager',
      status: 'invited',
      client_scope_all: true,
      invite_seq: 1,
      invite_token_hash: null,
    });
    expect(h.send.mock.calls).toEqual([
      [
        {
          id: `seat_invite:${seatId}:1`,
          name: 'seat.invite.requested',
          data: { seat_id: seatId, seq: 1 },
        },
      ],
    ]);
    expect(h.capture.mock.calls).toEqual([
      ['seat_invited', owner.accountId, { role: 'account_manager', scoped: false }],
    ]);
    expect(JSON.stringify([h.send.mock.calls, h.capture.mock.calls])).not.toContain('dana');
  });

  it('when the mail cannot be queued the seat stays and the caller is told: 503, and Resend then asks again', async () => {
    const owner = await paidOwner();
    as(owner);
    h.send.mockRejectedValueOnce(new Error('the queue is down'));
    const res = await invite({ email: 'late@example.com', role: 'developer', scope: 'all' });
    expect(res.status).toBe(503);
    const { code, seatId } = (await res.json()) as { code: string; seatId: string };
    expect(code).toBe('invite_not_mailed');
    expect(await seat(seatId)).toMatchObject({ status: 'invited', invite_seq: 1 });
    // The same failure for a form goes back to Seats with the notice.
    h.send.mockRejectedValueOnce(new Error('the queue is down'));
    const again = await resend(seatId, FORM);
    expect([again.status, again.headers.get('location')]).toEqual([
      303,
      '/seats?notice=invite_not_mailed',
    ]);
    // With the queue back, Resend asks for the mail of the seat's next invitation.
    h.send.mockClear();
    expect((await resend(seatId)).status).toBe(200);
    expect(h.send.mock.calls).toEqual([
      [
        {
          id: `seat_invite:${seatId}:3`,
          name: 'seat.invite.requested',
          data: { seat_id: seatId, seq: 3 },
        },
      ],
    ]);
  });

  it('a form names the clients it ticks, and is answered with a 303 back to Seats', async () => {
    const owner = await paidOwner();
    const [a, b] = [await keptSite(h.db, owner.accountId), await keptSite(h.db, owner.accountId)];
    await keptSite(h.db, owner.accountId);
    as(owner);
    const res = await inviteForm(
      `email=lee%40example.com&role=developer&scope=some&site_${a.id}=on&site_${b.id}=on`,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/seats?notice=seat_invited');
    const [, row] = await h.db
      .query<{
        id: string;
        client_scope_all: boolean;
      }>(
        `select id, client_scope_all from public.seats where account_id = $1 order by created_at`,
        [owner.accountId],
      )
      .then((r) => r.rows);
    expect(row!.client_scope_all).toBe(false);
    expect(await scopeOf(row!.id)).toEqual([a.id, b.id].sort());
    expect(h.capture.mock.calls).toEqual([
      ['seat_invited', owner.accountId, { role: 'developer', scoped: true }],
    ]);
  });

  it('a form that chose every client drops the boxes left ticked', async () => {
    const owner = await paidOwner();
    const a = await keptSite(h.db, owner.accountId);
    as(owner);
    const res = await inviteForm(
      `email=all%40example.com&role=developer&scope=all&site_${a.id}=on`,
    );
    expect(res.headers.get('location')).toBe('/seats?notice=seat_invited');
    expect(await seatsOf(owner.accountId)).toContainEqual({
      invited_email: 'all@example.com',
      role: 'developer',
      status: 'invited',
    });
  });

  it.each(['account_manager', 'developer'] as const)(
    'a seat of role %s may not invite: 403, no service-role client, nothing written',
    async (role) => {
      const owner = await paidOwner();
      as(await colleague(owner, role));
      const res = await invite({ email: 'new@example.com', role: 'developer', scope: 'all' });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: 'role_refused' });
      expect(h.log.filter((l) => l.startsWith('admin.rpc'))).toEqual([]);
      expect(await seatsOf(owner.accountId)).toHaveLength(2);
      expect(h.send).not.toHaveBeenCalled();
      expect(h.limits).toEqual([]);
    },
  );

  it('a Free account is 402 with the seats gate before anything is counted or written', async () => {
    const owner = await person(h.db, 'free');
    as(owner);
    const res = await invite({ email: 'new@example.com', role: 'developer', scope: 'all' });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      code: 'upgrade_required',
      gate: 'seats',
      canBuySeats: false,
    });
    expect(h.limits).toEqual([]);
    expect(h.log.filter((l) => l.startsWith('admin.rpc'))).toEqual([]);
    const form = await inviteForm('email=new%40example.com&role=developer&scope=all');
    expect(form.headers.get('location')).toBe('/seats?notice=upgrade_required');
  });

  it('a full Pro account is 402 and cannot buy a seat; a full Agency account can', async () => {
    const pro = await paidOwner('pro');
    as(pro);
    expect(
      (await invite({ email: 'one@example.com', role: 'developer', scope: 'all' })).status,
    ).toBe(201);
    const full = await invite({ email: 'two@example.com', role: 'developer', scope: 'all' });
    expect(full.status).toBe(402);
    expect(await full.json()).toEqual({
      code: 'upgrade_required',
      gate: 'seats',
      canBuySeats: false,
    });
    const form = await inviteForm('email=two%40example.com&role=developer&scope=all');
    expect(form.headers.get('location')).toBe('/seats?notice=seats_full');
    expect(await seatsOf(pro.accountId)).toHaveLength(2);

    const agency = await paidOwner('agency');
    await h.db.query(`update public.accounts set seat_limit = 1 where id = $1`, [agency.accountId]);
    as(agency);
    const res = await invite({ email: 'two@example.com', role: 'developer', scope: 'all' });
    expect(await res.json()).toEqual({
      code: 'upgrade_required',
      gate: 'seats',
      canBuySeats: true,
    });
  });

  it.each(['agency_trial', 'past_due'] as const)(
    'a full Agency account in %s cannot buy a seat yet: 402 says so, where the paid account’s says it can',
    async (state) => {
      const agency = await paidOwner('agency');
      await h.db.query(
        `update public.accounts
            set seat_limit = 1, state = $2,
                trial_variant = case when $2 = 'agency_trial' then 'card_required' end,
                trial_ends_at = case when $2 = 'agency_trial' then now() + interval '5 days' end,
                trial_used_at = case when $2 = 'agency_trial' then now() end,
                past_due_since = case when $2 = 'past_due' then now() end,
                past_due_tier = case when $2 = 'past_due' then 'agency' end,
                state_history = state_history || jsonb_build_array(
                  jsonb_build_object('state', $2::text, 'since', now()::text))
          where id = $1`,
        [agency.accountId, state],
      );
      as(agency);
      const res = await invite({ email: 'two@example.com', role: 'developer', scope: 'all' });
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({
        code: 'upgrade_required',
        gate: 'seats',
        canBuySeats: false,
      });
    },
  );

  it('a body cannot set the limit, name an account, or invite an owner: 400', async () => {
    const owner = await paidOwner('pro');
    as(owner);
    const base = { email: 'x@example.com', role: 'developer', scope: 'all' };
    for (const body of [
      { ...base, cap: 100 },
      { ...base, seatLimit: 100 },
      { ...base, accountId: owner.accountId },
      { ...base, role: 'owner' },
      { ...base, email: 'not an address' },
      { ...base, scope: [] },
      { ...base, scope: ['not-an-id'] },
      { ...base, scope: 'some' },
      { email: base.email, role: base.role },
      {},
    ]) {
      const res = await invite(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ code: 'invalid' });
    }
    expect((await POST(request('/api/seats', 'POST', 'nope', 'text/plain'))).status).toBe(400);
    expect(await seatsOf(owner.accountId)).toHaveLength(1);
    expect(h.log.filter((l) => l.startsWith('admin.rpc'))).toEqual([]);
  });

  it('an address that already holds a seat is 409; a site of another account is 400', async () => {
    const owner = await paidOwner();
    const other = await paidOwner();
    const theirs = await keptSite(h.db, other.accountId);
    as(owner);
    const taken = await invite({ email: owner.email, role: 'developer', scope: 'all' });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ code: 'seat_exists' });
    const scope = await invite({ email: 'x@example.com', role: 'developer', scope: [theirs.id] });
    expect(scope.status).toBe(400);
    expect(await scope.json()).toEqual({ code: 'invalid_scope' });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('counts each invitation per account and per address, failing closed, with no address in a key', async () => {
    const owner = await paidOwner();
    as(owner);
    await invite({ email: 'x@example.com', role: 'developer', scope: 'all' });
    expect(h.limits).toEqual([
      {
        key: `seat-invite:account:${owner.accountId}`,
        limit: 20,
        windowMs: 24 * 60 * 60 * 1000,
        failClosed: true,
      },
      {
        key: `seat-invite:ip:${sha256(IP)}`,
        limit: 10,
        windowMs: 60 * 60 * 1000,
        failClosed: true,
      },
    ]);
  });

  it.each(['pro_trial', 'agency_trial'] as const)(
    'holds an account in a %s to 3 invitation mails a day, for an invitation and for a resend',
    async (state) => {
      const owner = await paidOwner();
      await h.db.query(
        `update public.accounts
            set state = $2, tier = case when $2 = 'pro_trial' then 'pro' else 'agency' end,
                trial_variant = 'card_required',
                trial_ends_at = now() + interval '5 days', trial_used_at = now(),
                state_history = state_history || jsonb_build_array(
                  jsonb_build_object('state', $2::text, 'since', now()::text))
          where id = $1`,
        [owner.accountId, state],
      );
      as(owner);
      const res = await invite({ email: 'trial@example.com', role: 'developer', scope: 'all' });
      expect(res.status).toBe(201);
      const { seatId } = (await res.json()) as { seatId: string };
      await resend(seatId);
      const perAccount = h.limits.filter((l) => l.key.startsWith('seat-invite:account:'));
      expect(perAccount.map((l) => l.limit)).toEqual([3, 3]);
      expect(perAccount.every((l) => l.failClosed)).toBe(true);
    },
  );

  it.each(['account', 'ip'])(
    'past the %s bound: 429 with Retry-After, nothing written',
    async (bucket) => {
      const owner = await paidOwner();
      as(owner);
      h.over = new Set([bucket]);
      const res = await invite({ email: 'x@example.com', role: 'developer', scope: 'all' });
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ code: 'rate_limited' });
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await seatsOf(owner.accountId)).toHaveLength(1);
      expect(h.send).not.toHaveBeenCalled();
      const form = await inviteForm('email=x%40example.com&role=developer&scope=all');
      expect(form.headers.get('location')).toMatch(/^\/seats\?notice=rate_limited&next=/);
    },
  );

  it('a person with two accounts invites into the one their switcher names, and never into another person’s', async () => {
    const owner = await person(h.db, 'two');
    const agency = await agencyAccount(h.db, owner);
    const stranger = await paidOwner();
    as(owner);

    h.chosen = agency.accountId;
    expect((await invite({ email: 'a@example.com', role: 'developer', scope: 'all' })).status).toBe(
      201,
    );
    expect(await seatsOf(agency.accountId)).toHaveLength(2);

    // A cookie naming an account the caller holds no seat on reads as no choice: their own account.
    h.chosen = stranger.accountId;
    const res = await invite({ email: 'b@example.com', role: 'developer', scope: 'all' });
    expect(res.status).toBe(402);
    expect(await seatsOf(stranger.accountId)).toHaveLength(1);
  });
});

describe('PATCH and DELETE /api/seats/id/[id]', () => {
  const patch = (id: string, v: unknown) =>
    PATCH(request(`/api/seats/id/${id}`, 'PATCH', JSON.stringify(v)), ctx(id));
  const del = (id: string) => DELETE(request(`/api/seats/id/${id}`, 'DELETE'), ctx(id));
  const form = (id: string, body: string) =>
    SEAT_FORM(request(`/api/seats/id/${id}`, 'POST', body, FORM), ctx(id));

  it('with V2_CHECKS_PUBLIC unset: 404 before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const owner = await paidOwner();
    as(owner);
    for (const res of [
      await patch(owner.seatId, { role: 'developer', scope: 'all' }),
      await del(owner.seatId),
      await form(owner.seatId, '_method=DELETE'),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(h.log).toEqual([]);
  });

  it('the owner changes a seat’s role and clients', async () => {
    const owner = await paidOwner();
    const member = await colleague(owner, 'developer');
    const site = await keptSite(h.db, owner.accountId);
    as(owner);
    const res = await patch(member.seatId, { role: 'account_manager', scope: [site.id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: true });
    expect(await seat(member.seatId)).toMatchObject({
      role: 'account_manager',
      client_scope_all: false,
      status: 'active',
    });
    expect(await scopeOf(member.seatId)).toEqual([site.id]);

    const back = await form(member.seatId, '_method=PATCH&role=developer&scope=all');
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/seats?notice=seat_changed');
    expect(await seat(member.seatId)).toMatchObject({ role: 'developer', client_scope_all: true });
  });

  it('the owner removes a seat, and that person’s session reads the account no more', async () => {
    const owner = await paidOwner();
    const member = await colleague(owner, 'account_manager');
    const isMember = async () =>
      (await sessionOver(h.db, member).rpc('is_member', { p_account: owner.accountId })).data;
    expect(await isMember()).toBe(true);
    as(owner);
    const res = await del(member.seatId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect((await seat(member.seatId)).status).toBe('removed');
    expect(await isMember()).toBe(false);
    // Removed already: the same 404 as no seat.
    expect((await del(member.seatId)).status).toBe(404);
  });

  it('a form removes with _method=DELETE and goes back to Seats', async () => {
    const owner = await paidOwner();
    const member = await colleague(owner, 'developer');
    as(owner);
    const res = await form(member.seatId, '_method=DELETE');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/seats?notice=seat_removed');
    expect((await seat(member.seatId)).status).toBe('removed');
  });

  it('a seat id of another account is 404 for a change, a removal and a resend, and the seat is left', async () => {
    const owner = await paidOwner();
    const other = await paidOwner();
    const theirs = await colleague(other, 'developer');
    const pending = await invited(other.accountId, 'pending@example.com');
    as(owner);
    // The caller's switcher cookie names the other account too: they hold no seat on it, so it is
    // not the account they act in.
    h.chosen = other.accountId;
    for (const res of [
      await patch(theirs.seatId, { role: 'account_manager', scope: 'all' }),
      await del(theirs.seatId),
      await RESEND(
        request(`/api/seats/id/${pending.seatId}/resend`, 'POST', '{}'),
        ctx(pending.seatId),
      ),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: 'not_found' });
    }
    expect(await seat(theirs.seatId)).toMatchObject({ role: 'developer', status: 'active' });
    expect((await seat(pending.seatId)).invite_seq).toBe(1);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('the owner’s own seat is neither demoted nor removed: 409', async () => {
    const owner = await paidOwner();
    as(owner);
    const changed = await patch(owner.seatId, { role: 'developer', scope: 'all' });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ code: 'seat_owner' });
    const removed = await del(owner.seatId);
    expect(removed.status).toBe(409);
    expect(await removed.json()).toEqual({ code: 'seat_owner' });
    expect(await seat(owner.seatId)).toMatchObject({ role: 'owner', status: 'active' });
    const form303 = await form(owner.seatId, '_method=DELETE');
    expect(form303.headers.get('location')).toBe('/seats?notice=seat_owner');
  });

  it.each(['account_manager', 'developer'] as const)(
    'a seat of role %s may neither change nor remove a seat: 403, no service-role call',
    async (role) => {
      const owner = await paidOwner();
      const target = await colleague(owner, 'developer');
      as(await colleague(owner, role));
      for (const res of [
        await patch(target.seatId, { role: 'account_manager', scope: 'all' }),
        await del(target.seatId),
        await form(target.seatId, '_method=DELETE'),
      ]) {
        expect([res.status, res.headers.get('location')]).toEqual(
          res.status === 303 ? [303, '/seats?notice=role_refused'] : [403, null],
        );
      }
      expect(h.log.filter((l) => l.startsWith('admin.rpc'))).toEqual([]);
      expect(await seat(target.seatId)).toMatchObject({ role: 'developer', status: 'active' });
    },
  );

  it('a malformed id is 404; a change to owner, or with no scope, is 400; a form with no _method is 405', async () => {
    const owner = await paidOwner();
    const member = await colleague(owner, 'developer');
    as(owner);
    expect((await patch('not-an-id', { role: 'developer', scope: 'all' })).status).toBe(404);
    for (const body of [{ role: 'owner', scope: 'all' }, { role: 'developer' }, {}]) {
      const res = await patch(member.seatId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await form(member.seatId, 'role=developer&scope=all')).status).toBe(405);
    expect(await seat(member.seatId)).toMatchObject({ role: 'developer', status: 'active' });
  });
});

describe('POST /api/seats/id/[id]/resend', () => {
  it('with V2_CHECKS_PUBLIC unset: 404', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const owner = await paidOwner();
    as(owner);
    expect((await resend(owner.seatId)).status).toBe(404);
    expect(h.log).toEqual([]);
  });

  it('the owner resends: the next invitation is asked for under its own id, and the earlier link is gone', async () => {
    const owner = await paidOwner();
    const first = await invited(owner.accountId, 'again@example.com');
    as(owner);
    const res = await resend(first.seatId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resent: true });
    expect(await seat(first.seatId)).toMatchObject({ invite_seq: 2, invite_token_hash: null });
    expect(h.send.mock.calls).toEqual([
      [
        {
          id: `seat_invite:${first.seatId}:2`,
          name: 'seat.invite.requested',
          data: { seat_id: first.seatId, seq: 2 },
        },
      ],
    ]);
    const { rows } = await h.db.query<{ r: { outcome: string } }>(
      `select public.read_seat_invite($1, now()) r`,
      [sha256(first.token)],
    );
    expect(rows[0]!.r.outcome).toBe('gone');

    const form = await resend(first.seatId, FORM);
    expect(form.headers.get('location')).toBe('/seats?notice=seat_resent');
    expect((await seat(first.seatId)).invite_seq).toBe(3);
  });

  it('a seat already accepted is 409, and nothing is asked for', async () => {
    const owner = await paidOwner();
    const member = await colleague(owner, 'developer');
    as(owner);
    const res = await resend(member.seatId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'not_invited' });
    expect(h.send).not.toHaveBeenCalled();
  });

  it('an account manager may not resend: 403', async () => {
    const owner = await paidOwner();
    const pending = await invited(owner.accountId, 'pending@example.com');
    as(await colleague(owner, 'account_manager'));
    const res = await resend(pending.seatId);
    expect(res.status).toBe(403);
    expect((await seat(pending.seatId)).invite_seq).toBe(1);
    expect(h.limits).toEqual([]);
  });

  it('counts into the buckets an invite counts into, and past either is 429 with nothing re-sent', async () => {
    const owner = await paidOwner();
    const pending = await invited(owner.accountId, 'pending@example.com');
    as(owner);
    h.over = new Set(['ip']);
    const res = await resend(pending.seatId);
    expect(res.status).toBe(429);
    expect(h.limits.map((l) => l.key)).toEqual([
      `seat-invite:account:${owner.accountId}`,
      `seat-invite:ip:${sha256(IP)}`,
    ]);
    expect((await seat(pending.seatId)).invite_seq).toBe(1);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('GET /invite/[token]', () => {
  const land = (token: string) =>
    LAND(request(`/invite/${token}`, 'GET'), { params: Promise.resolve({ token }) });

  it('moves a token into the invitation’s cookie and sends the browser to /invite, reading nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://crawlmouse.com');
    const token = 'A'.repeat(43);
    const res = await land(token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://crawlmouse.com/invite');
    expect(setCookies(res)).toEqual([
      `cm_link_invite=${token}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`,
    ]);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(h.log).toEqual([]);
  });

  it('sets no cookie for a value that is not a token, and is a 404 with the flag unset', async () => {
    const res = await land('short');
    expect(res.status).toBe(303);
    expect(setCookies(res)).toEqual([]);
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await land('A'.repeat(43))).status).toBe(404);
  });
});

describe('POST /api/seats/accept', () => {
  const accept = (
    token: string | null,
    opts: { body?: string; type?: string; path?: string } = {},
  ) =>
    ACCEPT(
      request(
        opts.path ?? '/api/seats/accept',
        'POST',
        opts.body ?? (opts.type === FORM ? '' : '{}'),
        opts.type,
        token === null ? undefined : `other=1; cm_link_invite=${token}`,
      ),
    );

  it('with V2_CHECKS_PUBLIC unset: 404; signed out: 401 and no service-role client', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await accept('A'.repeat(43))).status).toBe(404);
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const res = await accept('A'.repeat(43));
    expect(res.status).toBe(401);
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('the invited person accepts: the seat is theirs, the switcher names the account, the link’s cookie is cleared', async () => {
    const owner = await paidOwner();
    const guest = await person(h.db, 'guest');
    const inv = await invited(owner.accountId, guest.email, 'account_manager');
    as(guest);
    const res = await accept(inv.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accountId: owner.accountId });
    expect(setCookies(res)).toEqual([
      `cm_account=${owner.accountId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`,
      'cm_link_invite=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    ]);
    expect(await seat(inv.seatId)).toMatchObject({
      status: 'active',
      user_id: guest.id,
      invite_token_hash: null,
    });
    expect(h.capture.mock.calls).toEqual([
      ['seat_accepted', owner.accountId, { role: 'account_manager' }],
    ]);

    // Used: the same link, even for the same person, is gone, and its cookie is cleared.
    const again = await accept(inv.token);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ code: 'invite_gone' });
    expect(setCookies(again)).toEqual([
      'cm_link_invite=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  it('a form is answered with a 303 to the dashboard, with the same two cookies', async () => {
    const owner = await paidOwner();
    const guest = await person(h.db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    as(guest);
    const res = await accept(inv.token, { type: FORM });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard');
    expect(setCookies(res).map((c) => c.split('=')[0])).toEqual(['cm_account', 'cm_link_invite']);
  });

  it('reads the token from the cookie alone: one in the body is 400, one in the address is not read', async () => {
    const owner = await paidOwner();
    const guest = await person(h.db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    as(guest);
    const inBody = await accept(null, { body: JSON.stringify({ token: inv.token }) });
    expect(inBody.status).toBe(400);
    const inUrl = await accept(null, { path: `/api/seats/accept?token=${inv.token}` });
    expect(inUrl.status).toBe(410);
    expect(await inUrl.json()).toEqual({ code: 'invite_gone' });
    expect((await seat(inv.seatId)).status).toBe('invited');
    expect(h.log.filter((l) => l.startsWith('admin.rpc'))).toEqual([]);
  });

  it('another person’s sign-in is 403, the cookie is kept, and the invited person can still accept', async () => {
    const owner = await paidOwner();
    const guest = await person(h.db, 'guest');
    const other = await person(h.db, 'other');
    const inv = await invited(owner.accountId, guest.email);
    as(other);
    const res = await accept(inv.token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'email_mismatch' });
    expect(setCookies(res)).toEqual([]);
    expect(await seat(inv.seatId)).toMatchObject({ status: 'invited', user_id: null });
    const form = await accept(inv.token, { type: FORM });
    expect(form.headers.get('location')).toBe('/invite?notice=email_mismatch');
    expect(h.capture).not.toHaveBeenCalled();
    as(guest);
    expect((await accept(inv.token)).status).toBe(200);
  });

  it('an expired link is 410', async () => {
    const owner = await paidOwner();
    const guest = await person(h.db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    await h.db.query(
      `update public.seats set invite_expires_at = now() - interval '1 second' where id = $1`,
      [inv.seatId],
    );
    as(guest);
    const res = await accept(inv.token);
    expect(res.status).toBe(410);
    expect((await seat(inv.seatId)).status).toBe('invited');
  });

  it('an account marked for deletion gains no member: 410, and the cookie is kept', async () => {
    const owner = await paidOwner();
    const guest = await person(h.db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    await h.db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [owner.accountId],
    );
    as(guest);
    const res = await accept(inv.token);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ code: 'invite_gone' });
    expect(setCookies(res)).toEqual([]);
    expect(await seat(inv.seatId)).toMatchObject({ status: 'invited', user_id: null });
  });

  it('no seat free is 409 invite_full; a seat already held is 409 already_member', async () => {
    const owner = await paidOwner('pro');
    const guest = await person(h.db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    await h.db.query(`update public.accounts set seat_limit = 1 where id = $1`, [owner.accountId]);
    as(guest);
    const full = await accept(inv.token);
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ code: 'invite_full' });

    await h.db.query(`update public.accounts set seat_limit = 5 where id = $1`, [owner.accountId]);
    await addSeat(h.db, owner.accountId, guest, 'developer');
    const held = await accept(inv.token);
    expect(held.status).toBe(409);
    expect(await held.json()).toEqual({ code: 'already_member' });
    expect((await seat(inv.seatId)).status).toBe('invited');
  });
});
