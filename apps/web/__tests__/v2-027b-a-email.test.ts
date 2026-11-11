import type { PGlite } from '@electric-sql/pglite';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../lib/auth/normalize-email';
import { EMAIL_CHANGE_LINK_MINUTES, EMAIL_UNDO_DAYS } from '../lib/v2/account/email-change-page';
import { hashToken, newToken } from '../lib/v2/account/tokens';
import {
  applyAllMigrations,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 027b's section A, the email change (D3, docs/specs/v2/27b-account-wiring.md): request,
 * apply, revert, and the undo's two steps, over the migrated schema.
 */

const MIGRATION = '20261112000002_v2_027b_account.sql';
const ROLLBACK = '20261112000002_v2_027b_account.revert.sql';

let db: PGlite;

// Applying every migration to a fresh PGlite takes several seconds, more under a parallel run.
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);
afterAll(async () => db.close());

let n = 0;
async function person(tag = 'p') {
  n += 1;
  const email = `${tag}${n}@example.com`;
  const userId = await signUp(db, email);
  const { accountId, seatId } = await personalAccount(db, userId);
  return { userId, accountId, seatId, email };
}

/** The mailer's call (CC-28): mints the row's token and returns it with its hash. */
async function issue(id: string) {
  const { rows } = await db.query<{ token: string }>(
    `select token from public.issue_account_link($1)`,
    [id],
  );
  const raw = rows[0]!.token;
  return { raw, hash: hashToken(raw) };
}

/** A database error's SQLSTATE, or 'none' when the call succeeded. */
async function sqlstate(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'none';
  } catch (e) {
    return String((e as { code?: unknown }).code);
  }
}

const NOW = () => new Date();
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** Asks for a change, then issues both of its links as the mailer would. */
async function request(p: { accountId: string; userId: string }, to: string, now = NOW()) {
  const { rows } = await db.query<{ r: { change_token_id: string; undo_token_id: string } }>(
    `select public.request_email_change($1, $2, $3, $4) as r`,
    [p.accountId, p.userId, to, now],
  );
  const { change_token_id: id, undo_token_id: undoId } = rows[0]!.r;
  return { id, ...(await issue(id)), undoId, undo: await issue(undoId) };
}

interface Applied {
  user_id: string;
  account_id: string;
  old_email: string;
  new_email: string;
  undo_token_id: string;
  tier: string;
}

/** Confirms a change, then issues the undo link as the mailer would. */
async function apply(hash: string, now = NOW()) {
  const { rows } = await db.query<{ r: Applied }>(`select public.apply_email_change($1, $2) as r`, [
    hash,
    now,
  ]);
  const applied = rows[0]!.r;
  return { applied, undo: await issue(applied.undo_token_id) };
}

const prepare = async (hash: string, now = NOW()) =>
  (
    await db.query<{ r: Record<string, unknown> }>(
      `select public.prepare_email_undo($1, $2) as r`,
      [hash, now],
    )
  ).rows[0]!.r;

/** `applied` is what prepare_email_undo said; most cases here undo an applied change. */
const undo = async (hash: string, now = NOW(), applied = true) =>
  (
    await db.query<{ r: Record<string, unknown> }>(
      `select public.undo_email_change($1, $2, $3) as r`,
      [hash, now, applied],
    )
  ).rows[0]!.r;

async function userRow(id: string) {
  const { rows } = await db.query<{
    email: string;
    email_normalized: string | null;
    previous_emails: string[];
  }>(`select email, email_normalized, previous_emails from public.users where id = $1`, [id]);
  return rows[0]!;
}

async function seatEmail(seatId: string) {
  const { rows } = await db.query<{ invited_email: string }>(
    `select invited_email from public.seats where id = $1`,
    [seatId],
  );
  return rows[0]!.invited_email;
}

async function events(accountId: string) {
  const { rows } = await db.query<{ kind: string }>(
    `select kind from public.account_events where account_id = $1 order by at, kind`,
    [accountId],
  );
  return rows.map((r) => r.kind);
}

async function token(id: string) {
  const { rows } = await db.query<{
    kind: string;
    new_email: string;
    old_email: string;
    expires_at: Date;
    used: boolean;
    revoked: boolean;
  }>(
    `select kind, new_email, old_email, expires_at, used_at is not null as used,
            revoked_at is not null as revoked from public.account_tokens where id = $1`,
    [id],
  );
  return rows[0]!;
}

