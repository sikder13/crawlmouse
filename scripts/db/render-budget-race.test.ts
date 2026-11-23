import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The daily render budget under real concurrency (migration 20261123000001). Run like
 * scripts/db/kept-expiry-race.test.ts: against TRIAL_RACE_DB_URL (a Postgres on this machine),
 * required when TRIAL_RACE_REQUIRED=1, skipped otherwise, because PGlite has one backend.
 *
 * The cap test also runs against a database built with the cap's test taken out of the UPDATE,
 * where the total must pass the cap: that is the mutation check, run whenever the file runs.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261123000001_v2_a2_render_budget.sql';
const CAP_TEST = 'where day = v_day and committed_ms + p_ms <= p_limit_ms;';
const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 120_000;

type Sql = postgres.Sql;

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
  const sql = postgres(urlFor(URL_ENV!, name), { max: 8, onnotice: () => {} });
  // Roles are cluster-wide: another database in this cluster may already have made them.
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

const committed = async (sql: Sql) => {
  const [r] =
    await sql`select coalesce(sum(committed_ms), 0)::int as ms from public.render_budget_days`;
  return r!.ms as number;
};

/** Twenty checks ask for 100 ms each against a cap of 1,000, all at once. */
async function reserveAtOnce(sql: Sql) {
  const answers = await Promise.all(
    Array.from(
      { length: 20 },
      () => sql`select public.reserve_render_ms(${randomUUID()}::uuid, 100, 1000) as id`,
    ),
  );
  return answers.filter(([r]) => r!.id !== null).length;
}

describe.skipIf(!URL_ENV)('the daily render budget, on a real Postgres', () => {
  const stamp = `${process.pid}_${Date.now()}`;
  const names = { real: `render_budget_${stamp}`, noCap: `render_budget_nocap_${stamp}` };
  let admin: Sql;
  let real: Sql;
  let noCap: Sql;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    real = await migrated(admin, names.real);
    noCap = await migrated(admin, names.noCap, (text) => {
      if (!text.includes(CAP_TEST)) throw new Error('the cap test is not in the migration');
      return text.replace(CAP_TEST, 'where day = v_day;');
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await real?.end();
    await noCap?.end();
    for (const name of Object.values(names)) {
      await admin?.unsafe(`drop database if exists ${name} with (force)`);
    }
    await admin?.end();
  }, HOOK_TIMEOUT_MS);

  it(
    'grants exactly what fits, however the calls interleave',
    async () => {
      expect(await reserveAtOnce(real)).toBe(10);
      expect(await committed(real)).toBe(1000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'passes the cap with the test taken out, so the test above can fail',
    async () => {
      await reserveAtOnce(noCap);
      expect(await committed(noCap)).toBeGreaterThan(1000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'counts one settle once when the same call arrives several times at once',
    async () => {
      await real`truncate public.render_reservations`;
      await real`truncate public.render_budget_days`;
      const [r] =
        await real`select public.reserve_render_ms(${randomUUID()}::uuid, 600, 1000) as id`;
      await Promise.all(
        Array.from(
          { length: 6 },
          () => real`select public.settle_render_ms(${r!.id as string}::uuid, 100)`,
        ),
      );
      expect(await committed(real)).toBe(100);
    },
    TEST_TIMEOUT_MS,
  );
});
