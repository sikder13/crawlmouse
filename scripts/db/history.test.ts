import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { listMigrations, type MigrationFile } from './files';
import {
  REPAIR_STATEMENTS,
  applyRepair,
  diffHistory,
  executable,
  formatDiff,
  planRepair,
  readHistory,
  type HistoryRow,
} from './history';
import { HISTORY_TABLE, pgliteDb, type RecordingDb } from './test-support';

/**
 * Production's history table as read on 2026-11-05, after the owner applied 003, 005, 007 and 006b
 * through the dashboard, through the Supabase MCP
 * (`select version, name, statements from supabase_migrations.schema_migrations`): 36 rows.
 * Statements are reduced to what the diff reads: present, empty, or a comment only (the four rows
 * the owner inserted hold one comment naming the file and its sha256). This is the independent
 * truth the diff is pinned against: the categories below were counted by hand from that read.
 */
const PRODUCTION_ROWS: Array<
  [version: string, name: string, statements: 'present' | 'empty' | 'comment']
> = [
  ['20260524000001', 'init_users', 'present'],
  ['20260524000002', 'audits', 'present'],
  ['20260524000003', 'indexes', 'present'],
  ['20260524000004', 'rls', 'present'],
  ['20260524000005', 'rate_limits', 'present'],
  ['20260524000006', 'sharing', 'present'],
  ['20260524000007', 'benchmark_cohorts', 'present'],
  ['20260526055250', 'rls_rate_limits', 'present'],
  ['20260526055318', 'function_search_path', 'present'],
  ['20260601093225', 'stripe_events', 'present'],
  ['20260601093243', 'audits_ttl', 'present'],
  ['20260601093247', 'email_events', 'present'],
  ['20260601173159', 'user_provisioning', 'present'],
  ['20260601174725', 'rls_perf_hardening', 'present'],
  ['20260601174823', 'harden_handle_new_user_grants', 'present'],
  ['20260601182311', 'audits_anon_session_idx', 'present'],
  ['20260601190311', 'public_reports_denormalize', 'present'],
  ['20260601190332', 'embed_view_increment', 'present'],
  ['20260601190334', 'takedown_rls_lockdown', 'present'],
  ['20260601190840', 'share_fns_invoker', 'present'],
  ['20260601192720', 'share_security_followups', 'present'],
  ['20260601194136', 'rate_limit_fn_grants', 'present'],
  ['20260602054456', 'harden_users_entitlement_grants', 'present'],
  ['20260603184443', 'waitlist', 'present'],
  ['20260614094249', 'audit_canceled', 'present'],
  ['20260617204256', 'engine_v2_crawl_health', 'present'],
  ['20260707000001', 'audit_progress_notify', 'empty'],
  ['20260707000002', 'public_reports_visibility', 'empty'],
  ['20260707000003', 'spec04_column_privilege_hardening', 'empty'],
  ['20260707000004', 'public_reports_client_insert_revoke', 'empty'],
  ['20260707000005', 'domain_verifications_client_write_revoke', 'empty'],
  ['20261102000001', 'v2_003_sites_checks', 'comment'],
  ['20261102000002', 'v2_005_sharing_columns', 'comment'],
  ['20261102000003', 'v2_007_storage', 'comment'],
  ['20261103000001', 'v2_006b_ledger_usage', 'comment'],
  ['20261103220014', 'v2_001_entitlement_tables', 'present'],
];

const productionRows = (): HistoryRow[] =>
  PRODUCTION_ROWS.map(([version, name, s]) => ({
    version,
    name,
    statements:
      s === 'present'
        ? ['recorded statement']
        : s === 'comment'
          ? [`-- applied by owner through the dashboard SQL editor on 2026-11-05 (${version})`]
          : null,
  }));

const versions = (files: { version: string }[]) => files.map((f) => f.version);