describe('request_email_change', () => {
  it('creates the sixty-minute confirmation link and the old address’s undo link, and records the request', async () => {
    const p = await person();
    const now = NOW();
    const r = await request(p, 'moved@example.org', now);
    const u = await token(r.undoId);
    expect(u).toMatchObject({
      kind: 'email_change_undo',
      new_email: 'moved@example.org',
      old_email: p.email,
      used: false,
      revoked: false,
    });
    // The undo link outlives the confirmation link, so it can stop the change until the end.
    expect(u.expires_at.getTime()).toBe(
      minutes(now, EMAIL_CHANGE_LINK_MINUTES + EMAIL_UNDO_DAYS * 24 * 60).getTime(),
    );
    const t = await token(r.id);
    expect(t).toMatchObject({
      kind: 'email_change',
      new_email: 'moved@example.org',
      old_email: p.email,
      used: false,
      revoked: false,
    });
    expect(t.expires_at.getTime()).toBe(minutes(now, EMAIL_CHANGE_LINK_MINUTES).getTime());
    expect(await events(p.accountId)).toEqual(['email_change_requested']);
  });

  it('refuses the current address, in any case (CMA01)', async () => {
    const p = await person();
    expect(await sqlstate(request(p, p.email))).toBe('CMA01');
    await db.query(`update public.users set email = upper(email) where id = $1`, [p.userId]);
    expect(await sqlstate(request(p, p.email))).toBe('CMA01');
  });

  it('refuses an address that is not lowercase', async () => {
    const p = await person();
    expect(await sqlstate(request(p, 'Moved@example.org'))).toBe('22023');
  });

  it('refuses a second request while the first one’s confirmation link is live (CMA02)', async () => {
    const p = await person();
    const first = await request(p, 'first@example.org');
    expect(await sqlstate(request(p, 'second@example.org'))).toBe('CMA02');
    expect((await token(first.id)).revoked).toBe(false);
  });

  it('refuses a second request while an applied change’s undo link is live (CMA02)', async () => {
    const p = await person();
    const first = await request(p, 'first@example.org');
    await apply(first.hash);
    expect(await sqlstate(request(p, 'second@example.org'))).toBe('CMA02');
  });

  it('lets a request through once the first was never confirmed and its link expired, ending both old links', async () => {
    const p = await person();
    const first = await request(p, 'abandoned@example.org');
    const later = minutes(NOW(), EMAIL_CHANGE_LINK_MINUTES + 1);
    const { rows } = await db.query<{ r: { change_token_id: string } }>(
      `select public.request_email_change($1, $2, 'next@example.org', $3) as r`,
      [p.accountId, p.userId, later],
    );
    expect(rows[0]!.r.change_token_id).toBeTruthy();
    expect((await token(first.id)).revoked).toBe(true);
    expect((await token(first.undoId)).revoked).toBe(true);
  });

  it('turns a race past the check into CMA02 through the index', async () => {
    const p = await person();
    await request(p, 'first@example.org');
    // The check is skipped by a sweep that ages the first link, as a second transaction that read
    // before it committed would; the index still holds the account to one live link per kind.
    await db.query(
      `update public.account_tokens set expires_at = created_at + interval '1 millisecond'
        where account_id = $1 and kind = 'email_change'`,
      [p.accountId],
    );
    await db.query(
      `create function pg_temp.no_revoke() returns trigger language plpgsql as $f$
         begin if new.revoked_at is not null and old.revoked_at is null then return old; end if; return new; end $f$`,
    );
    await db.query(
      `create trigger keep_live before update on public.account_tokens
         for each row execute function pg_temp.no_revoke()`,
    );
    try {
      expect(await sqlstate(request(p, 'second@example.org'))).toBe('CMA02');
    } finally {
      await db.query(`drop trigger keep_live on public.account_tokens`);
    }
  });

  it('refuses an account marked for deletion (CMA03)', async () => {
    const p = await person();
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [p.accountId],
    );
    expect(await sqlstate(request(p, 'gone@example.org'))).toBe('CMA03');
  });
});

