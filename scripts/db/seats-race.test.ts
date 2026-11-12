import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two real transactions racing in migration 20261114000002's section A, on a real Postgres:
 * `invite_seat` with one seat left, and `accept_seat_invite` with one seat left. Run like
 * scripts/db/sites-race.test.ts: against TRIAL_RACE_DB_URL (a Postgres on this machine), required
 * when TRIAL_RACE_REQUIRED=1, skipped otherwise, because PGlite has one backend and cannot hold two
 * transactions open at once.
 *
 * Each race holds transaction A open after its call, starts B's call, waits until B is seen waiting
 * on a lock (or the watch runs out), commits A, and lets B finish. The same races also run against a
 * database built from the migration with the function's lock on the account row taken out, where
 * both calls must pass: those are the mutation checks, run whenever the file runs.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261114000002_v2_031_agency.sql';
/** invite_seat's read of the account row, with its lock. */
const INVITE_LOCK =
  '    into v_deleted, v_marked, v_limit\n    from public.accounts a\n   where a.id = p_account\n     for update;\n';
const INVITE_UNLOCKED =
  '    into v_deleted, v_marked, v_limit\n    from public.accounts a\n   where a.id = p_account;\n';
/** accept_seat_invite's read of the account row, with its lock. */
const ACCEPT_LOCK = '    from public.accounts a where a.id = v_account for update;\n';
const ACCEPT_UNLOCKED = '    from public.accounts a where a.id = v_account;\n';

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;
/** How long to watch for B waiting. */
const WAIT_WATCH_MS = 2000;

type Sql = postgres.Sql;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration, this one's text edited by `edit`. */
async function migrated(admin: Sql, name: string, edit: (sql: string) => string = (s) => s) {
  const { PLATFORM_SHIM, migrationFiles, readMigration } =
    await import('../../apps/web/__tests__/helpers/pglite-migrations');
  await admin.unsafe(`create database ${name}`);
  const sql = postgres(urlFor(URL_ENV!, name), { max: 4, onnotice: () => {} });
  // Roles are cluster-wide: the second database finds the first one's.
  const shim = PLATFORM_SHIM.replace(
    /create role (\w+)([^;]*);/g,
    (_m, role: string, opts: string) =>
      `do $r$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role}${opts}; end if; end $r$;`,
  );
  await sql.unsafe(shim).simple();
  for (const f of migrationFiles()) {
    const text = readMigration(f);
    await sql.unsafe(f === MIGRATION ? edit(text) : text).simple();
  }
  return sql;
}

/** The migration with `lock` replaced, refusing to build unless the text is there exactly once. */
const without =
  (lock: string, replacement: string) =>
  (text: string): string => {
    if (text.split(lock).length !== 2) {
      throw new Error(`the lock to remove is not in ${MIGRATION} exactly once`);
    }
    return text.replace(lock, replacement);
  };

