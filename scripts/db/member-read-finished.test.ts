import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  failCheck,
  seedMemberRead,
  visibleRows,
  type MemberReadScenario,
} from '../../apps/web/lib/v2/pipeline/test-support/member-read';

/**
 * Migration 20261125000001 (V2R A2, inbox 124) on a real Postgres: a member reads a check's page
 * rows and link edges only once the check is finished or partial. The same scenario as the PGlite
 * test (apps/web/__tests__/v2-a2-member-read-finished.test.ts), with the role and the JWT subject
 * set as PostgREST sets them for a signed-in request.
 *
 * Run like persist-edges.test.ts: against TRIAL_RACE_DB_URL (a Postgres on this machine), required
 * when TRIAL_RACE_REQUIRED=1, skipped otherwise.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const HOOK_TIMEOUT_MS = 600_000;
type Sql = postgres.Sql;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** The PGlite port's `query(text, params)` over postgres.js, jsonb parameters sent as text. */
const asDb = (sql: Sql | postgres.TransactionSql) =>
  ({
    query: async (text: string, params: unknown[] = []) => ({
      rows: await sql.unsafe(
        text.replace(/\$(\d+)::jsonb\b/g, '($$$1::text)::jsonb'),
        params as never[],
      ),
    }),
  }) as never;

describe.skipIf(!URL_ENV)('a member’s read of page_results and link_edges (real Postgres)', () => {
  const name = `member_read_${process.pid}_${Date.now()}`;
  let admin: Sql;
  let sql: Sql;
  let s: MemberReadScenario;

  beforeAll(async () => {
    const { PLATFORM_SHIM, migrationFiles, readMigration } =
      await import('../../apps/web/__tests__/helpers/pglite-migrations');
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${name}`);
    sql = postgres(urlFor(URL_ENV!, name), { max: 2, onnotice: () => {} });
    const shim = PLATFORM_SHIM.replace(
      /create role (\w+)([^;]*);/g,
      (_m, role: string, opts: string) =>
        `do $r$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role}${opts}; end if; end $r$;`,
    );
    await sql.unsafe(shim).simple();
    for (const f of migrationFiles()) await sql.unsafe(readMigration(f)).simple();
    s = await seedMemberRead(asDb(sql));
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop database if exists ${name} with (force)`);
    await admin?.end();
  }, HOOK_TIMEOUT_MS);

  /** As a signed-in member: `authenticated`, with the JWT subject PostgREST sets for the request. */
  const asMember = (checkId: string) =>
    sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${s.userId}, true)`;
      return visibleRows(asDb(tx), checkId);
    }) as Promise<{ page_results: number; link_edges: number }>;

  it('reads every row of a finished check of their site', async () => {
    expect(await asMember(s.finishedId)).toEqual(s.rows);
  });

  it('reads no row of a running check of their site, which holds rows', async () => {
    expect(await visibleRows(asDb(sql), s.runningId)).toEqual(s.rows);
    expect(await asMember(s.runningId)).toEqual({ page_results: 0, link_edges: 0 });
  });

  it('reads no row of a check whose save failed', async () => {
    await failCheck(asDb(sql), s.runningId);
    expect(await visibleRows(asDb(sql), s.runningId)).toEqual(s.rows);
    expect(await asMember(s.runningId)).toEqual({ page_results: 0, link_edges: 0 });
  });
});