/** A second account the person owns (an agency they created), with its active owner seat. */
async function secondAccount(p: { userId: string; email: string }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.accounts (kind, state, tier, seat_limit, site_limit, state_history)
     values ('agency', 'free', 'free', 5, 5, '[{"state":"free","since":"2026-11-01T00:00:00.000Z"}]'::jsonb)
     returning id`,
  );
  const id = rows[0]!.id;
  await db.query(
    `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
     values ($1, $2, $3, 'owner', 'active', now())`,
    [id, p.userId, p.email],
  );
  return id;
}

describe('one email change in flight per person, across the accounts they own (fix round 1, C5)', () => {
  it('refuses a request from a second account while the first account’s confirmation link is live', async () => {
    const p = await person();
    const other = await secondAccount(p);
    await request(p, 'from-first@example.org');
    expect(
      await sqlstate(request({ accountId: other, userId: p.userId }, 'from-second@example.org')),
    ).toBe('CMA02');
  });

  it('refuses it while an applied change’s undo link is live on the first account', async () => {
    const p = await person();
    const other = await secondAccount(p);
    const r = await request(p, 'applied-first@example.org');
    await apply(r.hash);
    expect(
      await sqlstate(request({ accountId: other, userId: p.userId }, 'from-second@example.org')),
    ).toBe('CMA02');
  });

  it('lets it through once the first account’s request expired unconfirmed, ending its links', async () => {
    const p = await person();
    const other = await secondAccount(p);
    const first = await request(p, 'abandoned-first@example.org');
    const later = minutes(NOW(), EMAIL_CHANGE_LINK_MINUTES + 1);
    await db.query(`select public.request_email_change($1, $2, 'second@example.org', $3)`, [
      other,
      p.userId,
      later,
    ]);
    expect((await token(first.id)).revoked).toBe(true);
    expect((await token(first.undoId)).revoked).toBe(true);
  });

  it('holds the person to one live link of each kind in the index, whichever account it is on', async () => {
    const p = await person();
    const other = await secondAccount(p);
    await request(p, 'indexed@example.org');
    await expect(
      db.query(
        `insert into public.account_tokens (account_id, user_id, kind, new_email, old_email, expires_at)
         values ($1, $2, 'email_change', 'x@example.org', $3, now() + interval '1 hour')`,
        [other, p.userId, p.email],
      ),
    ).rejects.toThrow(/account_tokens_one_live_email_link_uq/);
  });
});

describe('apply_email_change', () => {
  it('moves the profile and the person’s seat, keeps the old address, and issues a seven-day undo link', async () => {
    const p = await person();
    const r = await request(p, 'new.name+work@googlemail.com');
    const now = NOW();
    const { applied } = await apply(r.hash, now);
    expect(applied).toMatchObject({
      user_id: p.userId,
      account_id: p.accountId,
      old_email: p.email,
      new_email: 'new.name+work@googlemail.com',
      tier: 'free',
    });
    expect(await userRow(p.userId)).toEqual({
      email: 'new.name+work@googlemail.com',
      // Worked by hand from normalize-email.ts: tag dropped, dots removed, googlemail folded.
      email_normalized: 'newname@gmail.com',
      previous_emails: [p.email],
    });
    expect(await seatEmail(p.seatId)).toBe('new.name+work@googlemail.com');
    expect(applied.undo_token_id).toBe(r.undoId);
    const u = await token(applied.undo_token_id);
    expect(u).toMatchObject({
      kind: 'email_change_undo',
      old_email: p.email,
      new_email: 'new.name+work@googlemail.com',
      used: false,
    });
    expect(u.expires_at.getTime()).toBe(minutes(now, EMAIL_UNDO_DAYS * 24 * 60).getTime());
    expect((await token(r.id)).used).toBe(true);
    expect(await events(p.accountId)).toEqual(['email_change_requested', 'email_changed']);
  });

  it('accepts a link once (CMA05 the second time)', async () => {
    const p = await person();
    const r = await request(p, 'once@example.org');
    await apply(r.hash);
    expect(await sqlstate(apply(r.hash))).toBe('CMA05');
  });

  it('refuses an expired link, and an undo link (CMA05)', async () => {
    const p = await person();
    const r = await request(p, 'late@example.org');
    expect(await sqlstate(apply(r.hash, minutes(NOW(), EMAIL_CHANGE_LINK_MINUTES + 1)))).toBe(
      'CMA05',
    );
    expect(await sqlstate(apply(r.undo.hash))).toBe('CMA05');
    const { applied } = await apply(r.hash);
    expect(applied.new_email).toBe('late@example.org');
  });

  it('refuses an address another sign-in user or profile holds, in any case, and leaves the link usable (CMA04)', async () => {
    const p = await person();
    const holder = await person('holder');
    const r = await request(p, holder.email);
    expect(await sqlstate(apply(r.hash))).toBe('CMA04');
    expect((await token(r.id)).used).toBe(false);

    await db.query(`update auth.users set email = upper(email) where id = $1`, [holder.userId]);
    expect(await sqlstate(apply(r.hash))).toBe('CMA04');

    const q = await person();
    const onlyProfile = await person('profile');
    await db.query(
      `update auth.users set email = 'elsewhere-' || id || '@example.net' where id = $1`,
      [onlyProfile.userId],
    );
    const r2 = await request(q, onlyProfile.email);
    expect(await sqlstate(apply(r2.hash))).toBe('CMA04');
  });

  it('refuses once the account is marked for deletion (CMA03)', async () => {
    const p = await person();
    const r = await request(p, 'marked@example.org');
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [p.accountId],
    );
    expect(await sqlstate(apply(r.hash))).toBe('CMA03');
  });
});

describe('revert_email_change', () => {
  it('puts the rows back, revokes the undo link, drops the event, and leaves the link used', async () => {
    const p = await person();
    const before = await userRow(p.userId);
    const r = await request(p, 'refused@example.org');
    const { applied } = await apply(r.hash);
    await db.query(`select public.revert_email_change($1)`, [applied.undo_token_id]);
    expect(await userRow(p.userId)).toEqual({
      ...before,
      email_normalized: normalizeEmail(p.email),
    });
    expect(await seatEmail(p.seatId)).toBe(p.email);
    expect((await token(applied.undo_token_id)).revoked).toBe(true);
    expect((await token(r.id)).used).toBe(true);
    expect(await events(p.accountId)).toEqual(['email_change_requested']);
    // The revoked undo link no longer blocks a new request.
    await request(p, 'again@example.org');
  });
});

describe('the undo', () => {
  it('moves the person back and keeps the address the change set in previous_emails', async () => {
    const p = await person();
    const r = await request(p, 'attacker@example.net');
    const { undo: u } = await apply(r.hash);
    expect(await prepare(u.hash)).toEqual({
      user_id: p.userId,
      account_id: p.accountId,
      old_email: p.email,
      applied: true,
      squatter: null,
    });
    expect(await undo(u.hash)).toEqual({
      user_id: p.userId,
      account_id: p.accountId,
      applied: true,
    });
    expect(await userRow(p.userId)).toEqual({
      email: p.email,
      email_normalized: normalizeEmail(p.email),
      previous_emails: ['attacker@example.net'],
    });
    expect(await seatEmail(p.seatId)).toBe(p.email);
    expect(await events(p.accountId)).toEqual([
      'email_change_requested',
      'email_changed',
      'email_change_undone',
    ]);
  });

  it('before the confirm, stops the change: the confirmation link no longer applies, and no row moves', async () => {
    const p = await person();
    const r = await request(p, 'pending@example.net');
    const before = await userRow(p.userId);
    expect(await prepare(r.undo.hash)).toMatchObject({ applied: false, squatter: null });
    expect(await undo(r.undo.hash, NOW(), false)).toEqual({
      user_id: p.userId,
      account_id: p.accountId,
      applied: false,
    });
    expect(await sqlstate(apply(r.hash))).toBe('CMA05');
    expect((await token(r.id)).revoked).toBe(true);
    expect(await userRow(p.userId)).toEqual(before);
    expect(await seatEmail(p.seatId)).toBe(p.email);
    expect(await events(p.accountId)).toEqual(['email_change_requested', 'email_change_undone']);
    // Both links are spent, so the person may ask again.
    await request(p, 'mine-after-all@example.net');
  });

  it('refuses to finish an undo prepared before the confirm once the change has applied (CMA06)', async () => {
    const p = await person();
    const r = await request(p, 'raced@example.net');
    expect(await prepare(r.undo.hash)).toMatchObject({ applied: false });
    await db.query(`select public.apply_email_change($1, $2)`, [r.hash, NOW()]);
    expect(await sqlstate(undo(r.undo.hash, NOW(), false))).toBe('CMA06');
    expect((await userRow(p.userId)).email).toBe('raced@example.net');
  });

  it('accepts its link once, before it expires, and not a confirmation link (CMA05)', async () => {
    const p = await person();
    const r = await request(p, 'twice@example.net');
    const { undo: u } = await apply(r.hash);
    expect(await sqlstate(prepare(u.hash, minutes(NOW(), 7 * 24 * 60 + 1)))).toBe('CMA05');
    expect(await sqlstate(undo(u.hash, minutes(NOW(), 7 * 24 * 60 + 1)))).toBe('CMA05');
    expect(await sqlstate(prepare(r.hash))).toBe('CMA05');
    expect(await sqlstate(undo(r.hash))).toBe('CMA05');
    await undo(u.hash);
    expect(await sqlstate(prepare(u.hash))).toBe('CMA05');
    expect(await sqlstate(undo(u.hash))).toBe('CMA05');
  });
});

describe('a sign-up of the old address made after the change (owner ruling Q10)', () => {
  /** A person whose address was changed, and a sign-up of their old address afterwards. */
  async function squatted(tag: string) {
    const p = await person();
    const r = await request(p, `${tag}@example.net`);
    const { undo: u } = await apply(r.hash);
    const squatter = await signUp(db, p.email);
    const { accountId } = await personalAccount(db, squatter);
    return { p, u, squatter, accountId };
  }

  const accountLeft = async (id: string) =>
    (await db.query(`select 1 from public.accounts where id = $1`, [id])).rows.length;

  it('a sign-up has the seat and account handle_new_user gives it, and nothing else', async () => {
    const { squatter, accountId } = await squatted('measure');
    const { rows } = await db.query<{ seats: number; role: string; is_default: boolean }>(
      `select count(*)::int seats, min(s.role) role, bool_and(s.account_id = u.default_account_id) is_default
         from public.seats s join public.users u on u.id = s.user_id where s.user_id = $1`,
      [squatter],
    );
    expect(rows[0]).toEqual({ seats: 1, role: 'owner', is_default: true });
    expect(await accountLeft(accountId)).toBe(1);
  });

  it('is cleared out of the way when all four conditions hold, and named', async () => {
    const { u, squatter, accountId } = await squatted('cleared');
    expect((await prepare(u.hash)).squatter).toBe(squatter);
    expect(await accountLeft(accountId)).toBe(0);
  });

  it('1: is refused when it was created before the change was applied', async () => {
    const { u, squatter, accountId } = await squatted('older');
    await db.query(`update auth.users set created_at = now() - interval '1 day' where id = $1`, [
      squatter,
    ]);
    expect(await sqlstate(prepare(u.hash))).toBe('CMA04');
    expect(await sqlstate(undo(u.hash))).toBe('CMA04');
    expect(await accountLeft(accountId)).toBe(1);
  });

  it('2: is refused when it has a seat beyond its own sign-up account', async () => {
    const { u, squatter, accountId } = await squatted('seated');
    const host = await person('host');
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'seated@example.org', 'developer', 'active', now())`,
      [host.accountId, squatter],
    );
    expect(await sqlstate(prepare(u.hash))).toBe('CMA04');
    expect(await accountLeft(accountId)).toBe(1);
  });

  it('3: is refused when it has an audit, a session, or an account that holds something', async () => {
    const cases: [string, (s: { squatter: string; accountId: string }) => Promise<unknown>][] = [
      [
        'audit',
        (s) =>
          db.query(`insert into public.audits (user_id, url) values ($1, 'https://a.example')`, [
            s.squatter,
          ]),
      ],
      [
        'session',
        (s) =>
          db.query(
            `insert into public.sessions (user_id, expires_at) values ($1, now() + interval '1 day')`,
            [s.squatter],
          ),
      ],
      [
        'site',
        (s) =>
          db.query(`insert into public.sites (account_id, host) values ($1, 'kept.example')`, [
            s.accountId,
          ]),
      ],
    ];
    for (const [tag, add] of cases) {
      const s = await squatted(`holds-${tag}`);
      await add(s);
      expect(await sqlstate(prepare(s.u.hash)), tag).toBe('CMA04');
      expect(await accountLeft(s.accountId), tag).toBe(1);
    }
  });

  it('4: is refused when it is banned', async () => {
    const { u, squatter, accountId } = await squatted('banned');
    await db.query(
      `update auth.users set banned_until = now() + interval '100 years' where id = $1`,
      [squatter],
    );
    expect(await sqlstate(prepare(u.hash))).toBe('CMA04');
    expect(await accountLeft(accountId)).toBe(1);
  });
});