/** A signed-up user with their personal account, given `seatLimit` seats. */
async function person(sql: Sql, seatLimit?: number) {
  const email = `race-${randomUUID()}@example.com`;
  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`;
  const [a] =
    await sql`select default_account_id as account_id from public.users where id = ${u!.id}`;
  const accountId = a!.account_id as string;
  if (seatLimit !== undefined) {
    await sql`update public.accounts set seat_limit = ${seatLimit} where id = ${accountId}`;
  }
  return { id: u!.id as string, email, accountId };
}

type Call = (t: postgres.ReservedSql) => Promise<string>;

/** A's call commits only after B's call has been seen waiting on a lock (or the watch ran out). */
async function race(sql: Sql, a: Call, b: Call) {
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    const [{ pid }] = (await tb`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
    await ta`begin`;
    await ta`set local role service_role`;
    const ra = await a(ta);
    await tb`begin`;
    await tb`set local role service_role`;
    // Settled at once, so B failing while A holds its lock is not an unhandled rejection.
    const pending = b(tb).then(
      (outcome) => ({ outcome }),
      (error: unknown) => ({ error }),
    );
    let waited = false;
    for (const until = Date.now() + WAIT_WATCH_MS; Date.now() < until && !waited; ) {
      const [w] =
        await sql`select exists (select 1 from pg_locks where pid = ${pid} and not granted) as w`;
      waited = w!.w as boolean;
      if (!waited) await new Promise((r) => setTimeout(r, 25));
    }
    await ta`commit`;
    const settled = await pending;
    if ('error' in settled) throw settled.error;
    await tb`commit`;
    return { a: ra, b: settled.outcome, waited };
  } finally {
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

const outcomeOf = (rows: postgres.Row[]) => (rows[0]!.r as { outcome: string }).outcome;

const invite =
  (accountId: string, email: string): Call =>
  async (t) =>
    outcomeOf(
      await t`select public.invite_seat(${accountId}, ${email}, 'developer', null, 100, now()) as r`,
    );

const accept =
  (token: string, userId: string): Call =>
  async (t) =>
    outcomeOf(
      await t`select public.accept_seat_invite(${createHash('sha256').update(token).digest('hex')},
                                               ${userId}, now()) as r`,
    );

const seatCount = async (sql: Sql, accountId: string, statuses: string[]) =>
  Number(
    (
      await sql`select count(*) as n from public.seats
                 where account_id = ${accountId} and status = any(${statuses})`
    )[0]!.n,
  );

describe.skipIf(!URL_ENV)('section A under two real transactions', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = {
    real: `cc31a_seats_race_${suffix}`,
    inviteUnlocked: `cc31a_seats_race_invite_unlocked_${suffix}`,
    acceptUnlocked: `cc31a_seats_race_accept_unlocked_${suffix}`,
  };
  let admin: Sql;
  let real: Sql;
  let inviteUnlocked: Sql;
  let acceptUnlocked: Sql;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    real = await migrated(admin, names.real);
    inviteUnlocked = await migrated(
      admin,
      names.inviteUnlocked,
      without(INVITE_LOCK, INVITE_UNLOCKED),
    );
    acceptUnlocked = await migrated(
      admin,
      names.acceptUnlocked,
      without(ACCEPT_LOCK, ACCEPT_UNLOCKED),
    );
  }, 3 * HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await real?.end({ timeout: 5 });
    await inviteUnlocked?.end({ timeout: 5 });
    await acceptUnlocked?.end({ timeout: 5 });
    for (const n of Object.values(names))
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  /** Two invitations to an account of two seats whose owner holds one. */
  async function inviteRace(sql: Sql) {
    const owner = await person(sql, 2);
    const r = await race(
      sql,
      invite(owner.accountId, `a-${randomUUID()}@example.com`),
      invite(owner.accountId, `b-${randomUUID()}@example.com`),
    );
    return { ...r, held: await seatCount(sql, owner.accountId, ['invited', 'active']) };
  }

  /** Two people accepting their invitations after the account's limit fell to one seat free. */
  async function acceptRace(sql: Sql) {
    const owner = await person(sql, 3);
    const guests = [await person(sql), await person(sql)];
    const tokens: string[] = [];
    for (const g of guests) {
      const [i] =
        await sql`select public.invite_seat(${owner.accountId}, ${g.email}, 'developer', null, 100, now()) as r`;
      const seat = i!.r as { seat_id: string; seq: number };
      const [link] =
        await sql`select token from public.issue_seat_invite(${seat.seat_id}, ${seat.seq}, now())`;
      tokens.push(link!.token as string);
    }
    await sql`update public.accounts set seat_limit = 2 where id = ${owner.accountId}`;
    const r = await race(sql, accept(tokens[0]!, guests[0]!.id), accept(tokens[1]!, guests[1]!.id));
    return { ...r, active: await seatCount(sql, owner.accountId, ['active']) };
  }

  it(
    'two invitations for the last seat: the second waits for the first, then is full; two seats held',
    async () => {
      const r = await inviteRace(real);
      expect(r.waited, 'B waited on the account lock while A held it').toBe(true);
      expect([r.a, r.b]).toEqual(['invited', 'full']);
      expect(r.held).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation check: without invite_seat’s account lock, both invitations pass the limit',
    async () => {
      const r = await inviteRace(inviteUnlocked);
      expect(r.waited).toBe(false);
      expect([r.a, r.b]).toEqual(['invited', 'invited']);
      expect(r.held).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'two acceptances for the last seat: the second waits for the first, then is full; two active seats',
    async () => {
      const r = await acceptRace(real);
      expect(r.waited, 'B waited on the account lock while A held it').toBe(true);
      expect([r.a, r.b]).toEqual(['accepted', 'full']);
      expect(r.active).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation check: without accept_seat_invite’s account lock, both acceptances pass the limit',
    async () => {
      const r = await acceptRace(acceptUnlocked);
      expect(r.waited).toBe(false);
      expect([r.a, r.b]).toEqual(['accepted', 'accepted']);
      expect(r.active).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );
});
