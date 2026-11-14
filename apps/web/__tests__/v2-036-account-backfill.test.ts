/**
 * CC-36, migration 20261116000002 (owner ruling 1): handle_new_user's account part becomes
 * provision_default_account, and every users row from before migration 001 gets what a sign-up gets.
 * Everything runs the real migration and revert files on PGlite, over a database migrated up to the
 * file before this one, as production is before the apply. The race with a sign-up needs two backends
 * and is scripts/db/account-backfill-race.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  freshDb,
  MIGRATIONS_DIR,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';

const MIGRATION = '20261116000002_v2_036_account_backfill.sql';
const ROLLBACK = '20261116000002_v2_036_account_backfill.revert.sql';
const FINGERPRINT = readFileSync(resolve(MIGRATIONS_DIR, '../checks/fingerprint.sql'), 'utf8');

/** Every migration before this one: the schema production holds when the owner applies it. */
let base: PGlite;
const open: PGlite[] = [];
beforeAll(async () => {
  base = await freshDb();
  await applyAllMigrations(base, undefined, (f) => f < MIGRATION);
}, 600_000);
afterEach(async () => {
  for (const db of open.splice(0)) await db.close();
});
afterAll(async () => base?.close());

async function clone(): Promise<PGlite> {
  const db = (await base.clone()) as PGlite;
  open.push(db);
  return db;
}
const migrate = (db: PGlite) => db.exec(readMigration(MIGRATION));

/** A sign-up: the auth.users insert, which fires handle_new_user. */
async function signUp(db: PGlite, email: string, id: string = randomUUID()): Promise<string> {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  return id;
}

/**
 * A user as production holds the pre-001 ones: an auth row and a users row, no account, no seat, no
 * default account, no email_normalized. The sign-up trigger is held off for the insert, which is how
 * those rows came to exist before 001 extended it.
 */
async function legacyUser(db: PGlite, email: string, proUntil: string | null = null) {
  const id = randomUUID();
  await db.exec(`alter table auth.users disable trigger on_auth_user_created`);
  try {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    await db.query(`insert into public.users (id, email, pro_until) values ($1, $2, $3)`, [
      id,
      email,
      proUntil,
    ]);
  } finally {
    await db.exec(`alter table auth.users enable trigger on_auth_user_created`);
  }
  return id;
}

type Row = Record<string, unknown>;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A row with its ids and times replaced by their kind, so two databases' rows compare. */
function shape(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => {
      if (v instanceof Date) return [k, '<time>'];
      if (typeof v === 'string' && ID.test(v)) return [k, '<id>'];
      if (k === 'state_history') {
        return [
          k,
          (v as { state: string; since: string }[]).map((e) => ({ ...e, since: '<time>' })),
        ];
      }
      return [k, v];
    }),
  );
}

/** The users row, the account it defaults to and the seats it holds, each linked to the others. */
async function provisioned(db: PGlite, userId: string) {
  const user = (await db.query<Row>(`select * from public.users where id = $1`, [userId])).rows[0]!;
  const accounts = (
    await db.query<Row>(
      `select a.* from public.accounts a
        where a.id = $1 or a.id in (select account_id from public.seats where user_id = $2)`,
      [user.default_account_id, userId],
    )
  ).rows;
  const seats = (await db.query<Row>(`select * from public.seats where user_id = $1`, [userId]))
    .rows;
  return { user, accounts, seats };
}

/** What the backfill must leave alone, read whole. */
async function untouched(db: PGlite) {
  const read = async (sql: string) => JSON.stringify((await db.query(sql)).rows);
  return {
    auth: await read(`select * from auth.users order by id`),
    proUntil: await read(`select id, pro_until from public.users order by id`),
    audits: await read(`select * from public.audits order by id`),
    reports: await read(`select * from public.public_reports order by slug`),
    ledger: await read(`select * from public.trial_ledger order by id`),
    mail: await read(`select * from public.email_sends order by id`),
  };
}

/** Every row of the tables the migration writes. */
async function written(db: PGlite) {
  const read = async (sql: string) => JSON.stringify((await db.query(sql)).rows);
  return {
    users: await read(`select * from public.users order by id`),
    accounts: await read(`select * from public.accounts order by id`),
    seats: await read(`select * from public.seats order by id`),
  };
}