describe('the history diff, against production as read on 2026-11-05 (36 rows)', () => {
  const files = listMigrations();
  const diff = diffHistory(files, productionRows());

  it('finds the 19 rows recorded under the time they were applied, each paired with its file', () => {
    expect(diff.misversioned.map(({ row, file }) => `${row.version}->${file.version}`)).toEqual([
      '20260526055250->20260526000001',
      '20260526055318->20260526000002',
      '20260601093225->20260601000001',
      '20260601093243->20260601000002',
      '20260601093247->20260601000003',
      '20260601173159->20260601000004',
      '20260601174725->20260601000005',
      '20260601182311->20260601000006',
      '20260601190311->20260601000007',
      '20260601190332->20260601000008',
      '20260601190334->20260601000009',
      '20260601190840->20260601000010',
      '20260601192720->20260601000011',
      '20260601194136->20260601000012',
      '20260602054456->20260602000013',
      '20260603184443->20260603000014',
      '20260614094249->20260614000001',
      '20260617204256->20260617000001',
      '20261103220014->20261101000001',
    ]);
  });

  it('finds the one row with no file', () => {
    expect(diff.orphans.map((r) => r.version)).toEqual(['20260601174823']);
  });

  it('finds nine rows with no executable statement: five empty, four holding only a comment', () => {
    expect(versions(diff.withoutStatements.map((e) => e.file))).toEqual([
      '20260707000001',
      '20260707000002',
      '20260707000003',
      '20260707000004',
      '20260707000005',
      '20261102000001',
      '20261102000002',
      '20261102000003',
      '20261103000001',
    ]);
  });

  it('finds the eight files applied by hand with no row', () => {
    expect(versions(diff.unrecorded)).toEqual([
      '20260629000001',
      '20260629000002',
      '20260708000001',
      '20260727000001',
      '20260804000001',
      '20260805000001',
      '20260806000001',
      '20260806000002',
    ]);
  });

  it('with --applied-through 20261103000001 the repair inserts eight rows and leaves nothing pending', () => {
    const plan = planRepair(files, diff, {
      appliedThrough: '20261103000001',
      dropOrphans: ['20260601174823'],
    });
    expect(versions(plan.inserts)).toEqual(versions(diff.unrecorded));
    expect(plan.pending).toEqual([]);
    expect(plan.renames).toHaveLength(19);
    expect(plan.fills).toHaveLength(9);
    expect(plan.drops.map((r) => r.version)).toEqual(['20260601174823']);
  });

  it('refuses the earlier --applied-through 20261101000001, now that 003 to 006b are recorded', () => {
    expect(() =>
      planRepair(files, diff, {
        appliedThrough: '20261101000001',
        dropOrphans: ['20260601174823'],
      }),
    ).toThrow(
      /20261102000001, 20261102000002, 20261102000003, 20261103000001, after --applied-through/,
    );
  });
});

describe('executable', () => {
  it.each([
    ['', false],
    ['   \n\t', false],
    ['-- applied by hand (sha256 abc)', false],
    ['-- one\n-- two\n', false],
    ['/* block */', false],
    ['/* a */ -- b', false],
    ['select 1;', true],
    ['-- note\nselect 1;', true],
    ["select '--' as x;", true],
  ])('%j is executable: %s', (text, expected) => {
    expect(executable(text)).toBe(expected);
  });
});

/** A small migrations directory whose names vary the attribute the matcher reads: the name. */
function fixtureDir(names: string[]): MigrationFile[] {
  const dir = mkdtempSync(join(tmpdir(), 'db-history-'));
  for (const n of names) writeFileSync(join(dir, `${n}.sql`), `-- ${n}\nselect '${n}';\n`);
  return listMigrations(dir);
}

describe('the history diff matches a row to a file by exact name, never by prefix', () => {
  const files = fixtureDir([
    '20260101000001_audits',
    '20260101000002_audits_ttl',
    '20260101000003_audits_ttl_index',
  ]);

  it('pairs a renamed row with the file of exactly its name', () => {
    const diff = diffHistory(files, [
      { version: '20260101000001', name: 'audits', statements: ['x'] },
      { version: '20260105123456', name: 'audits_ttl', statements: ['x'] },
    ]);
    expect(diff.misversioned.map(({ file }) => file.name)).toEqual(['audits_ttl']);
    expect(diff.orphans).toEqual([]);
    expect(versions(diff.unrecorded)).toEqual(['20260101000003']);
  });

  it('treats a row whose name is only a prefix or extension of a file name as an orphan', () => {
    const diff = diffHistory(files, [
      { version: '20260105000001', name: 'audit', statements: ['x'] },
      { version: '20260105000002', name: 'audits_ttl_index_v2', statements: ['x'] },
    ]);
    expect(diff.orphans.map((r) => r.name)).toEqual(['audit', 'audits_ttl_index_v2']);
    expect(diff.misversioned).toEqual([]);
  });

  it.each([
    ['a row whose name extends the one file name', 'sites_v2', 'sites'],
    ['a row whose name is a prefix of the one file name', 'site', 'sites'],
  ])('treats %s as an orphan, with one candidate file', (_label, rowName, fileName) => {
    const [file] = fixtureDir([`20260101000001_${fileName}`]);
    const diff = diffHistory(
      [file!],
      [{ version: '20260105000001', name: rowName, statements: ['x'] }],
    );
    expect(diff.misversioned).toEqual([]);
    expect(diff.orphans.map((r) => r.name)).toEqual([rowName]);
  });

  it('does not rename a row onto a file whose version is already recorded', () => {
    const diff = diffHistory(files, [
      { version: '20260101000002', name: 'audits_ttl', statements: ['x'] },
      { version: '20260109000000', name: 'audits_ttl', statements: ['x'] },
    ]);
    expect(diff.misversioned).toEqual([]);
    expect(diff.orphans.map((r) => r.version)).toEqual(['20260109000000']);
  });

  it('formats every category, including the statement of a row with no file', () => {
    const diff = diffHistory(files, [
      { version: '20260101000001', name: 'audits', statements: null },
      { version: '20260109000000', name: 'gone', statements: ['revoke all on x from anon;'] },
    ]);
    const text = formatDiff(diff);
    expect(text).toContain('20260101000001 audits');
    expect(text).toContain('20260109000000 gone');
    expect(text).toContain('revoke all on x from anon;');
    expect(text).toContain('20260101000002 audits_ttl');
  });
});

