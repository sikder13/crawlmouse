import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A check inserted while keep_check runs on its site, on a real Postgres (migration
 * 20261122000003). Run like scripts/db/sites-race.test.ts: against TRIAL_RACE_DB_URL (a Postgres on
 * this machine), required when TRIAL_RACE_REQUIRED=1, skipped otherwise, because PGlite has one
 * backend and cannot hold two transactions open at once.
 *
 * Each race holds transaction A open after its call, starts B's call, waits until B is seen waiting
 * on a lock, commits A and lets B finish. The first order also runs against a database built with
 * the trigger's row lock taken out, where the expiry must survive: that is the mutation check, run
 * whenever the file runs.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261122000003_v2_a2_kept_site_no_expiry.sql';
const LOCK = ' where s.id = new.site_id for key share;';
const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 120_000;
const WAIT_WATCH_MS = 2000;

type Sql = postgres.Sql;
type Call = (t: postgres.ReservedSql) => Promise<unknown>;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration, this one's text edited. */
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

async function keeper(sql: Sql) {
  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${`race-${randomUUID()}@example.com`}) returning id`;
  const [a] = await sql`
    select u.default_account_id as account_id, s.id as seat_id
      from public.users u join public.seats s on s.account_id = u.default_account_id and s.user_id = u.id
     where u.id = ${u!.id}`;
  return { accountId: a!.account_id as string, seatId: a!.seat_id as string };
}

const later = () => new Date(Date.now() + 60 * 60 * 1000);

/** A site nobody keeps, with one check that expires. */
async function anonymous(sql: Sql) {
  const siteId = randomUUID();
  const checkId = randomUUID();
  await sql`insert into public.sites (id, host) values (${siteId}, ${`${siteId.slice(0, 8)}.example`})`;
  await sql`insert into public.checks (id, site_id, status, trigger, grade_version, expires_at)
            values (${checkId}, ${siteId}, 'queued', 'first_audit', '2.0.0', ${later()})`;
  return { siteId, checkId };
}

const keep =
  (checkId: string, who: { accountId: string; seatId: string }): Call =>
  async (t) => {
    const [x] = await t`select public.keep_check(${checkId}::uuid, ${who.accountId}::uuid,
                                                 ${who.seatId}::uuid, 'monthly', 1, 9,
                                                 '[]'::jsonb) as r`;
    expect(x!.r).toBe('taken');
  };

const insertExpiring =
  (id: string, siteId: string): Call =>
  (t) =>
    t`insert into public.checks (id, site_id, status, trigger, grade_version, expires_at)
      values (${id}, ${siteId}, 'queued', 'manual', '2.0.0', ${later()})`;

/** A's call commits only after B's call has been seen waiting on a lock (or the watch ran out). */
async function race(sql: Sql, a: Call, b: Call) {
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    const [{ pid }] = (await tb`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
    await ta`begin`;
    await ta`set local role service_role`;
    await a(ta);
    await tb`begin`;
    await tb`set local role service_role`;
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

const expiryOf = async (sql: Sql, id: string) =>
  (await sql`select expires_at from public.checks where id = ${id}`)[0]!.expires_at as Date | null;

describe.skipIf(!URL_ENV)('a check inserted while its site is being kept', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const names = [`kept_race_${suffix}`, `kept_race_nolock_${suffix}`];
  let admin: Sql;
  let db: Sql;
  let unlocked: Sql;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    db = await migrated(admin, names[0]!);
    unlocked = await migrated(admin, names[1]!, (text) => {
      if (!text.includes(LOCK)) throw new Error(`the lock to remove is not in ${MIGRATION}`);
      return text.replace(LOCK, ' where s.id = new.site_id;');
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await unlocked?.end();
    for (const n of names) await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end();
  }, HOOK_TIMEOUT_MS);

  it(
    'keep_check first: the insert waits for it, and stores no expiry',
    async () => {
      const who = await keeper(db);
      const { siteId, checkId } = await anonymous(db);
      const id = randomUUID();
      const { waited } = await race(db, keep(checkId, who), insertExpiring(id, siteId));
      expect(waited).toBe(true);
      expect(await expiryOf(db, id)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'the insert first: keep_check waits for it, and clears the new row',
    async () => {
      const who = await keeper(db);
      const { siteId, checkId } = await anonymous(db);
      const id = randomUUID();
      const { waited } = await race(db, insertExpiring(id, siteId), keep(checkId, who));
      expect(waited).toBe(true);
      expect(await expiryOf(db, id)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'without the trigger’s row lock, the expiry survives on a kept site',
    async () => {
      const who = await keeper(unlocked);
      const { siteId, checkId } = await anonymous(unlocked);
      const id = randomUUID();
      await race(unlocked, keep(checkId, who), insertExpiring(id, siteId));
      expect(await expiryOf(unlocked, id)).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
