import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { failed, formatResults, listChecks, runChecks } from './check';
import { migratedDb, pgliteDb, withRollback } from './test-support';

const checks = listChecks();
const byFile = (prefix: string) => checks.filter((c) => c.file.startsWith(prefix));

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 180_000);

/** The findings of one check after a mutation, inside a transaction that is rolled back. */
async function findingsAfter(prefix: string, mutation: string): Promise<string[]> {
  return withRollback(db, async (tx) => {
    await tx.exec(mutation);
    const [result] = await runChecks(tx, byFile(prefix));
    return result!.findings.map((row) => Object.values(row).join(': '));
  });
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

  it('all pass on a database migrated through 001 only, as production is before the first apply', async () => {
    const early = await migratedDb((f) => f <= '20261101000001_v2_001_entitlement_tables.sql');
    const results = await runChecks(pgliteDb(early));
    expect(formatResults(results)).not.toContain('FAIL');
  }, 180_000);
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
      'grant select on partitions.public_page_results_2026_12 to anon',
      'partitions.public_page_results_2026_12: anon holds SELECT',
    ],
    [
      'grant delete on public.usage_events to authenticated',
      'public.usage_events: authenticated holds DELETE',
    ],
  ])('01: %s', async (mutation, expected) => {
    const findings = await findingsAfter('01-', mutation);
    expect(findings.join('\n')).toContain(expected);
  });

  it.each([
    [
      'alter table partitions.public_link_edges_2027_01 disable row level security',
      'partitions.public_link_edges_2027_01: row-level security is off',
    ],
    [
      'alter table partitions.research_check_runs_2026_11 disable row level security',
      'partitions.research_check_runs_2026_11: row-level security is off',
    ],
    [
      'grant select on partitions.research_crawler_observations_2026_12 to service_role',
      'service_role holds SELECT',
    ],
    ['grant select on partitions.public_access_tests_2026_11 to public', 'PUBLIC holds SELECT'],
  ])('02: %s', async (mutation, expected) => {
    expect((await findingsAfter('02-', mutation)).join('\n')).toContain(expected);
  });

  it.each([
    ['alter role crawl_worker login', 'crawl_worker: can log in'],
    ['alter role research_retention bypassrls', 'research_retention: bypasses row-level security'],
  ])('03: %s', async (mutation, expected) => {
    expect((await findingsAfter('03-', mutation)).join('\n')).toContain(expected);
  });

  it.each([
    ['grant usage on schema research to authenticated', 'research: authenticated holds USAGE'],
    ['grant create on schema partitions to public', 'partitions: anon holds CREATE'],
  ])('04: %s', async (mutation, expected) => {
    expect((await findingsAfter('04-', mutation)).join('\n')).toContain(expected);
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
    expect((await findingsAfter('05-', mutation)).join('\n')).toContain(expected);
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
    expect((await findingsAfter('06-', mutation)).join('\n')).toContain(expected);
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

  it('refuses a check file without its leading comment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-checks-'));
    writeFileSync(join(dir, '01-bare.sql'), 'select 1 where false;\n');
    expect(() => listChecks(dir)).toThrow(/must open with a comment/);
  });
});
