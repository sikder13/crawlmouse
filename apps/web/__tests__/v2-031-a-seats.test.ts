import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addSeat,
  keptSite,
  makePaid,
  person,
  removeSeat,
  type Person,
} from '../lib/v2/account/sites-test-support';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';

/**
 * Migration 031's section A (docs/specs/v2/31-agency.md §6): the invitation's columns and the seat
 * functions, run as `service_role` on PGlite with every migration applied. Each test builds its own
 * account, so none reads another's seats. The limit under two transactions is
 * scripts/db/seats-race.test.ts.
 */

const MIGRATION = '20261114000002_v2_031_agency.sql';
const ROLLBACK = '20261114000002_v2_031_agency.revert.sql';
const NOW = '2026-11-12T12:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.parse(NOW) + days * DAY_MS).toISOString();
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

const FUNCTIONS = [
  'public.seat_scope_valid(uuid, uuid[])',
  'public.invite_seat(uuid, text, text, uuid[], integer, timestamptz)',
  'public.issue_seat_invite(uuid, integer, timestamptz)',
  'public.resend_seat_invite(uuid, uuid)',
  'public.read_seat_invite(text, timestamptz)',
  'public.accept_seat_invite(text, uuid, timestamptz)',
  'public.change_seat(uuid, uuid, text, uuid[])',
  'public.remove_seat(uuid, uuid, timestamptz)',
] as const;

type Answer = { outcome: string } & Record<string, unknown>;

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);
afterAll(async () => db.close());

/** One statement as the service role, the only role the functions are granted to. */
const service = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  asRole(db, 'service_role', null, async (tx) => (await tx.query<T>(sql, params)).rows);

const answer = async (sql: string, params: unknown[]): Promise<Answer> =>
  (await service<{ r: Answer }>(sql, params))[0]!.r;

/** A uuid[] parameter as its text form, or null for "every client". */
const ids = (v: string[] | null) => (v === null ? null : `{${v.join(',')}}`);

const invite = (
  accountId: string,
  email: string,
  opts: { role?: string; sites?: string[] | null; cap?: number; now?: string } = {},
) =>
  answer(`select public.invite_seat($1, $2, $3, $4::uuid[], $5, $6) r`, [
    accountId,
    email,
    opts.role ?? 'developer',
    ids(opts.sites ?? null),
    opts.cap ?? 100,
    opts.now ?? NOW,
  ]);

interface Issued {
  token: string;
  email: string;
  account_name: string | null;
  role: string;
  expires_at: string;
}

const issue = (seatId: unknown, seq: unknown, now = NOW) =>
  service<Issued>(
    `select token, email, account_name, role,
            to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') expires_at
       from public.issue_seat_invite($1, $2, $3)`,
    [seatId, seq, now],
  );

const read = (token: string, now = NOW) =>
  answer(`select public.read_seat_invite($1, $2) r`, [sha256(token), now]);

const accept = (token: string, userId: string, now = NOW) =>
  answer(`select public.accept_seat_invite($1, $2, $3) r`, [sha256(token), userId, now]);

const resend = (seatId: string, accountId: string) =>
  answer(`select public.resend_seat_invite($1, $2) r`, [seatId, accountId]);

const change = (seatId: string, accountId: string, role: string, sites: string[] | null = null) =>
  answer(`select public.change_seat($1, $2, $3, $4::uuid[]) r`, [
    seatId,
    accountId,
    role,
    ids(sites),
  ]);

const remove = (seatId: string, accountId: string) =>
  answer(`select public.remove_seat($1, $2, $3) r`, [seatId, accountId, NOW]);

interface SeatRow {
  id: string;
  user_id: string | null;
  invited_email: string;
  role: string;
  status: string;
  client_scope_all: boolean;
  invite_token_hash: string | null;
  invite_expires_at: Date | null;
  invite_seq: number;
  accepted_at: Date | null;
  removed_at: Date | null;
}

const seat = async (id: unknown): Promise<SeatRow> =>
  (await db.query<SeatRow>(`select * from public.seats where id = $1`, [id])).rows[0]!;

const seatsOf = async (accountId: string) =>
  (
    await db.query<{ invited_email: string; status: string }>(
      `select invited_email, status from public.seats where account_id = $1 order by created_at, invited_email`,
      [accountId],
    )
  ).rows;

const scopeOf = async (seatId: unknown) =>
  (
    await db.query<{ site_id: string }>(
      `select site_id from public.seat_sites where seat_id = $1 order by 1`,
      [seatId],
    )
  ).rows.map((r) => r.site_id);

