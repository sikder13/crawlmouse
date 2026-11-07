import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { failed, formatResults, listChecks, runChecks } from './check';
import { readFileSync } from 'node:fs';
import { CHECKS_DIR, listMigrations } from './files';
import {
  migratedDb,
  partitionOf,
  pgliteDb,
  V1_FUNCTIONS,
  V1_TABLES,
  withRollback,
} from './test-support';

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
  it('are the six of the brief, the partition-trigger check and the v1 client-grant check, each with a title', () => {
    expect(checks.map((c) => c.file)).toEqual([
      '01-client-table-privileges.sql',
      '02-partitions-rls-owner-only.sql',
      '03-worker-roles-no-login.sql',
      '04-private-schemas.sql',
      '05-private-buckets.sql',
      '06-client-functions.sql',
      '07-partition-triggers.sql',
      '08-v1-client-grants.sql',
    ]);
    for (const c of checks) expect(c.title.length, c.file).toBeGreaterThan(10);
  });

  it('all pass on a database with every migration applied', async () => {
    const results = await runChecks(pgliteDb(db));
    expect(formatResults(results)).not.toContain('FAIL');
    expect(failed(results)).toBe(false);
  });

  it('all but 08 pass on a database migrated through 001 only, and 08 fails there: it predates 20261106000002', async () => {
    const early = await migratedDb((f) => f <= '20261101000001_v2_001_entitlement_tables.sql');
    const results = await runChecks(pgliteDb(early));
    const v1 = results.filter((r) => r.check.file === '08-v1-client-grants.sql');
    expect(formatResults(results.filter((r) => !v1.includes(r)))).not.toContain('FAIL');
    // The v1 tables existed long before 001, with the broad client grants P2 removed.
    const lines = v1[0]!.findings.map((row) => Object.values(row).join(': '));
    expect(lines).toContain('public.audits: anon holds TRUNCATE on the table');
    expect(lines).toContain('public.users: authenticated holds SELECT on the table');
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

describe('check 08: the client roles hold exactly the declared privileges on the v1 tables', () => {
  // The two the owner named: each is one line, and the only line.
  it.each([
    [
      'grant truncate on public.audits to anon',
      ['public.audits: anon holds TRUNCATE on the table'],
    ],
    [
      'grant select (email) on public.users to authenticated',
      ['public.users.email: authenticated holds SELECT on the column'],
    ],
    [
      'grant truncate, references on public.audits to anon',
      [
        'public.audits: anon holds REFERENCES on the table',
        'public.audits: anon holds TRUNCATE on the table',
      ],
    ],
    [
      'revoke select (pro_until) on public.users from authenticated',
      ['public.users.pro_until: authenticated is declared to hold SELECT and does not'],
    ],
    [
      'grant select (refusal) on public.audits to anon',
      ['public.audits.refusal: anon holds SELECT on the column'],
    ],
    [
      'grant execute on function public.handle_new_user() to anon',
      ['public.handle_new_user(): anon may execute it'],
    ],
    [
      'grant insert on public.waitlist to public',
      [
        'public.waitlist: anon holds INSERT on the table',
        'public.waitlist: authenticated holds INSERT on the table',
      ],
    ],
    [
      'alter default privileges for role postgres in schema public grant select on tables to anon',
      ['default privileges of postgres in public: anon gets SELECT on new tables'],
    ],
    [
      'alter default privileges for role postgres grant execute on functions to authenticated',
      [
        'default privileges of postgres in every schema: authenticated gets EXECUTE on new functions',
      ],
    ],
    [
      // A PUBLIC grant in a public-schema row is not Postgres's built-in default: it is a finding.
      'alter default privileges for role postgres in schema public grant execute on functions to public',
      ['default privileges of postgres in public: PUBLIC gets EXECUTE on new functions'],
    ],
    [
      'alter default privileges for role postgres in schema public grant usage on sequences to public',
      ['default privileges of postgres in public: PUBLIC gets USAGE on new sequences'],
    ],
    ['drop table public.waitlist', ['public.waitlist: a v1 table this check reads does not exist']],
    [
      'alter function public.increment_rate_limit(text, timestamptz) rename to zz_moved',
      [
        'public.increment_rate_limit(text, timestamp with time zone): a v1 function this check reads does not exist',
      ],
    ],
    [
      'grant maintain on public.audits to anon',
      ['public.audits: anon holds MAINTAIN on the table'],
    ],
    [
      'grant trigger on public.audits to authenticated',
      ['public.audits: authenticated holds TRIGGER on the table'],
    ],
    [
      'grant references (email) on public.users to authenticated',
      ['public.users.email: authenticated holds REFERENCES on the column'],
    ],
    // A declared column is declared for SELECT only: a signed-in user setting their own Pro date.
    [
      'grant update (pro_until) on public.users to authenticated',
      ['public.users.pro_until: authenticated holds UPDATE on the column'],
    ],
    [
      'grant select (id) on public.users to authenticated with grant option',
      ['public.users.id: authenticated holds SELECT on the column with grant option'],
    ],
    [
      'alter default privileges for role postgres grant select on tables to public',
      ['default privileges of postgres in every schema: PUBLIC gets SELECT on new tables'],
    ],
    // An every-schema row for types starts with PUBLIC's USAGE, which Postgres writes itself.
    [
      'alter default privileges for role postgres grant usage on types to anon',
      ['default privileges of postgres in every schema: anon gets USAGE on new types'],
    ],
    [
      `create role zz_heir; grant zz_heir to anon;
       alter default privileges for role postgres in schema public grant select on tables to zz_heir`,
      [
        'default privileges of postgres in public: zz_heir, which anon inherits from, gets SELECT on new tables',
      ],
    ],
    // Views are found by what they read, whatever they are called and wherever they live.
    [
      'create view public.zz_any_name as select id from public.audits; grant select on public.zz_any_name to anon',
      ['public.zz_any_name: reads public.audits, and anon holds SELECT on it'],
    ],
    [
      `create schema zz_s; grant usage on schema zz_s to authenticated;
       create view zz_s.inner_v as select * from public.users;
       create view zz_s.outer_v as select * from zz_s.inner_v;
       grant select on zz_s.outer_v to authenticated`,
      ['zz_s.outer_v: reads public.users, and authenticated holds SELECT on it'],
    ],
    [
      'create materialized view public.zz_mv as select id from public.pages; grant select on public.zz_mv to anon',
      ['public.zz_mv: reads public.pages, and anon holds SELECT on it'],
    ],
    [
      'create view public.zz_cv as select id, url from public.audits; grant select (url) on public.zz_cv to authenticated',
      ['public.zz_cv: reads public.audits, and authenticated holds SELECT on some of its columns'],
    ],
    ['create view public.zz_quiet as select id from public.audits', []],
    // A rule on a v1 table is read by the table arms; it does not make the table a reader of others.
    [
      'create rule zz_r as on update to public.users do also delete from public.findings where false',
      [],
    ],
    [
      `create role zz_both; grant zz_both to anon, authenticated;
       alter default privileges for role postgres in schema public grant select on tables to zz_both`,
      [
        'default privileges of postgres in public: zz_both, which anon and authenticated inherit from, gets SELECT on new tables',
      ],
    ],
    // A rule's action runs with the table owner's rights: a client inserting runs it.
    [
      `create table public.zz_t (x int);
       create rule zz_r as on insert to public.zz_t do also delete from public.findings where false;
       grant insert on public.zz_t to anon`,
      ['public.zz_t: reads public.findings, and anon holds INSERT on it'],
    ],
  ])('08: %s', async (mutation, expected) => {
    expect(await findingsAfter('08-', mutation)).toEqual(expected);
  });

  it.each(['anon', 'authenticated'])(
    '08 errors, rather than passing, when the role %s is missing',
    async (role) => {
      await expect(findingsAfter('08-', `alter role ${role} rename to zz_gone`)).rejects.toThrow(
        new RegExp(`role "${role}" does not exist`),
      );
    },
  );

  it('08 reads privileges as held, through role membership too', async () => {
    const findings = await findingsAfter('08-', 'grant service_role to authenticated');
    expect(findings).toContain('public.audits: authenticated holds DELETE on the table');
    expect(findings).toContain('public.users: authenticated holds TRUNCATE on the table');
  });
});

describe("check 08's lists are the ones P2 and the tests use", () => {
  const sql = readFileSync(join(CHECKS_DIR, '08-v1-client-grants.sql'), 'utf8');
  const block = (name: string) => {
    const start = sql.indexOf(`${name}(`);
    return sql.slice(start, sql.indexOf('\n),', start));
  };
  const p2 = () => listMigrations().find((m) => m.name === 'v1_client_grant_hardening')!.sql;

  it('v1_tables is the list P2 revokes on', () => {
    const tables = [...block('v1_tables').matchAll(/\('(\w+)'\)/g)].map((m) => m[1]);
    expect(tables).toEqual(V1_TABLES);
    expect(p2()).toContain(`revoke all on table ${V1_TABLES.map((t) => `public.${t}`).join(', ')}`);
  });

  it('declared is exactly what P2 grants back', () => {
    const declared = [...block('declared').matchAll(/\('(\w+)', '(\w+)'\)/g)]
      .map((m) => `${m[1]}.${m[2]}`)
      .sort();
    const granted = [
      ...p2().matchAll(/^grant select \(([^)]+)\) on table public\.(\w+) to authenticated;$/gm),
    ]
      .flatMap((m) => m[1]!.split(', ').map((c) => `${m[2]}.${c}`))
      .sort();
    expect(declared).toEqual(granted);
    expect(declared).toHaveLength(18);
  });

  it('v1_functions names the functions P2 revokes on', async () => {
    const signatures = [...block('v1_functions').matchAll(/\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(p2()).toContain(`revoke all on function ${V1_FUNCTIONS.join(', ')}`);
    // Resolved in the database and rendered with their argument names, as P2 names them.
    const { rows } = await db.query<{ named: string }>(
      `select format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as named
         from unnest($1::text[]) with ordinality as s(signature, i)
         join pg_proc p on p.oid = to_regprocedure(s.signature)
         join pg_namespace n on n.oid = p.pronamespace
        order by s.i`,
      [signatures],
    );
    expect(rows.map((r) => r.named)).toEqual(V1_FUNCTIONS);
  });
});

describe("check 07: each partition holds its parent's triggers", () => {
  it.each([
    ['research_check_runs', 'check_runs_no_truncate'],
    ['research_crawler_observations', 'crawler_observations_no_truncate'],
  ])('fails when a partition of %s lacks %s', async (parent, trigger) => {
    await expectFinding(
      '07-',
      `drop trigger ${trigger} on partitions.{${parent}}`,
      `partitions.{${parent}}: lacks trigger ${trigger}`,
    );
  });
});

describe('check 07 does not require a statement trigger Postgres keeps on the parent', () => {
  it('an INSERT statement trigger on a partitioned table is not required on its partitions', async () => {
    const findings = await findingsAfter(
      '07-',
      `create trigger zz_stmt after insert on research.check_runs
         for each statement execute function research.ledger_append_only()`,
    );
    expect(findings).toEqual([]);
  });
});

describe("Supabase's own partitioned tables are left to Supabase", () => {
  it('a partition whose parent is outside public, research and partitions is not checked', async () => {
    const setup = `create schema zz_platform;
      create table zz_platform.p (d date) partition by range (d);
      create table zz_platform.p1 partition of zz_platform.p for values from ('2026-01-01') to ('2026-02-01');
      grant select on zz_platform.p1 to anon`;
    for (const prefix of ['01-', '02-', '07-']) {
      expect(await findingsAfter(prefix, setup), prefix).toEqual([]);
    }
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