describe('a link row before the mailer issues it', () => {
  it('holds no token, and no token confirms it', async () => {
    const p = await person();
    const { rows } = await db.query<{ id: string }>(
      `select public.request_email_change($1, $2, 'unissued@example.org', now()) ->> 'change_token_id' as id`,
      [p.accountId, p.userId],
    );
    const { rows: row } = await db.query(
      `select token_hash, issued_at from public.account_tokens where id = $1`,
      [rows[0]!.id],
    );
    expect(row).toEqual([{ token_hash: null, issued_at: null }]);
    expect(await sqlstate(apply(hashToken(newToken())))).toBe('CMA05');
    const { rows: after } = await db.query<{ used: boolean }>(
      `select used_at is not null as used from public.account_tokens where id = $1`,
      [rows[0]!.id],
    );
    expect(after).toEqual([{ used: false }]);
  });

  it('a retried send gives a new token, and the earlier one stops confirming', async () => {
    const p = await person();
    const r = await request(p, 'retried@example.org');
    const again = await issue(r.id);
    expect(again.raw).not.toBe(r.raw);
    expect(await sqlstate(apply(r.hash))).toBe('CMA05');
    expect((await apply(again.hash)).applied.new_email).toBe('retried@example.org');
  });
});

describe('normalize_email', () => {
  const sql = async (email: string) =>
    (await db.query<{ v: string }>(`select public.normalize_email($1) v`, [email])).rows[0]!.v;

  it('matches hand-worked values of the ledger rule', async () => {
    expect(await sql('a.b+tag@gmail.com')).toBe('ab@gmail.com');
    expect(await sql('a.b@googlemail.com')).toBe('ab@gmail.com');
    expect(await sql('a.b+tag@example.com')).toBe('a.b@example.com');
    expect(await sql('+only@example.com')).toBe('+only@example.com');
    expect(await sql('x@y@example.com')).toBe('x@y@example.com');
  });

  it('agrees with lib/auth/normalize-email.ts on lowercase addresses', async () => {
    const domain = fc.constantFrom(
      'gmail.com',
      'googlemail.com',
      'example.com',
      'mail.example.org',
    );
    const local = fc.stringMatching(/^[a-z0-9.+_-]{1,20}$/);
    await fc.assert(
      fc.asyncProperty(local, domain, async (l, d) => {
        const email = `${l}@${d}`;
        expect(await sql(email)).toBe(normalizeEmail(email));
      }),
      { numRuns: 200 },
    );
  });
});

