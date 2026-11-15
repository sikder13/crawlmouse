import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two real transactions racing in `start_agency_trial_account` as migration 20261117000001 restates
 * it (CC-37 D3b: an owner seat of any status on an agency account whose trial was used refuses a
 * second trial), on a real Postgres. Run like scripts/db/agency-trial-race.test.ts: against
 * TRIAL_RACE_DB_URL (a Postgres on this machine), required when TRIAL_RACE_REQUIRED=1, skipped
 * otherwise, because PGlite has one backend and cannot hold two transactions open at once.
 *
 * The race holds transaction A open after its call, starts B's call, waits until B is seen waiting
 * on a lock (or the watch runs out), commits A, and lets B finish. Two mutation checks run whenever
 * the file runs, each on a database built with the migration's text edited: the users-row lock taken
 * out, where a fresh person's two calls create two accounts; and the refusal narrowed back to active
 * seats, where the person whose seat was removed is given a second trial.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261117000001_v2_037_security.sql';
/** start_agency_trial_account's lock on the person's users row. */
const USER_LOCK = '  perform 1 from public.users u where u.id = p_user for update;\n';
/** The refusal's seat condition: an owner seat, whatever its status. */
const ANY_STATUS = "   where s.user_id = p_user and s.role = 'owner'\n";
/** Each test and hook names its own bound: a loaded CI runner can be several times slower. */
const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 180_000;
/** How long to watch for B waiting. */
const WAIT_WATCH_MS = 2000;

type Sql = postgres.Sql;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** `text` with `from` replaced by `to` once, refusing to build when `from` is not there exactly once. */
function edited(text: string, from: string, to: string): string {
  if (text.split(from).length !== 2)
    throw new Error(`${JSON.stringify(from)} is not once in ${MIGRATION}`);
  return text.replace(from, to);
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
  const files = migrationFiles();
  if (!files.includes(MIGRATION)) throw new Error(`${MIGRATION} is not among the migrations`);
  for (const f of files) {
    const text = readMigration(f);
    await sql.unsafe(f === MIGRATION ? edit(text) : text).simple();
  }
  return sql;
}

/** A signed-up person (handle_new_user gives them their personal account). */
async function person(sql: Sql): Promise<string> {
  const email = [`repeat-${randomUUID()}`, 'example.com'].join('@');
  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`;
  return u!.id as string;
}

/**
 * A person who started an Agency trial, used it, and then left the account: their owner seat on it
 * is removed. Written as the function and the webhook would leave it, one statement at a time.
 */
async function leftAfterTrial(sql: Sql): Promise<string> {
  const userId = await person(sql);
  const [x] =
    await sql`select public.start_agency_trial_account(${userId}::uuid, 'Summit Digital', 'first-client.com') as r`;
  const accountId = (x!.r as { account_id: string }).account_id;
  await sql`update public.accounts set trial_used_at = '2030-01-01T00:00:00Z' where id = ${accountId}`;
  await sql`update public.seats set status = 'removed', removed_at = '2030-02-01T00:00:00Z'
             where account_id = ${accountId} and user_id = ${userId}`;
  return userId;
}

type Call = (t: postgres.ReservedSql) => Promise<{ outcome: string; account_id?: string }>;

const start =
  (userId: string, host: string): Call =>
  async (t) => {
    const [x] =
      await t`select public.start_agency_trial_account(${userId}::uuid, 'Second Agency', ${host}) as r`;
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

/** How many agency accounts the person has ever owned, whatever their seat's status. */
async function agencyAccounts(sql: Sql, userId: string): Promise<number> {
  const [r] = await sql`
    select count(distinct a.id)::int as n from public.accounts a
      join public.seats s on s.account_id = a.id
     where s.user_id = ${userId} and s.role = 'owner' and a.kind = 'agency'`;
  return r!.n as number;
}

describe.skipIf(!URL_ENV)(
  'start_agency_trial_account (20261117000001) under two real transactions',
  () => {
    const suffix = `${process.pid}_${Date.now()}`;
    const names = {
      real: `agency_repeat_${suffix}`,
      unlocked: `agency_repeat_unlocked_${suffix}`,
      activeOnly: `agency_repeat_active_${suffix}`,
    };
    let admin: Sql;
    let real: Sql;
    let noLock: Sql;
    let activeOnly: Sql;

    beforeAll(async () => {
      admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
      real = await migrated(admin, names.real);
      noLock = await migrated(admin, names.unlocked, (t) =>
        edited(t, USER_LOCK, '  perform 1 from public.users u where u.id = p_user;\n'),
      );
      activeOnly = await migrated(admin, names.activeOnly, (t) =>
        edited(
          t,
          ANY_STATUS,
          "   where s.user_id = p_user and s.role = 'owner' and s.status = 'active'\n",
        ),
      );
    }, HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await real?.end({ timeout: 5 });
      await noLock?.end({ timeout: 5 });
      await activeOnly?.end({ timeout: 5 });
      for (const n of Object.values(names))
        await admin?.unsafe(`drop database if exists ${n} with (force)`);
      await admin?.end({ timeout: 5 });
    }, HOOK_TIMEOUT_MS);

    it(
      'a person whose used-trial seat was removed, two calls at once: both trial_used, and no account is created',
      async () => {
        const userId = await leftAfterTrial(real);
        const r = await race(real, start(userId, 'second.com'), start(userId, 'second.com'));
        expect(r.waited, 'B waited on a lock while A held it').toBe(true);
        expect([r.a, r.b]).toEqual([{ outcome: 'trial_used' }, { outcome: 'trial_used' }]);
        expect(await agencyAccounts(real, userId)).toBe(1);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'a fresh person, two first calls at once: one created, the other existing with the same account; one account',
      async () => {
        const userId = await person(real);
        const r = await race(real, start(userId, 'first.com'), start(userId, 'first.com'));
        expect(r.waited, 'B waited on a lock while A held it').toBe(true);
        expect([r.a.outcome, r.b.outcome]).toEqual(['created', 'existing']);
        expect(r.b.account_id).toBe(r.a.account_id);
        expect(await agencyAccounts(real, userId)).toBe(1);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'mutation check: without the users-row lock, a fresh person’s two calls create two accounts',
      async () => {
        const userId = await person(noLock);
        const r = await race(noLock, start(userId, 'first.com'), start(userId, 'first.com'));
        expect(r.waited).toBe(false);
        expect([r.a.outcome, r.b.outcome]).toEqual(['created', 'created']);
        expect(await agencyAccounts(noLock, userId)).toBe(2);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'mutation check: with the refusal narrowed to active seats, the person who left gets a second trial',
      async () => {
        const userId = await leftAfterTrial(activeOnly);
        const r = await race(activeOnly, start(userId, 'second.com'), start(userId, 'second.com'));
        expect([r.a.outcome, r.b.outcome]).toEqual(['created', 'existing']);
        expect(await agencyAccounts(activeOnly, userId)).toBe(2);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
