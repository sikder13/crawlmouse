import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { failed, formatResults, listChecks, runChecks } from './check';
import { readFileSync } from 'node:fs';
import { CHECKS_DIR } from './files';
import { migratedDb, partitionOf, pgliteDb, withRollback } from './test-support';

const checks = listChecks();
const byFile = (prefix: string) => checks.filter((c) => c.file.startsWith(prefix));

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 180_000);

/**
 * Replaces `{public_page_results}` and the like with the name of an existing partition of that
 * table: partitions are named for the months around now(), so no test names a month.
 */
async function resolve(text: string): Promise<string> {
  let out = text;
  for (const [token, parent] of text.matchAll(/\{([a-z_]+)\}/g)) {
    out = out.replace(token, await partitionOf(db, parent!));
  }
  return out;
}

/** The findings of one check after a mutation, inside a transaction that is rolled back. */
async function findingsAfter(prefix: string, mutation: string): Promise<string[]> {
  const sql = await resolve(mutation);
  return withRollback(db, async (tx) => {
    await tx.exec(sql);
    const [result] = await runChecks(tx, byFile(prefix));
    return result!.findings.map((row) => Object.values(row).join(': '));
  });
}

async function expectFinding(prefix: string, mutation: string, expected: string) {
  expect((await findingsAfter(prefix, mutation)).join('\n')).toContain(await resolve(expected));
}

describe('the check files', () => {
  it('are the six of the brief, each with a title', () => {
    expect(checks.map((c) => c.file)).toEqual([
      '01-client-table-privileges.sql',
      '02-partitions-rls-owner-only.sql',
      '03-worker-roles-no-login.sql',
      '04-private-schemas.sql',
      '05-private-buckets.sql',
      '06-client-functions.sql',
    ]);
    for (const c of checks) expect(c.title.length, c.file).toBeGreaterThan(10);
  });

  it('all pass on a database migrated through 006b', async () => {
    const results = await runChecks(pgliteDb(db));
    expect(formatResults(results)).not.toContain('FAIL');
    expect(failed(results)).toBe(false);
  });

  it('all pass on a database migrated through 001 only, before any table they check exists', async () => {
    const early = await migratedDb((f) => f <= '20261101000001_v2_001_entitlement_tables.sql');
    const results = await runChecks(pgliteDb(early));
    expect(formatResults(results)).not.toContain('FAIL');
  }, 180_000);
});

describe('check 01 names tables that exist', () => {
  it('every relation in its v2_tables and declared lists exists once the migrations have run', async () => {
    const sql = readFileSync(join(CHECKS_DIR, '01-client-table-privileges.sql'), 'utf8');
    const named = [...new Set([...sql.matchAll(/'(public\.[a-z_]+)'/g)].map((m) => m[1]!))];
    expect(named.length).toBeGreaterThanOrEqual(25);
    const { rows } = await db.query<{ rel: string }>(
      `select r as rel from unnest($1::text[]) r where to_regclass(r) is null`,
      [named],
    );
    expect(rows.map((r) => r.rel)).toEqual([]);
  });
});