const mark = (accountId: string) =>
  db.query(
    `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
    [accountId],
  );
const unmark = (accountId: string) =>
  db.query(
    `update public.accounts set deletion_confirmed_at = null, purge_after = null where id = $1`,
    [accountId],
  );

/** An owner on a paid plan: Agency has five seats, Pro two. */
async function paidOwner(tier: 'pro' | 'agency' = 'agency'): Promise<Person> {
  const owner = await person(db, 'owner');
  await makePaid(db, owner.accountId, tier);
  return owner;
}

/** Invites `email` and issues its link: the seat and the token the mail would carry. */
async function invited(accountId: string, email: string, opts: Parameters<typeof invite>[2] = {}) {
  const r = await invite(accountId, email, opts);
  expect(r.outcome).toBe('invited');
  const [link] = await issue(r.seat_id, r.seq, opts.now ?? NOW);
  return { seatId: r.seat_id as string, seq: r.seq as number, token: link!.token };
}

describe('the invitation’s columns', () => {
  it('are read by no client role: invite_token_hash, invite_expires_at and invite_seq', async () => {
    const owner = await paidOwner();
    const denied: string[] = [];
    for (const column of ['invite_token_hash', 'invite_expires_at', 'invite_seq']) {
      for (const role of ['anon', 'authenticated'] as const) {
        await asRole(db, role, role === 'anon' ? null : owner.id, (tx) =>
          tx.query(`select ${column} from public.seats`),
        ).catch((e: { code?: string }) => {
          if (e.code === '42501') denied.push(`${role}:${column}`);
        });
      }
    }
    expect(denied).toEqual([
      'anon:invite_token_hash',
      'authenticated:invite_token_hash',
      'anon:invite_expires_at',
      'authenticated:invite_expires_at',
      'anon:invite_seq',
      'authenticated:invite_seq',
    ]);
    // The same caller reads a granted column, so the refusals above are the columns' and not the table's.
    await asRole(db, 'authenticated', owner.id, (tx) => tx.query(`select id from public.seats`));
  });

  it('hold a hash only on an invited seat, with an expiry, as 64 lowercase hex characters', async () => {
    const owner = await paidOwner();
    const { seatId } = await invited(owner.accountId, 'shape@example.com');
    const set = (assignments: string, id: string) =>
      db
        .query(`update public.seats set ${assignments} where id = $1`, [id])
        .then(() => 'ok')
        .catch((e: { constraint?: string }) => e.constraint ?? 'error');
    const hash = `'${'a'.repeat(64)}'`;
    expect(await set(`invite_token_hash = ${hash}, invite_expires_at = now()`, owner.seatId)).toBe(
      'seats_invite_token',
    );
    expect(await set(`invite_token_hash = ${hash}, invite_expires_at = null`, seatId)).toBe(
      'seats_invite_token',
    );
    expect(await set(`invite_token_hash = null`, seatId)).toBe('seats_invite_token');
    expect(await set(`invite_token_hash = 'A${'a'.repeat(63)}'`, seatId)).toBe(
      'seats_invite_token',
    );
    expect(await set(`invite_token_hash = '${'a'.repeat(63)}'`, seatId)).toBe('seats_invite_token');
    expect(await set(`invite_token_hash = ${hash}, invite_expires_at = now()`, seatId)).toBe('ok');
  });
});

describe('invite_seat', () => {
  it('writes an invited seat for every client: the address in lower case, invitation 1, no link yet', async () => {
    const owner = await paidOwner();
    const r = await invite(owner.accountId, '  Dana.Okafor@Example.com ', {
      role: 'account_manager',
    });
    expect(r).toEqual({ outcome: 'invited', seat_id: expect.any(String), seq: 1 });
    expect(await seat(r.seat_id)).toMatchObject({
      user_id: null,
      invited_email: 'dana.okafor@example.com',
      role: 'account_manager',
      status: 'invited',
      client_scope_all: true,
      invite_token_hash: null,
      invite_expires_at: null,
      invite_seq: 1,
      accepted_at: null,
      removed_at: null,
    });
    expect(await scopeOf(r.seat_id)).toEqual([]);
  });

  it('scopes a seat to the sites named, each once', async () => {
    const owner = await paidOwner();
    const [a, b] = [await keptSite(db, owner.accountId), await keptSite(db, owner.accountId)];
    const r = await invite(owner.accountId, 'scoped@example.com', { sites: [a.id, b.id, a.id] });
    expect(r.outcome).toBe('invited');
    expect((await seat(r.seat_id)).client_scope_all).toBe(false);
    expect(await scopeOf(r.seat_id)).toEqual([a.id, b.id].sort());
  });

  it('answers invalid_scope for no site, another account’s site, a removed site, a staging copy and a null id', async () => {
    const owner = await paidOwner();
    const other = await paidOwner();
    const mine = await keptSite(db, owner.accountId);
    const theirs = await keptSite(db, other.accountId);
    const gone = await keptSite(db, owner.accountId, { removed_at: NOW });
    const staging = await keptSite(db, owner.accountId, { staging_of_site_id: mine.id });
    const outcomes: Record<string, string> = {};
    for (const [name, sites] of [
      ['none', []],
      ['another account’s', [mine.id, theirs.id]],
      ['removed', [gone.id]],
      ['staging', [staging.id]],
    ] as const) {
      outcomes[name] = (
        await invite(owner.accountId, 'x@example.com', { sites: [...sites] })
      ).outcome;
    }
    outcomes.null = (
      await answer(
        `select public.invite_seat($1, 'x@example.com', 'developer', array[$2::uuid, null], 100, $3) r`,
        [owner.accountId, mine.id, NOW],
      )
    ).outcome;
    expect(outcomes).toEqual({
      none: 'invalid_scope',
      'another account’s': 'invalid_scope',
      removed: 'invalid_scope',
      staging: 'invalid_scope',
      null: 'invalid_scope',
    });
    expect(await seatsOf(owner.accountId)).toHaveLength(1);
  });

  it('answers exists for an address already invited, in any case, and writes nothing', async () => {
    const owner = await paidOwner();
    await invite(owner.accountId, 'twice@example.com');
    expect(await invite(owner.accountId, 'TWICE@example.com')).toEqual({ outcome: 'exists' });
    expect(await seatsOf(owner.accountId)).toHaveLength(2);
  });

  it('answers exists for the current address of an active member, whatever address they were invited at', async () => {
    const owner = await paidOwner();
    const member = await person(db, 'member');
    await addSeat(db, owner.accountId, member, 'developer');
    await db.query(`update public.seats set invited_email = 'old@example.com' where user_id = $1`, [
      member.id,
    ]);
    expect(await invite(owner.accountId, member.email.toUpperCase())).toEqual({
      outcome: 'exists',
    });
    expect(await invite(owner.accountId, owner.email)).toEqual({ outcome: 'exists' });
  });

  it('treats a plus-address as another address', async () => {
    const owner = await paidOwner();
    const [local, domain] = owner.email.split('@');
    expect((await invite(owner.accountId, `${local}+team@${domain}`)).outcome).toBe('invited');
  });

  it('answers full at the limit, counting active seats and invited ones, an expired invitation included', async () => {
    const owner = await paidOwner('pro');
    const first = await invited(owner.accountId, 'first@example.com');
    expect(await invite(owner.accountId, 'second@example.com')).toEqual({ outcome: 'full' });
    // Eight days on, the first link has expired and its seat still holds the place.
    expect((await read(first.token, at(8))).outcome).toBe('gone');
    expect(await invite(owner.accountId, 'second@example.com', { now: at(8) })).toEqual({
      outcome: 'full',
    });
    expect(await seatsOf(owner.accountId)).toEqual([
      { invited_email: owner.email, status: 'active' },
      { invited_email: 'first@example.com', status: 'invited' },
    ]);
  });

  it('applies the lower of the stored limit and the cap it is given', async () => {
    const agency = await paidOwner('agency');
    expect(await invite(agency.accountId, 'capped@example.com', { cap: 1 })).toEqual({
      outcome: 'full',
    });
    const pro = await paidOwner('pro');
    await invite(pro.accountId, 'one@example.com', { cap: 100 });
    expect(await invite(pro.accountId, 'two@example.com', { cap: 100 })).toEqual({
      outcome: 'full',
    });
  });

  it('writes a removed seat of the same address back to invited, as its next invitation', async () => {
    const owner = await paidOwner();
    const leaver = await person(db, 'leaver');
    const [a, b] = [await keptSite(db, owner.accountId), await keptSite(db, owner.accountId)];
    const seatId = await addSeat(db, owner.accountId, leaver, 'account_manager', [a.id]);
    await db.query(`update public.seats set invite_seq = 3 where id = $1`, [seatId]);
    expect((await remove(seatId, owner.accountId)).outcome).toBe('removed');

    const r = await invite(owner.accountId, leaver.email, { role: 'developer', sites: [b.id] });
    expect(r).toEqual({ outcome: 'invited', seat_id: seatId, seq: 4 });
    expect(await seat(seatId)).toMatchObject({
      user_id: null,
      role: 'developer',
      status: 'invited',
      client_scope_all: false,
      accepted_at: null,
      removed_at: null,
      invite_seq: 4,
    });
    expect(await scopeOf(seatId)).toEqual([b.id]);
    expect(await seatsOf(owner.accountId)).toHaveLength(2);
  });

  it('refuses to bring back a removed seat when the account is full', async () => {
    const owner = await paidOwner('pro');
    const leaver = await person(db, 'leaver');
    const seatId = await addSeat(db, owner.accountId, leaver, 'developer');
    await remove(seatId, owner.accountId);
    await invite(owner.accountId, 'taken@example.com');
    expect(await invite(owner.accountId, leaver.email)).toEqual({ outcome: 'full' });
    expect(await seat(seatId)).toMatchObject({ status: 'removed', user_id: leaver.id });
  });

  it('answers marked for an account marked for deletion, and writes nothing', async () => {
    const owner = await paidOwner();
    await mark(owner.accountId);
    expect(await invite(owner.accountId, 'late@example.com')).toEqual({ outcome: 'marked' });
    expect(await seatsOf(owner.accountId)).toHaveLength(1);
    await unmark(owner.accountId);
    expect((await invite(owner.accountId, 'late@example.com')).outcome).toBe('invited');
  });

  it('raises for an owner role, an unknown role, a value that is not an address, and a deleted account', async () => {
    const owner = await paidOwner();
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );
    expect(await code(invite(owner.accountId, 'a@example.com', { role: 'owner' }))).toBe('22023');
    expect(await code(invite(owner.accountId, 'a@example.com', { role: 'admin' }))).toBe('22023');
    expect(await code(invite(owner.accountId, 'not an address'))).toBe('22023');
    expect(await code(invite(owner.accountId, 'a@b@example.com'))).toBe('22023');
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [
      owner.accountId,
    ]);
    expect(await code(invite(owner.accountId, 'a@example.com'))).toBe('P0002');
    expect(await seatsOf(owner.accountId)).toHaveLength(1);
  });
});

describe('issue_seat_invite', () => {
  it('returns a 43-character token once, stores its sha256 and an expiry seven days on, and what the mail says', async () => {
    const owner = await paidOwner();
    await db.query(`update public.accounts set name = 'Summit Digital' where id = $1`, [
      owner.accountId,
    ]);
    const r = await invite(owner.accountId, 'dana@example.com', { role: 'account_manager' });
    const rows = await issue(r.seat_id, 1);
    expect(rows).toEqual([
      {
        token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        email: 'dana@example.com',
        account_name: 'Summit Digital',
        role: 'account_manager',
        expires_at: at(7),
      },
    ]);
    const row = await seat(r.seat_id);
    expect(row.invite_token_hash).toBe(sha256(rows[0]!.token));
    expect(row.invite_expires_at!.toISOString()).toBe(at(7));
    // The raw token is in no column of the row.
    expect(JSON.stringify(row)).not.toContain(rows[0]!.token);
  });

  it('issuing again replaces the link: the earlier token is gone and the later one reads', async () => {
    const owner = await paidOwner();
    const first = await invited(owner.accountId, 'again@example.com');
    const [second] = await issue(first.seatId, first.seq);
    expect(second!.token).not.toBe(first.token);
    expect((await read(first.token)).outcome).toBe('gone');
    expect((await read(second!.token)).outcome).toBe('invite');
  });

  it('returns no row for a superseded number, a seat that is not invited, an unknown seat and a marked account', async () => {
    const owner = await paidOwner();
    const member = await person(db, 'member');
    const active = await addSeat(db, owner.accountId, member, 'developer');
    const r = await invite(owner.accountId, 'pending@example.com');
    expect(await issue(r.seat_id, 0)).toEqual([]);
    expect(await issue(r.seat_id, 2)).toEqual([]);
    expect(await issue(active, 0)).toEqual([]);
    expect(await issue(owner.accountId, 1)).toEqual([]);
    await mark(owner.accountId);
    expect(await issue(r.seat_id, 1)).toEqual([]);
    expect((await seat(r.seat_id)).invite_token_hash).toBeNull();
    await unmark(owner.accountId);
    expect(await issue(r.seat_id, 1)).toHaveLength(1);
  });
});

describe('resend_seat_invite', () => {
  it('moves to the next invitation and ends the link sent before', async () => {
    const owner = await paidOwner();
    const first = await invited(owner.accountId, 'resend@example.com');
    expect(await resend(first.seatId, owner.accountId)).toEqual({ outcome: 'resent', seq: 2 });
    expect(await seat(first.seatId)).toMatchObject({
      status: 'invited',
      invite_seq: 2,
      invite_token_hash: null,
      invite_expires_at: null,
    });
    expect((await read(first.token)).outcome).toBe('gone');
    // The mail of the first invitation, retried after the resend, issues nothing.
    expect(await issue(first.seatId, 1)).toEqual([]);
    const [link] = await issue(first.seatId, 2);
    expect((await read(link!.token)).outcome).toBe('invite');
  });

  it('answers not_found for another account’s seat and a removed one, not_invited for an active one, marked for a marked account', async () => {
    const owner = await paidOwner();
    const other = await paidOwner();
    const member = await person(db, 'member');
    const active = await addSeat(db, owner.accountId, member, 'developer');
    const pending = await invite(owner.accountId, 'pending@example.com');
    const theirs = await invite(other.accountId, 'theirs@example.com');
    const gone = await invite(owner.accountId, 'gone@example.com');
    await remove(gone.seat_id as string, owner.accountId);

    expect(await resend(theirs.seat_id as string, owner.accountId)).toEqual({
      outcome: 'not_found',
    });
    expect((await seat(theirs.seat_id)).invite_seq).toBe(1);
    expect(await resend(gone.seat_id as string, owner.accountId)).toEqual({ outcome: 'not_found' });
    expect(await resend(active, owner.accountId)).toEqual({ outcome: 'not_invited' });
    await mark(owner.accountId);
    expect(await resend(pending.seat_id as string, owner.accountId)).toEqual({ outcome: 'marked' });
    expect((await seat(pending.seat_id)).invite_seq).toBe(1);
  });
});

describe('read_seat_invite', () => {
  it('says the account’s name, the role and whether the seat covers every client, and no address', async () => {
    const owner = await paidOwner();
    await db.query(`update public.accounts set name = 'Summit Digital' where id = $1`, [
      owner.accountId,
    ]);
    const site = await keptSite(db, owner.accountId);
    const all = await invited(owner.accountId, 'all@example.com', { role: 'account_manager' });
    const some = await invited(owner.accountId, 'some@example.com', { sites: [site.id] });
    expect(await read(all.token)).toEqual({
      outcome: 'invite',
      account_name: 'Summit Digital',
      role: 'account_manager',
      scope_all: true,
    });
    expect(await read(some.token)).toEqual({
      outcome: 'invite',
      account_name: 'Summit Digital',
      role: 'developer',
      scope_all: false,
    });
  });

  it('is gone for an unknown token, an expired link, a removed seat, a marked account and a deleted one', async () => {
    const owner = await paidOwner();
    const live = await invited(owner.accountId, 'live@example.com');
    const removed = await invited(owner.accountId, 'removed@example.com');
    await remove(removed.seatId, owner.accountId);
    const gone = { outcome: 'gone' };
    expect(await read('x'.repeat(43))).toEqual(gone);
    expect((await read(live.token, at(6.9))).outcome).toBe('invite');
    expect(await read(live.token, at(7))).toEqual(gone);
    expect(await read(removed.token)).toEqual(gone);
    await mark(owner.accountId);
    expect(await read(live.token)).toEqual(gone);
    await unmark(owner.accountId);
    expect((await read(live.token)).outcome).toBe('invite');
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [
      owner.accountId,
    ]);
    expect(await read(live.token)).toEqual(gone);
  });
});

describe('accept_seat_invite', () => {
  const memberOf = (userId: string, accountId: string) =>
    asRole(db, 'authenticated', userId, async (tx) => {
      const { rows } = await tx.query<{ v: boolean }>(`select public.is_member($1) v`, [accountId]);
      return rows[0]!.v;
    });

  it('makes the seat active for the invited person, once', async () => {
    const owner = await paidOwner();
    const guest = await person(db, 'guest');
    const inv = await invited(owner.accountId, guest.email.toUpperCase(), {
      role: 'account_manager',
    });
    expect(await memberOf(guest.id, owner.accountId)).toBe(false);

    expect(await accept(inv.token, guest.id)).toEqual({
      outcome: 'accepted',
      account_id: owner.accountId,
      seat_id: inv.seatId,
      role: 'account_manager',
    });
    const row = await seat(inv.seatId);
    expect(row).toMatchObject({
      status: 'active',
      user_id: guest.id,
      invite_token_hash: null,
      invite_expires_at: null,
    });
    expect(row.accepted_at!.toISOString()).toBe(NOW);
    expect(await memberOf(guest.id, owner.accountId)).toBe(true);

    // The link is used: neither the same person nor anyone else accepts it again.
    expect(await accept(inv.token, guest.id)).toEqual({ outcome: 'gone' });
    expect(await read(inv.token)).toEqual({ outcome: 'gone' });
  });

  it('refuses an expired link', async () => {
    const owner = await paidOwner();
    const guest = await person(db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    expect(await accept(inv.token, guest.id, at(7))).toEqual({ outcome: 'gone' });
    expect((await seat(inv.seatId)).status).toBe('invited');
    expect(await memberOf(guest.id, owner.accountId)).toBe(false);
  });

  it('refuses another person’s sign-in, and leaves the invitation for the right one', async () => {
    const owner = await paidOwner();
    const guest = await person(db, 'guest');
    const other = await person(db, 'other');
    const inv = await invited(owner.accountId, guest.email);
    expect(await accept(inv.token, other.id)).toEqual({ outcome: 'email_mismatch' });
    expect(await seat(inv.seatId)).toMatchObject({ status: 'invited', user_id: null });
    expect(await memberOf(other.id, owner.accountId)).toBe(false);
    expect((await accept(inv.token, guest.id)).outcome).toBe('accepted');
  });

  it('refuses a user with no profile row', async () => {
    const owner = await paidOwner();
    const inv = await invited(owner.accountId, 'nobody@example.com');
    expect(await accept(inv.token, owner.accountId)).toEqual({ outcome: 'email_mismatch' });
  });

  it('answers marked for an account marked for deletion, and accepts once the mark is cleared', async () => {
    const owner = await paidOwner();
    const guest = await person(db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    await mark(owner.accountId);
    expect(await accept(inv.token, guest.id)).toEqual({ outcome: 'marked' });
    expect(await seat(inv.seatId)).toMatchObject({ status: 'invited', user_id: null });
    await unmark(owner.accountId);
    expect((await accept(inv.token, guest.id)).outcome).toBe('accepted');
  });

  it('is gone for a deleted account', async () => {
    const owner = await paidOwner();
    const guest = await person(db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [
      owner.accountId,
    ]);
    expect(await accept(inv.token, guest.id)).toEqual({ outcome: 'gone' });
  });

  it('answers full when the account’s limit fell below its active seats, and changes nothing', async () => {
    const owner = await paidOwner('pro');
    const guest = await person(db, 'guest');
    // A seat the guest held before, removed under another address: accepting would take its user_id.
    const former = await addSeat(db, owner.accountId, guest, 'developer');
    await removeSeat(db, former);
    await db.query(`update public.seats set invited_email = 'former@example.com' where id = $1`, [
      former,
    ]);
    const inv = await invited(owner.accountId, guest.email);
    await db.query(`update public.accounts set seat_limit = 1 where id = $1`, [owner.accountId]);

    expect(await accept(inv.token, guest.id)).toEqual({ outcome: 'full' });
    expect(await seat(inv.seatId)).toMatchObject({ status: 'invited', user_id: null });
    expect((await seat(former)).user_id).toBe(guest.id);
    expect((await read(inv.token)).outcome).toBe('invite');

    await db.query(`update public.accounts set seat_limit = 2 where id = $1`, [owner.accountId]);
    expect((await accept(inv.token, guest.id)).outcome).toBe('accepted');
    expect((await seat(former)).user_id).toBeNull();
    expect((await seat(inv.seatId)).user_id).toBe(guest.id);
  });

  it('answers already_member for a person who holds an active seat on the account', async () => {
    const owner = await paidOwner();
    const guest = await person(db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    const held = await addSeat(db, owner.accountId, guest, 'developer');
    expect(await accept(inv.token, guest.id)).toEqual({ outcome: 'already_member' });
    expect((await seat(inv.seatId)).status).toBe('invited');
    expect((await seat(held)).status).toBe('active');
  });
});

describe('change_seat', () => {
  it('changes the role and the scope of an active seat and of an invited one', async () => {
    const owner = await paidOwner();
    const member = await person(db, 'member');
    const [a, b] = [await keptSite(db, owner.accountId), await keptSite(db, owner.accountId)];
    const active = await addSeat(db, owner.accountId, member, 'developer', [a.id]);
    const pending = await invite(owner.accountId, 'pending@example.com');

    expect(await change(active, owner.accountId, 'account_manager', [b.id])).toEqual({
      outcome: 'changed',
    });
    expect(await seat(active)).toMatchObject({
      role: 'account_manager',
      client_scope_all: false,
      status: 'active',
    });
    expect(await scopeOf(active)).toEqual([b.id]);

    expect((await change(active, owner.accountId, 'developer', null)).outcome).toBe('changed');
    expect(await seat(active)).toMatchObject({ role: 'developer', client_scope_all: true });
    expect(await scopeOf(active)).toEqual([]);

    await change(pending.seat_id as string, owner.accountId, 'account_manager', [a.id]);
    expect(await seat(pending.seat_id)).toMatchObject({
      role: 'account_manager',
      client_scope_all: false,
      status: 'invited',
      invite_seq: 1,
    });
  });

  it('does not demote the owner, and makes no seat an owner', async () => {
    const owner = await paidOwner();
    const member = await person(db, 'member');
    const active = await addSeat(db, owner.accountId, member, 'developer');
    expect(await change(owner.seatId, owner.accountId, 'developer')).toEqual({ outcome: 'owner' });
    expect(await seat(owner.seatId)).toMatchObject({ role: 'owner', status: 'active' });
    await expect(change(active, owner.accountId, 'owner')).rejects.toMatchObject({ code: '22023' });
    expect((await seat(active)).role).toBe('developer');
  });

  it('answers not_found for another account’s seat and a removed one, invalid_scope for another account’s site, marked for a marked account', async () => {
    const owner = await paidOwner();
    const other = await paidOwner();
    const member = await person(db, 'member');
    const theirMember = await person(db, 'their-member');
    const active = await addSeat(db, owner.accountId, member, 'developer');
    const theirs = await addSeat(db, other.accountId, theirMember, 'developer');
    const theirSite = await keptSite(db, other.accountId);
    const leaver = await person(db, 'leaver');
    const gone = await addSeat(db, owner.accountId, leaver, 'developer');
    await removeSeat(db, gone);

    expect(await change(theirs, owner.accountId, 'account_manager')).toEqual({
      outcome: 'not_found',
    });
    expect((await seat(theirs)).role).toBe('developer');
    expect(await change(gone, owner.accountId, 'account_manager')).toEqual({
      outcome: 'not_found',
    });
    expect(await change(active, owner.accountId, 'developer', [theirSite.id])).toEqual({
      outcome: 'invalid_scope',
    });
    expect((await seat(active)).client_scope_all).toBe(true);
    await mark(owner.accountId);
    expect(await change(active, owner.accountId, 'account_manager')).toEqual({ outcome: 'marked' });
    expect((await seat(active)).role).toBe('developer');
  });
});

describe('remove_seat', () => {
  it('removes a member: the seat, its scope, and its sites go to the owner’s seat', async () => {
    const owner = await paidOwner();
    const member = await person(db, 'member');
    const [a, b] = [await keptSite(db, owner.accountId), await keptSite(db, owner.accountId)];
    const seatId = await addSeat(db, owner.accountId, member, 'account_manager', [a.id]);
    await db.query(`update public.sites set owner_seat_id = $2 where id = $1`, [a.id, seatId]);

    expect(await remove(seatId, owner.accountId)).toEqual({ outcome: 'removed' });
    const row = await seat(seatId);
    expect(row).toMatchObject({ status: 'removed', user_id: member.id });
    expect(row.removed_at!.toISOString()).toBe(NOW);
    expect(await scopeOf(seatId)).toEqual([]);
    const owning = await db.query<{ id: string; owner_seat_id: string | null }>(
      `select id, owner_seat_id from public.sites where id in ($1, $2) order by created_at, id`,
      [a.id, b.id],
    );
    expect(Object.fromEntries(owning.rows.map((r) => [r.id, r.owner_seat_id]))).toEqual({
      [a.id]: owner.seatId,
      [b.id]: null,
    });
    expect(await remove(seatId, owner.accountId)).toEqual({ outcome: 'not_found' });
  });

  it('ends the person’s access at once: is_member, is_member_for_site and seat_may', async () => {
    const owner = await paidOwner();
    const member = await person(db, 'member');
    const site = await keptSite(db, owner.accountId);
    const seatId = await addSeat(db, owner.accountId, member, 'account_manager');
    const access = () =>
      asRole(db, 'authenticated', member.id, async (tx) => {
        const { rows } = await tx.query<Record<string, boolean>>(
          `select public.is_member($1) member, public.is_member_for_site($2) site,
                  public.seat_may($1, 'export_report') may`,
          [owner.accountId, site.id],
        );
        return rows[0];
      });
    expect(await access()).toEqual({ member: true, site: true, may: true });
    await remove(seatId, owner.accountId);
    expect(await access()).toEqual({ member: false, site: false, may: false });
  });

  it('removes an invitation, and its link is gone', async () => {
    const owner = await paidOwner();
    const guest = await person(db, 'guest');
    const inv = await invited(owner.accountId, guest.email);
    expect(await remove(inv.seatId, owner.accountId)).toEqual({ outcome: 'removed' });
    expect(await seat(inv.seatId)).toMatchObject({
      status: 'removed',
      invite_token_hash: null,
      invite_expires_at: null,
    });
    expect(await accept(inv.token, guest.id)).toEqual({ outcome: 'gone' });
  });

  it('does not remove the owner', async () => {
    const owner = await paidOwner();
    expect(await remove(owner.seatId, owner.accountId)).toEqual({ outcome: 'owner' });
    expect(await seat(owner.seatId)).toMatchObject({ role: 'owner', status: 'active' });
  });

  it('answers not_found for a seat of another account, and leaves it', async () => {
    const owner = await paidOwner();
    const other = await paidOwner();
    const theirMember = await person(db, 'their-member');
    const theirs = await addSeat(db, other.accountId, theirMember, 'developer');
    expect(await remove(theirs, owner.accountId)).toEqual({ outcome: 'not_found' });
    expect((await seat(theirs)).status).toBe('active');
  });

  it('answers marked for a marked account', async () => {
    const owner = await paidOwner();
    const member = await person(db, 'member');
    const seatId = await addSeat(db, owner.accountId, member, 'developer');
    await mark(owner.accountId);
    expect(await remove(seatId, owner.accountId)).toEqual({ outcome: 'marked' });
    expect((await seat(seatId)).status).toBe('active');
  });
});

describe('grants', () => {
  it('lets service_role execute each function of the section, and no client role or PUBLIC', async () => {
    const { rows } = await db.query<{ f: string; role: string; can: boolean }>(
      `select f.f, r.role, has_function_privilege(r.role, f.f, 'EXECUTE') can
         from unnest($1::text[]) f(f)
        cross join (values ('anon'), ('authenticated'), ('public'), ('service_role')) r(role)`,
      [`{${FUNCTIONS.map((f) => `"${f}"`).join(',')}}`],
    );
    const may: Record<string, string[]> = {};
    for (const r of rows) if (r.can) (may[r.f] ??= []).push(r.role);
    expect(may).toEqual(Object.fromEntries(FUNCTIONS.map((f) => [f, ['service_role']])));
  });

  it('refuses a signed-in client that calls one directly', async () => {
    const owner = await paidOwner();
    await expect(
      asRole(db, 'authenticated', owner.id, (tx) =>
        tx.query(`select public.invite_seat($1, 'x@example.com', 'developer', null, 100, now())`, [
          owner.accountId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asRole(db, 'authenticated', owner.id, (tx) =>
        tx.query(`select public.remove_seat($1, $2, now())`, [owner.seatId, owner.accountId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('pins the search_path of each to pg_catalog, pg_temp', async () => {
    const { rows } = await db.query<{ f: string; config: string[] | null }>(
      `select f.f, p.proconfig config from unnest($1::text[]) f(f)
         join pg_proc p on p.oid = f.f::regprocedure`,
      [`{${FUNCTIONS.map((f) => `"${f}"`).join(',')}}`],
    );
    expect(Object.fromEntries(rows.map((r) => [r.f, r.config]))).toEqual(
      Object.fromEntries(FUNCTIONS.map((f) => [f, ['search_path=pg_catalog, pg_temp']])),
    );
  });
});

describe('the migration', () => {
  it('applies twice, reverts to no seat function and no invitation column, reverts twice, and applies again', async () => {
    const state = async () => ({
      functions: (
        await db.query<{ proname: string }>(
          `select proname from pg_proc
            where pronamespace = 'public'::regnamespace
              and proname in ('seat_scope_valid', 'invite_seat', 'issue_seat_invite', 'resend_seat_invite',
                              'read_seat_invite', 'accept_seat_invite', 'change_seat', 'remove_seat')
            order by 1`,
        )
      ).rows.map((r) => r.proname),
      columns: (
        await db.query<{ attname: string }>(
          `select attname from pg_attribute
            where attrelid = 'public.seats'::regclass and attname ~ '^invite_' and not attisdropped
            order by 1`,
        )
      ).rows.map((r) => r.attname),
      constraint: (
        await db.query(
          `select 1 from pg_constraint where conrelid = 'public.seats'::regclass and conname = 'seats_invite_token'`,
        )
      ).rows.length,
      index: (
        await db.query(
          `select 1 from pg_indexes where schemaname = 'public' and indexname = 'seats_invite_token_hash_uq'`,
        )
      ).rows.length,
    });
    const applied = {
      functions: [
        'accept_seat_invite',
        'change_seat',
        'invite_seat',
        'issue_seat_invite',
        'read_seat_invite',
        'remove_seat',
        'resend_seat_invite',
        'seat_scope_valid',
      ],
      columns: ['invite_expires_at', 'invite_seq', 'invite_token_hash'],
      constraint: 1,
      index: 1,
    };
    const reverted = { functions: [], columns: ['invite_token_hash'], constraint: 0, index: 0 };

    await db.exec(readMigration(MIGRATION));
    expect(await state()).toEqual(applied);
    await db.exec(readRollback(ROLLBACK));
    expect(await state()).toEqual(reverted);
    await db.exec(readRollback(ROLLBACK));
    expect(await state()).toEqual(reverted);
    await db.exec(readMigration(MIGRATION));
    expect(await state()).toEqual(applied);
  });
});
