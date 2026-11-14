import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Concurrent founder-notice claims (`claim_founder_notice`, migration 20261115000001 section C,
 * CC-33 D3) on a real Postgres: against TRIAL_RACE_DB_URL (a Postgres on this machine), required when
 * TRIAL_RACE_REQUIRED=1, skipped otherwise, because PGlite has one backend and cannot hold two
 * transactions open at once.
 *
 *   - 30 claims of distinct keys at one p_now, each in its own transaction, all started together:
 *     exactly 20 answer `send` and 10 `held`, and the run is seen to overlap (a claim waits on the
 *     advisory lock while another holds it).
 *   - 10 claims of one key, the same way: one row, and every claim answers its decision.
 *
 * Each also runs against a database built from the migration with the advisory lock taken out, where
 * the bound does not hold: those are the mutation checks, run whenever the file runs. That build is
 * a text edit, which refuses to build when its text is not there.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261115000001_v2_033_operations.sql';
const LOCK =
  "  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder_notices', 0));\n  select * into v from public.founder_notices n where n.event_key = p_key;\n";
const LIMIT = 20;
const DISTINCT = 30;
const SAME = 10;
const NOW = '2026-11-13T12:00:00.000Z';
const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 180_000;

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
  const sql = postgres(urlFor(URL_ENV!, name), { max: DISTINCT + 4, onnotice: () => {} });
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

const withoutLock = (text: string): string => {
  if (!text.includes(LOCK)) throw new Error(`the advisory lock is not in ${MIGRATION}`);
  return text.replace(
    LOCK,
    '  select * into v from public.founder_notices n where n.event_key = p_key;\n',
  );
};

/** One claim in its own transaction as service_role; the error, when it throws. */
async function claimIn(sql: Sql, key: string): Promise<{ state: string } | { error: string }> {
  const t = await sql.reserve();
  try {
    await t`begin`;
    await t`set local role service_role`;
    const [r] = await t`select public.claim_founder_notice(${key}, 'signup', null, false,
                          ${NOW}::timestamptz, '{}'::jsonb, ${NOW}::timestamptz, ${LIMIT}, true) as s`;
    // A pause before commit, so claims that do not wait on each other overlap.
    await t`select pg_sleep(0.05)`;
    await t`commit`;
    return { state: r!.s as string };
  } catch (e) {
    await t`rollback`.catch(() => {});
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    t.release();
  }
}

/** Runs the claims together and watches pg_stat_activity for one waiting on the advisory lock. */
async function burst(sql: Sql, keys: string[]) {
  let waited = false;
  let done = false;
  const watch = (async () => {
    while (!done) {
      const [w] = await sql`select count(*)::int as n from pg_stat_activity
                             where wait_event_type = 'Lock' and wait_event = 'advisory'
                               and datname = current_database()`;
      if ((w!.n as number) > 0) waited = true;
      await new Promise((r) => setTimeout(r, 5));
    }
  })();
  const out = await Promise.all(keys.map((k) => claimIn(sql, k)));
  done = true;
  await watch;
  return { out, waited };
}

const states = (out: Awaited<ReturnType<typeof burst>>['out']) =>
  out.flatMap((o) => ('state' in o ? [o.state] : []));

describe.skipIf(!URL_ENV)('claim_founder_notice under concurrency (CC-33 D3)', () => {
  let admin: Sql;
  let sql: Sql;
  let unlocked: Sql;
  const suffix = `${process.pid}_${Date.now()}`;
  const names = { real: `founder_race_${suffix}`, unlocked: `founder_race_nolock_${suffix}` };

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    sql = await migrated(admin, names.real);
    unlocked = await migrated(admin, names.unlocked, withoutLock);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await sql?.end();
    await unlocked?.end();
    for (const n of Object.values(names)) {
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    }
    await admin?.end();
  }, HOOK_TIMEOUT_MS);

  it(
    `${DISTINCT} claims of distinct keys at one time: exactly ${LIMIT} send and the rest held`,
    async () => {
      const keys = Array.from(
        { length: DISTINCT },
        (_, i) => `signup:distinct-${randomUUID()}-${i}`,
      );
      const { out, waited } = await burst(sql, keys);
      expect(out.filter((o) => 'error' in o)).toEqual([]);
      const s = states(out);
      expect(s.filter((x) => x === 'send')).toHaveLength(LIMIT);
      expect(s.filter((x) => x === 'held')).toHaveLength(DISTINCT - LIMIT);
      expect(waited, 'a claim was seen waiting on the advisory lock').toBe(true);
      const [n] =
        await sql`select count(*)::int as n from public.founder_notices where event_key = any(${keys})`;
      expect(n!.n).toBe(DISTINCT);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `${SAME} claims of one key at one time: one row, and each claim answers its decision`,
    async () => {
      const key = `signup:same-${randomUUID()}`;
      const { out } = await burst(
        sql,
        Array.from({ length: SAME }, () => key),
      );
      expect(out.filter((o) => 'error' in o)).toEqual([]);
      const s = states(out);
      expect(new Set(s).size).toBe(1);
      const [r] =
        await sql`select count(*)::int as n, min(state) as s from public.founder_notices where event_key = ${key}`;
      expect(r).toEqual({ n: 1, s: s[0] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation: without the advisory lock the bound does not hold, and one key raises',
    async () => {
      const keys = Array.from({ length: DISTINCT }, (_, i) => `signup:nolock-${randomUUID()}-${i}`);
      const { out } = await burst(unlocked, keys);
      expect(states(out).filter((x) => x === 'send').length).toBeGreaterThan(LIMIT);
      const key = `signup:nolock-same-${randomUUID()}`;
      const same = await burst(
        unlocked,
        Array.from({ length: SAME }, () => key),
      );
      expect(same.out.filter((o) => 'error' in o).length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );
});