describe('a sign-up is what it was before 20261116000002', () => {
  it('gets the same users row, account and owner seat, column for column', async () => {
    const before = await clone();
    const after = await clone();
    await migrate(after);
    const id = randomUUID();
    // Mixed case, so a path that changed the address on its way to the seat would show.
    await signUp(before, 'Same.Case@Example.com', id);
    await signUp(after, 'Same.Case@Example.com', id);
    const a = await provisioned(before, id);
    const b = await provisioned(after, id);
    // The comparison is of something: one account and one seat, linked.
    expect(a.accounts).toHaveLength(1);
    expect(a.seats).toHaveLength(1);
    expect(a.user.default_account_id).toBe(a.accounts[0]!.id);
    expect(a.seats[0]!.account_id).toBe(a.accounts[0]!.id);
    expect(b.user.default_account_id).toBe(b.accounts[0]!.id);
    expect(b.seats[0]!.account_id).toBe(b.accounts[0]!.id);
    expect(shape(b.user)).toEqual(shape(a.user));
    expect(b.accounts.map(shape)).toEqual(a.accounts.map(shape));
    expect(b.seats.map(shape)).toEqual(a.seats.map(shape));
    // handle_new_user leaves email_normalized as it was: null for a sign-up, before and after.
    expect(b.user.email_normalized).toBeNull();
  });
});

describe('the backfill', () => {
  it('gives a pre-001 user the account, owner seat and default account a sign-up gets', async () => {
    const db = await clone();
    const legacy = await legacyUser(db, 'Old.Timer+v1@Example.com');
    expect((await provisioned(db, legacy)).accounts).toEqual([]);
    await migrate(db);

    const got = await provisioned(db, legacy);
    expect(got.accounts).toHaveLength(1);
    expect(got.user.default_account_id).toBe(got.accounts[0]!.id);
    expect(got.seats).toHaveLength(1);
    expect(got.seats[0]).toMatchObject({
      account_id: got.accounts[0]!.id,
      user_id: legacy,
      invited_email: 'Old.Timer+v1@Example.com',
      role: 'owner',
      status: 'active',
    });

    // Column for column what a sign-up gets, after this migration and before it; the address is
    // another (users.email is unique), so the seat's invited_email is compared above, not here.
    const seat = ({ invited_email: _, ...rest }: Row) => shape(rest);
    for (const reference of [db, await clone()]) {
      const fresh = await provisioned(reference, await signUp(reference, 'new@example.com'));
      expect(got.accounts.map(shape)).toEqual(fresh.accounts.map(shape));
      expect(got.seats.map(seat)).toEqual(fresh.seats.map(seat));
    }
    expect(got.accounts[0]).toMatchObject({
      state: 'free',
      tier: 'free',
      trial_variant: null,
      trial_ends_at: null,
      trial_used_at: null,
    });
  });

  it('fills email_normalized where it is null, with normalize_email, and keeps one already set', async () => {
    const db = await clone();
    const legacy = await legacyUser(db, ' A.D.A+v1@GoogleMail.com ');
    const withAccount = await signUp(db, 'Has.Account@gmail.com');
    const set = await signUp(db, 'kept@example.com');
    await db.query(
      `update public.users set email_normalized = 'chosen@example.com' where id = $1`,
      [set],
    );
    await migrate(db);
    const normalized = async (id: string) =>
      (
        await db.query<{ n: string | null }>(
          `select email_normalized n from public.users where id = $1`,
          [id],
        )
      ).rows[0]!.n;
    // Typed by hand from the rule (lib/auth/normalize-email.ts): lowercased, trimmed, tag dropped,
    // gmail dots dropped and googlemail folded into gmail.
    expect(await normalized(legacy)).toBe('ada@gmail.com');
    expect(await normalized(withAccount)).toBe('hasaccount@gmail.com');
    expect(await normalized(set)).toBe('chosen@example.com');
  });

  it('leaves a user who has a default account with that one account and nothing more', async () => {
    const db = await clone();
    const id = await signUp(db, 'has@example.com');
    const before = await provisioned(db, id);
    await migrate(db);
    const after = await provisioned(db, id);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.seats).toEqual(before.seats);
    expect(after.user.default_account_id).toBe(before.user.default_account_id);
  });

  it('a second run changes nothing', async () => {
    const db = await clone();
    await legacyUser(db, 'first@example.com');
    await legacyUser(db, 'second@example.com');
    await signUp(db, 'signed@example.com');
    await migrate(db);
    const once = await written(db);
    expect(JSON.parse(once.accounts)).toHaveLength(3);
    await migrate(db);
    expect(await written(db)).toEqual(once);
  });

  it('starts no trial, writes no ledger row or mail, and leaves auth, pro_until, audits and reports as they were', async () => {
    const db = await clone();
    const pro = await legacyUser(db, 'pro@example.com', '2026-11-15T00:00:00Z');
    const other = await legacyUser(db, 'other@example.com');
    const auditId = randomUUID();
    await db.query(
      `insert into public.audits (id, user_id, url, status, score, grade)
       values ($1, $2, 'https://shop.example/', 'completed', 81.5, 'B')`,
      [auditId, pro],
    );
    await db.query(
      `insert into public.public_reports (slug, audit_id, domain, report_snapshot)
       values ('shop-example', $1, 'shop.example', '{"grade":"B"}')`,
      [auditId],
    );
    const before = await untouched(db);
    await migrate(db);
    expect(await untouched(db)).toEqual(before);
    // The comparison is of something: the rows are there, and the backfill did run.
    expect(JSON.parse(before.audits)).toHaveLength(1);
    expect(JSON.parse(before.proUntil)).toHaveLength(2);
    for (const id of [pro, other]) {
      expect((await provisioned(db, id)).accounts.map((a) => a.state)).toEqual(['free']);
    }
  });

  it('nothing fires on an insert into accounts or seats, or an update of users', async () => {
    // So no trigger can start a trial or queue mail from the backfill's writes. Read from the
    // catalog after the migration, user-defined triggers only.
    const db = await clone();
    await migrate(db);
    const { rows } = await db.query<{ tgname: string; table: string }>(
      `select t.tgname, c.relname as table
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal
          and c.oid in ('public.accounts'::regclass, 'public.seats'::regclass, 'public.users'::regclass)
          and ((t.tgtype & 4) <> 0 and c.relname in ('accounts', 'seats')
               or (t.tgtype & 16) <> 0 and c.relname = 'users')
        order by 1`,
    );
    expect(rows).toEqual([]);
  });
});