describe('each check fails on what it guards', () => {
  it.each([
    ['grant select on public.sites to anon', 'public.sites: anon holds SELECT on the table'],
    [
      'grant update (host) on public.sites to authenticated',
      'public.sites.host: authenticated holds UPDATE on the column',
    ],
    [
      'revoke select (client_scope_all) on public.seats from authenticated',
      'public.seats.client_scope_all: authenticated is declared to hold SELECT',
    ],
    [
      'revoke insert on public.page_results from crawl_worker',
      'public.page_results: crawl_worker is declared to hold INSERT',
    ],
    [
      'grant select on research.check_runs to authenticated',
      'research.check_runs: authenticated holds SELECT on the table',
    ],
    [
      'grant select on partitions.{public_page_results} to anon',
      'partitions.{public_page_results}: anon holds SELECT',
    ],
    [
      'grant delete on public.usage_events to authenticated',
      'public.usage_events: authenticated holds DELETE',
    ],
    ['grant maintain on public.sites to anon', 'public.sites: anon holds MAINTAIN on the table'],
    [
      `create table public.page_results_2031_01 partition of public.page_results
         for values from ('2031-01-01') to ('2031-02-01');
       grant select on public.page_results_2031_01 to anon`,
      'public.page_results_2031_01: anon holds SELECT on the table',
    ],
    [
      'create materialized view research.zz_mv as select 1 as x; grant select on research.zz_mv to anon',
      'research.zz_mv: anon holds SELECT on the table',
    ],
  ])('01: %s', async (mutation, expected) => {
    await expectFinding('01-', mutation, expected);
  });

  it.each([
    [
      'alter table partitions.{public_link_edges} disable row level security',
      'partitions.{public_link_edges}: row-level security is off',
    ],
    [
      'alter table partitions.{research_check_runs} disable row level security',
      'partitions.{research_check_runs}: row-level security is off',
    ],
    [
      'grant select on partitions.{research_crawler_observations} to service_role',
      'service_role holds SELECT',
    ],
    ['grant select on partitions.{public_access_tests} to public', 'PUBLIC holds SELECT'],
    [
      `create table public.page_results_2031_01 partition of public.page_results
         for values from ('2031-01-01') to ('2031-02-01');
       alter table public.page_results_2031_01 disable row level security`,
      'public.page_results_2031_01: row-level security is off',
    ],
  ])('02: %s', async (mutation, expected) => {
    await expectFinding('02-', mutation, expected);
  });

  it.each([
    ['alter role crawl_worker login', 'crawl_worker: can log in'],
    ['alter role research_retention bypassrls', 'research_retention: bypasses row-level security'],
    ['alter role crawl_worker createrole', 'crawl_worker: can create roles'],
    [
      'grant service_role to crawl_worker',
      'crawl_worker: is a member of service_role, which bypasses row-level security',
    ],
    [
      'create role zz_middle; grant service_role to zz_middle; grant zz_middle to research_retention',
      'research_retention: is a member of service_role',
    ],
  ])('03: %s', async (mutation, expected) => {
    await expectFinding('03-', mutation, expected);
  });

  it.each([
    ['grant usage on schema research to authenticated', 'research: authenticated holds USAGE'],
    ['grant create on schema partitions to public', 'partitions: anon holds CREATE'],
  ])('04: %s', async (mutation, expected) => {
    await expectFinding('04-', mutation, expected);
  });

  it.each([
    [
      "update storage.buckets set public = true where id = 'reports'",
      'reports: the bucket is public',
    ],
    [
      "update storage.buckets set public = null where id = 'evidence'",
      'evidence: the bucket is public',
    ],
  ])('05: %s', async (mutation, expected) => {
    await expectFinding('05-', mutation, expected);
  });

  it.each([
    [
      'grant execute on function public.v2_premake_month_partitions(date, date) to authenticated',
      'public.v2_premake_month_partitions(date, date): authenticated may execute it',
    ],
    [
      'grant execute on function research.text_array_distinct(text[]) to anon',
      'research.text_array_distinct(text[]): anon may execute it',
    ],
    [
      'grant execute on function public.is_member(uuid) to anon',
      'public.is_member(uuid): anon may execute it',
    ],
    [
      'revoke execute on function public.usage_counts(uuid) from authenticated',
      'public.usage_counts(uuid): authenticated is declared to execute it and cannot',
    ],
  ])('06: %s', async (mutation, expected) => {
    await expectFinding('06-', mutation, expected);
  });
});

describe('the runner', () => {
  it('fails on a check that returns a row and passes on one that returns none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-checks-'));
    writeFileSync(
      join(dir, '01-empty.sql'),
      '-- Nothing is wrong here.\nselect 1 as x where false;\n',
    );
    writeFileSync(
      join(dir, '02-row.sql'),
      "-- Something is wrong here.\nselect 'object' as object, 'problem' as problem;\n",
    );
    writeFileSync(join(dir, 'fingerprint.sql'), 'select 1;\n');
    const fake = listChecks(dir);
    expect(fake.map((c) => c.file)).toEqual(['01-empty.sql', '02-row.sql']);
    const results = await runChecks(pgliteDb(db), fake);
    expect(failed(results.slice(0, 1))).toBe(false);
    expect(failed(results)).toBe(true);
    expect(formatResults(results)).toContain(
      'FAIL  02-row.sql  Something is wrong here.\n      object: problem',
    );
  });

  it.each([
    [
      'a .sql file that is not named as a check',
      ['1-misnamed.sql'],
      /1-misnamed.sql.*NN-<name>.sql/,
    ],
    ['a directory with no checks', [], /holds no checks/],
  ])('refuses %s', (_label, files, error) => {
    const dir = mkdtempSync(join(tmpdir(), 'db-checks-'));
    writeFileSync(join(dir, 'fingerprint.sql'), 'select 1;\n');
    for (const f of files) writeFileSync(join(dir, f), '-- A check.\nselect 1 where false;\n');
    expect(() => listChecks(dir)).toThrow(error);
  });

  it('refuses a check file without its leading comment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-checks-'));
    writeFileSync(join(dir, '01-bare.sql'), 'select 1 where false;\n');
    expect(() => listChecks(dir)).toThrow(/must open with a comment/);
  });
});