describe('planRepair refuses what would leave a history the CLI rejects or a file wrongly marked', () => {
  const files = fixtureDir(['20260101000001_one', '20260101000002_two', '20260101000003_three']);

  it('refuses without --applied-through', () => {
    const diff = diffHistory(files, []);
    expect(() => planRepair(files, diff, { appliedThrough: '', dropOrphans: [] })).toThrow(
      /--applied-through/,
    );
  });

  it('refuses an --applied-through that names no file', () => {
    const diff = diffHistory(files, []);
    expect(() =>
      planRepair(files, diff, { appliedThrough: '20260101000009', dropOrphans: [] }),
    ).toThrow(/names no migration file/);
  });

  it('refuses while a row with no file is not named by --drop-orphan', () => {
    const diff = diffHistory(files, [{ version: '20251231000000', name: 'x', statements: ['x'] }]);
    expect(() =>
      planRepair(files, diff, { appliedThrough: '20260101000001', dropOrphans: [] }),
    ).toThrow(/20251231000000.*--drop-orphan/);
  });

  it('refuses a --drop-orphan that names a row with a file', () => {
    const diff = diffHistory(files, [
      { version: '20260101000001', name: 'one', statements: ['x'] },
    ]);
    expect(() =>
      planRepair(files, diff, {
        appliedThrough: '20260101000001',
        dropOrphans: ['20260101000001'],
      }),
    ).toThrow(/is not a row with no file/);
  });

  it('refuses when a row records a file after --applied-through', () => {
    const diff = diffHistory(files, [
      { version: '20260101000003', name: 'three', statements: ['x'] },
    ]);
    expect(() =>
      planRepair(files, diff, { appliedThrough: '20260101000001', dropOrphans: [] }),
    ).toThrow(/20260101000003.*after --applied-through/);
  });
});

describe('applyRepair', () => {
  const files = fixtureDir([
    '20260101000001_one',
    '20260101000002_two',
    '20260101000003_three',
    '20260101000004_four',
    '20260101000005_five',
  ]);
  let db: RecordingDb;

  beforeEach(async () => {
    db = pgliteDb(new PGlite());
    await db.exec(HISTORY_TABLE);
    await db.exec(`
      insert into supabase_migrations.schema_migrations (version, name, statements) values
        ('20260101000001', 'one', null),
        ('20260101093000', 'two', array['what production ran for two']),
        ('20260101000003', 'three', array['-- applied by hand from 20260101000003_three.sql']),
        ('20260101094500', 'gone', array['revoke all on x from anon;']);
    `);
  });

  async function repair() {
    const diff = diffHistory(files, await readHistory(db));
    const plan = planRepair(files, diff, {
      appliedThrough: '20260101000003',
      dropOrphans: ['20260101094500'],
    });
    db.executed.length = 0;
    await applyRepair(db, files, plan);
    return plan;
  }

  it('leaves a history whose only unrecorded files are the pending ones', async () => {
    const plan = await repair();
    const after = diffHistory(files, await readHistory(db));
    expect(after.misversioned).toEqual([]);
    expect(after.orphans).toEqual([]);
    expect(after.withoutStatements).toEqual([]);
    expect(versions(after.unrecorded)).toEqual(versions(plan.pending));
    expect(versions(plan.pending)).toEqual(['20260101000004', '20260101000005']);
  });

  it("fills an empty row with the file bytes, keeps a comment-only row's comment in front of them, and a renamed row keeps what production ran", async () => {
    await repair();
    const rows = await readHistory(db);
    const byVersion = new Map(rows.map((r) => [r.version, r]));
    const bytes = (v: string) => files.find((f) => f.version === v)!.sql;
    expect(byVersion.get('20260101000001')!.statements).toEqual([bytes('20260101000001')]);
    expect(byVersion.get('20260101000002')!.statements).toEqual(['what production ran for two']);
    expect(byVersion.get('20260101000003')!.statements).toEqual([
      '-- applied by hand from 20260101000003_three.sql',
      bytes('20260101000003'),
    ]);
    expect(byVersion.has('20260101094500')).toBe(false);
  });

  it('runs no SQL but its own fixed statements: a file reaches the database only as a parameter', async () => {
    await repair();
    const allowed = new Set<string>([
      ...Object.values(REPAIR_STATEMENTS),
      'select version, name, statements from supabase_migrations.schema_migrations order by version',
    ]);
    for (const text of db.executed) expect(allowed, text).toContain(text);
    expect(db.executed.some((t) => t.includes("select 'three'"))).toBe(false);
  });

  it('rolls everything back when the result is not what the plan promised', async () => {
    const diff = diffHistory(files, await readHistory(db));
    const plan = planRepair(files, diff, {
      appliedThrough: '20260101000003',
      dropOrphans: ['20260101094500'],
    });
    const before = await readHistory(db);
    await expect(applyRepair(db, files, { ...plan, fills: [] })).rejects.toThrow(
      /did not leave the history the plan promised/,
    );
    expect(await readHistory(db)).toEqual(before);
  });
});