describe('provision_default_account', () => {
  it('is a security definer function that searches pg_catalog first and pg_temp last', async () => {
    const db = await clone();
    await migrate(db);
    const { rows } = await db.query<{ definer: boolean; config: string[] }>(
      `select prosecdef as definer, proconfig as config from pg_proc
        where oid = 'public.provision_default_account(uuid, text)'::regprocedure`,
    );
    expect(rows).toEqual([{ definer: true, config: ['search_path=pg_catalog, public, pg_temp'] }]);
  });

  it('answers null and writes nothing for a user who already has a default account', async () => {
    // The key the lock re-reads after a wait: a sign-up that committed first leaves a default account.
    const db = await clone();
    await migrate(db);
    const id = await signUp(db, 'twice@example.com');
    const before = await written(db);
    const { rows } = await db.query<{ account: string | null }>(
      `select public.provision_default_account($1, 'twice@example.com') as account`,
      [id],
    );
    expect(rows).toEqual([{ account: null }]);
    expect(await written(db)).toEqual(before);
  });

  it('no role may execute it, service_role included', async () => {
    const db = await clone();
    await migrate(db);
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      const { rows } = await db.query<{ may: boolean }>(
        `select has_function_privilege($1, 'public.provision_default_account(uuid, text)', 'EXECUTE') as may`,
        [role],
      );
      expect(rows[0]!.may, role).toBe(false);
    }
  });

  it('handle_new_user keeps its grants: service_role only', async () => {
    const db = await clone();
    const acl = async () =>
      (
        await db.query<{ acl: string }>(
          `select proacl::text acl from pg_proc where oid = 'public.handle_new_user()'::regprocedure`,
        )
      ).rows[0]!.acl;
    const before = await acl();
    await migrate(db);
    expect(await acl()).toBe(before);
    expect(before).toContain('service_role=X');
  });
});

describe('the revert of 20261116000002', () => {
  type Sections = Record<string, string>;
  const read = async (db: PGlite): Promise<Sections> =>
    Object.fromEntries(
      (await db.query<{ section: string; md5: string }>(FINGERPRINT)).rows.map((r) => [
        r.section,
        r.md5,
      ]),
    );
  const differing = (a: Sections, b: Sections) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((s) => a[s] !== b[s]).sort();

  it('gives back the fingerprint the migration found, and the migration applied again gives its own', async () => {
    const db = await clone();
    const before = await read(db);
    await migrate(db);
    const applied = await read(db);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    expect(differing(before, applied)).toEqual(['acls', 'functions']);

    await db.exec(readRollback(ROLLBACK));
    expect(differing(before, await read(db))).toEqual([]);

    await migrate(db);
    expect(differing(applied, await read(db))).toEqual([]);
  });

  it('keeps the backfilled accounts, and a sign-up after it still gets one account', async () => {
    const db = await clone();
    const legacy = await legacyUser(db, 'kept-after-revert@example.com');
    await migrate(db);
    const backfilled = await provisioned(db, legacy);
    await db.exec(readRollback(ROLLBACK));
    expect(await provisioned(db, legacy)).toEqual(backfilled);
    const fresh = await provisioned(db, await signUp(db, 'after-revert@example.com'));
    expect(fresh.accounts).toHaveLength(1);
    expect(fresh.seats).toHaveLength(1);
  });
});
