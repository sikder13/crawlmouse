import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Migration 20261116000002 on a real Postgres: a sign-up and the backfill racing for one users row
 * that has no account. The case they share is handle_new_user meeting a users row that already
 * exists (its `on conflict (id) do nothing`), so the row is written first with no auth.users row and
 * the sign-up is that auth.users insert. Run like scripts/db/seats-race.test.ts: against
 * TRIAL_RACE_DB_URL (a Postgres on this machine), required when TRIAL_RACE_REQUIRED=1, skipped
 * otherwise, because PGlite has one backend and cannot hold two transactions open at once.
 *
 * Each race holds transaction A open after its statement, starts B's, waits until B is seen waiting
 * on a lock (or the watch runs out), commits A, and lets B finish. Both orders run, and both again
 * against a database built with provision_default_account's `for update` taken out: that is the
 * mutation check, run whenever the file runs. Without the lock the sign-up-first order makes two
 * accounts; the backfill-first order makes one, for the reason its case states.
 *
 * The shared row is constructed: in production a users row always has its auth.users row
 * (`users_id_auth_fkey`), so a real sign-up's row is either committed with its account before the
 * backfill reads, or not visible to it. What this proves is the lock's behaviour if the two ever meet
 * on one row; that production does not reach that state is the first guard.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261116000002_v2_036_account_backfill.sql';
/** provision_default_account's read of the users row, with its lock. */
const LOCK =
  '  perform 1 from public.users where id = p_user_id and default_account_id is null for update;\n';
const UNLOCKED =
  '  perform 1 from public.users where id = p_user_id and default_account_id is null;\n';

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 300_000;
/** How long to watch for B waiting. */
const WAIT_WATCH_MS = 2000;

type Sql = postgres.Sql;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

async function migrationText(): Promise<string> {
  const { readMigration } = await import('../../apps/web/__tests__/helpers/pglite-migrations');
  return readMigration(MIGRATION);
}

/**
 * The backfill as the migration runs it: its one `select public.provision_default_account(...)`
 * statement, taken from the file so the race runs the shipped text.
 */
async function backfillStatement(): Promise<string> {
  const found = (await migrationText()).match(
    /^select public\.provision_default_account\(u\.id, u\.email\)$[^;]*;/gm,
  );
  if (found?.length !== 1) throw new Error(`the backfill is not in ${MIGRATION} exactly once`);
  return found[0]!;
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
  try {
    await sql.unsafe(shim).simple();
    for (const f of migrationFiles()) {
      const text = readMigration(f);
      await sql.unsafe(f === MIGRATION ? edit(text) : text).simple();
    }
    return sql;
  } catch (e) {
    // A migration that does not apply leaves no database behind on the developer's Postgres.
    await sql.end();
    await admin.unsafe(`drop database if exists ${name}`);
    throw e;
  }
}

/** The migration with the lock taken out, refusing to build unless the text is there exactly once. */
function unlocked(text: string): string {
  if (text.split(LOCK).length !== 2) {
    throw new Error(`the lock to remove is not in ${MIGRATION} exactly once`);
  }
  return text.replace(LOCK, UNLOCKED);
}

/**
 * A users row with no account and no auth.users row yet. Written with the foreign key's trigger held
 * off for this one statement's transaction; the sign-up then inserts the auth.users row it refers to.
 */
async function waitingUser(sql: Sql) {
  const id = randomUUID();
  const email = `race-${id}@example.com`;
  await sql.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    await t`insert into public.users (id, email) values (${id}, ${email})`;
  });
  return { id, email };
}

type Call = (t: postgres.ReservedSql) => Promise<unknown>;

/** A's call commits only after B's call has been seen waiting on a lock (or the watch ran out). */
async function race(sql: Sql, a: Call, b: Call) {
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    const [{ pid }] = (await tb`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
    await ta`begin`;
    await a(ta);
    await tb`begin`;
    // Settled at once, so B failing while A holds its lock is not an unhandled rejection.
    const pending = b(tb).then(
      () => ({}),
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
    return { waited };
  } finally {
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

const signUp =
  (u: { id: string; email: string }): Call =>
  (t) =>
    t`insert into auth.users (id, email) values (${u.id}, ${u.email})`;

const backfill =
  (statement: string): Call =>
  (t) =>
    t.unsafe(statement);

/** The accounts the user holds a seat on, and whether the default account is one of them. */
async function held(sql: Sql, userId: string) {
  const [r] = await sql`
    select count(*)::int as accounts,
           bool_or(s.account_id = u.default_account_id) as default_is_one
      from public.seats s join public.users u on u.id = s.user_id
     where s.user_id = ${userId}`;
  return { accounts: r!.accounts as number, defaultIsOne: r!.default_is_one as boolean };
}

describe.skipIf(!URL_ENV)('a sign-up and the backfill under two real transactions', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = {
    real: `cc36_backfill_race_${suffix}`,
    unlocked: `cc36_backfill_race_unlocked_${suffix}`,
  };
  let admin: Sql;
  let real: Sql;
  let noLock: Sql;
  let statement: string;

  beforeAll(async () => {
    statement = await backfillStatement();
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    real = await migrated(admin, names.real);
    noLock = await migrated(admin, names.unlocked, unlocked);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await real?.end({ timeout: 5 });
    await noLock?.end({ timeout: 5 });
    for (const n of Object.values(names))
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  async function signUpFirst(sql: Sql) {
    const u = await waitingUser(sql);
    const r = await race(sql, signUp(u), backfill(statement));
    return { ...r, ...(await held(sql, u.id)) };
  }

  async function backfillFirst(sql: Sql) {
    const u = await waitingUser(sql);
    const r = await race(sql, backfill(statement), signUp(u));
    return { ...r, ...(await held(sql, u.id)) };
  }

  it(
    'the sign-up first: the backfill waits for it, then finds the default account; one account',
    async () => {
      const r = await signUpFirst(real);
      expect(r.waited, 'the backfill waited on the users row while the sign-up held it').toBe(true);
      expect(r).toMatchObject({ accounts: 1, defaultIsOne: true });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'the backfill first: the sign-up waits for it, then finds the default account; one account',
    async () => {
      const r = await backfillFirst(real);
      expect(r.waited, 'the sign-up waited on the users row while the backfill held it').toBe(true);
      expect(r).toMatchObject({ accounts: 1, defaultIsOne: true });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation check: without the lock, the sign-up first and the backfill second both make an account',
    async () => {
      expect(await signUpFirst(noLock)).toMatchObject({ accounts: 2 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'without the lock, the backfill first still leaves one account: the sign-up waits at its users insert',
    async () => {
      // handle_new_user's `insert ... on conflict (id) do nothing` meets the row version the
      // backfill's update wrote and waits for that transaction; its next statement then reads the
      // committed default account. In this order the lock is not what serialises them, so the
      // mutation is seen in the other order only.
      const r = await backfillFirst(noLock);
      expect(r.waited).toBe(true);
      expect(r).toMatchObject({ accounts: 1, defaultIsOne: true });
    },
    TEST_TIMEOUT_MS,
  );
});
