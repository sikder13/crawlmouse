import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two real transactions racing in `start_agency_trial_account` (migration 20261114000001, CC-29 D3)
 * for the same person, on a real Postgres. Run like scripts/db/sites-race.test.ts: against
 * TRIAL_RACE_DB_URL (a Postgres on this machine), required when TRIAL_RACE_REQUIRED=1, skipped
 * otherwise, because PGlite has one backend and cannot hold two transactions open at once.
 *
 * The race holds transaction A open after its call, starts B's call, waits until B is seen waiting
 * on a lock (or the watch runs out), commits A, and lets B finish. The same race also runs against a
 * database built from the migration with the lock on the person's users row taken out, where both
 * calls must create an account: that is the mutation check, run whenever the file runs.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261114000001_v2_029_public_pages.sql';
/** start_agency_trial_account's lock on the person's users row. */
const USER_LOCK = '  perform 1 from public.users u where u.id = p_user for update;\n';
/** Each test and hook names its own bound: a loaded CI runner can be several times slower. */
const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 120_000;
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

/** The migration with the users-row lock taken out, refusing to build when the text is not there. */
const unlocked = (text: string): string => {
  if (!text.includes(USER_LOCK)) throw new Error(`the users-row lock is not in ${MIGRATION}`);
  return text.replace(USER_LOCK, '  perform 1 from public.users u where u.id = p_user;\n');
};

/** A signed-up person (handle_new_user gives them their personal account). */
async function person(sql: Sql): Promise<string> {
  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${`race-${randomUUID()}@example.com`}) returning id`;
  return u!.id as string;
}

type Call = (t: postgres.ReservedSql) => Promise<{ outcome: string; account_id?: string }>;

const start =
  (userId: string, host: string): Call =>
  async (t) => {
    const [x] =
      await t`select public.start_agency_trial_account(${userId}::uuid, 'Summit Digital', ${host}) as r`;
    return x!.r as { outcome: string; account_id?: string };
  };

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
      (result) => ({ result }),
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
    return { a: ra, b: settled.result, waited };
  } finally {
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

/** The person's agency accounts, and the sites those accounts hold. */
async function agencyState(sql: Sql, userId: string) {
  const accounts = await sql`
    select a.id from public.accounts a join public.seats s on s.account_id = a.id
     where s.user_id = ${userId} and s.role = 'owner' and a.kind = 'agency'`;
  const sites = await sql`
    select s.host from public.sites s
     where s.account_id = any(${accounts.map((a) => a.id as string)}::uuid[])`;
  return { accounts: accounts.length, sites: sites.map((s) => s.host as string) };
}

describe.skipIf(!URL_ENV)('start_agency_trial_account under two real transactions', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = { real: `agency_race_${suffix}`, unlocked: `agency_race_unlocked_${suffix}` };
  let admin: Sql;
  let real: Sql;
  let noLock: Sql;

  beforeAll(async () => {
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

  it(
    'two submits by one person: the second waits for the first, then returns its account; one account, one site',
    async () => {
      const userId = await person(real);
      const r = await race(real, start(userId, 'clientsite.com'), start(userId, 'clientsite.com'));
      expect(r.waited, 'B waited on a lock while A held it').toBe(true);
      expect([r.a.outcome, r.b.outcome]).toEqual(['created', 'existing']);
      expect(r.b.account_id).toBe(r.a.account_id);
      expect(await agencyState(real, userId)).toEqual({ accounts: 1, sites: ['clientsite.com'] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'two people at once do not wait on each other: one account each',
    async () => {
      const x = await person(real);
      const y = await person(real);
      const r = await race(real, start(x, 'x-client.com'), start(y, 'y-client.com'));
      expect(r.waited).toBe(false);
      expect([r.a.outcome, r.b.outcome]).toEqual(['created', 'created']);
      expect((await agencyState(real, x)).accounts).toBe(1);
      expect((await agencyState(real, y)).accounts).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation check: without the users-row lock the same race creates two accounts',
    async () => {
      const userId = await person(noLock);
      const r = await race(
        noLock,
        start(userId, 'clientsite.com'),
        start(userId, 'clientsite.com'),
      );
      expect(r.waited).toBe(false);
      expect([r.a.outcome, r.b.outcome]).toEqual(['created', 'created']);
      expect((await agencyState(noLock, userId)).accounts).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );
});