describe('what the clients can reach', () => {
  it('grants anon and authenticated nothing on section A’s functions', async () => {
    const { rows } = await db.query<{ role: string; fn: string }>(
      `select r.role, p.oid::regprocedure::text as fn
         from (values ('anon'), ('authenticated'), ('public')) r(role)
         cross join pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('normalize_email', 'email_held_by_other', 'request_email_change',
                            'apply_email_change', 'revert_email_change', 'prepare_email_undo',
                            'undo_email_change')
          and (case when r.role = 'public'
                    then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                    else has_function_privilege(r.role, p.oid, 'execute') end)`,
    );
    expect(rows).toEqual([]);
    const { rows: count } = await db.query<{ n: number }>(
      `select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('normalize_email', 'email_held_by_other', 'request_email_change',
                          'apply_email_change', 'revert_email_change', 'prepare_email_undo',
                          'undo_email_change')`,
    );
    expect(count[0]!.n).toBe(7);
  });

  it('sets the search_path on each and grants service_role execute', async () => {
    const { rows } = await db.query<{ fn: string; config: string[] | null; ok: boolean }>(
      `select proname as fn, proconfig as config, has_function_privilege('service_role', oid, 'execute') as ok
         from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('normalize_email', 'email_held_by_other', 'request_email_change',
                          'apply_email_change', 'revert_email_change', 'prepare_email_undo',
                          'undo_email_change')`,
    );
    for (const r of rows) {
      expect([r.fn, r.config, r.ok]).toEqual([
        r.fn,
        ['search_path=pg_catalog, public, pg_temp'],
        true,
      ]);
    }
  });
});

describe('the file', () => {
  it('applies twice, and its rollback removes section A’s functions', async () => {
    const twice = await freshDb();
    try {
      await applyAllMigrations(twice);
      await twice.exec(readMigration(MIGRATION));
      await twice.exec(readRollback(ROLLBACK));
      const { rows } = await twice.query<{ n: number }>(
        `select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace
            and proname in ('normalize_email', 'email_held_by_other', 'request_email_change',
                            'apply_email_change', 'revert_email_change', 'prepare_email_undo',
                            'undo_email_change')`,
      );
      expect(rows[0]!.n).toBe(0);
    } finally {
      await twice.close();
    }
  }, 120_000);
});
