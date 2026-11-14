import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { listChecks } from './check';
import { dryRun, replayError, type DryRunDeps } from './dry-run';
import { listMigrations, type MigrationFile } from './files';
import { readFingerprint } from './fingerprint';
import { diffHistory, readHistory } from './history';
import type { ReplayState } from './supabase-api';
import { renderDryRun } from './summary';
import { HISTORY_TABLE, migratedDb, pgliteDb, productionBeforeP1 } from './test-support';

const THROUGH_001 = (f: string) => f.slice(0, 14) <= '20261101000001';
// The v2 set as it stood when production recorded 006b, pending against production migrated
// through 001. Later files are left out of this fixture: P1's rollback is deliberately empty, so it
// cannot restore a database that lacked what P1 adds. The fixture of production before P1 and P2,
// below, is the one where they and every later file are pending.
const files = listMigrations().filter((f) => f.version <= '20261103000001');
// Check 08 asserts the client grants as 20261106000002 (P2) left them, check 09 the definer
// functions' search_path as 20261108000002 left it, and check 01 the v2 column grants as
// 20261118000001 left them (accounts.card_last4 revoked); this fixture predates all three: its v1
// tables carry the broad grants production had then, and authenticated still selects card_last4.
// The fixture of production before P1 and P2, below, has every file pending and runs every check.
const V2_SET_CHECKS = listChecks().filter(
  (c) =>
    c.file !== '01-client-table-privileges.sql' &&
    c.file !== '08-v1-client-grants.sql' &&
    c.file !== '09-definer-search-path.sql',
);

describe('the fixture of production before P1 and P2 holds what was measured there', () => {
  it('the bucket, the service_role sequence defaults and the client lines, read back by the fingerprint', async () => {
    const read = (name: string) =>
      JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as Record<
        string,
        Record<string, string[]>
      >;
    const settled = read('2026-11-06-settled-branch-vs-production.json').only_on_production!;
    const before = read('20261106000002-expected-change.json').before!;
    const fp = await readFingerprint(pgliteDb(await productionBeforeP1()));
    expect(fp.get('buckets')!.lines).toContain(settled.buckets![0]);
    const defaults = fp.get('default_acls')!.lines;
    for (const line of settled.default_acls!.filter((l) => / service_role /.test(l)))
      expect(defaults).toContain(line);
    const clientDefaults = defaults.filter((l) => /: (anon|authenticated) [A-Z]+$/.test(l)).sort();
    expect(clientDefaults).toEqual([...before.default_acls!].sort());
    const acls = new Set(fp.get('acls')!.lines);
    for (const line of before.acls!) expect(acls.has(line), line).toBe(true);
  }, 300_000);
});

describe('the v2-set fixture', () => {
  it('runs checks 02 to 07, every check but 01, 08 and 09', () => {
    expect(V2_SET_CHECKS.map((c) => c.file)).toEqual([
      '02-partitions-rls-owner-only.sql',
      '03-worker-roles-no-login.sql',
      '04-private-schemas.sql',
      '05-private-buckets.sql',
      '06-client-functions.sql',
      '07-partition-triggers.sql',
    ]);
  });
});

/**
 * A stand-in for production with migrations still to apply: migrated through 001, with a clean
 * history of those files, so 003, 005, 007 and 006b are pending.
 */
async function productionLike(): Promise<PGlite> {
  const pg = await migratedDb(THROUGH_001);
  await pg.exec(HISTORY_TABLE);
  for (const m of files.filter((f) => THROUGH_001(f.file))) {
    await pg.query(
      'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
      [m.version, m.name, [m.sql]],
    );
  }
  return pg;
}

interface Harness {
  deps: DryRunDeps;
  calls: string[];
  deleted: string[];
  logged: string[];
}

const REPLAYED: ReplayState = {
  settled: true,
  failed: [],
  steps: 'configure=EXITED deploy=EXITED migrate=EXITED pull=EXITED',
};

async function harness(
  options: {
    branchSetup?: string;
    /** Run on production and the branch alike: the branch's history is built from production's. */
    bothSetup?: string;
    /** Run on production only: what production records that the branch's replay did not reach. */
    productionSetup?: string;
    cliList?: (pending: string[]) => string[];
    fileList?: MigrationFile[];
    replay?: ReplayState;
    replayLog?: string | null;
    /** Production and the branch as one stands built from the other: productionLike by default. */
    database?: () => Promise<PGlite>;
    /** What createBranch returns, when a test needs other than the default branch. */
    created?: { ref: string; url: string };
  } = {},
): Promise<Harness> {
  const production = await (options.database ?? productionLike)();
  const branch = await (options.database ?? productionLike)();
  if (options.bothSetup) {
    await production.exec(options.bothSetup);
    await branch.exec(options.bothSetup);
  }
  if (options.productionSetup) await production.exec(options.productionSetup);
  if (options.branchSetup) await branch.exec(options.branchSetup);
  const calls: string[] = [];
  const deleted: string[] = [];
  const logged: string[] = [];
  const pendingOf = async () => {
    const diff = diffHistory(options.fileList ?? files, await readHistory(pgliteDb(branch)));
    return diff.unrecorded;
  };
  const deps: DryRunDeps = {
    createBranch: async (name) => {
      calls.push(`create ${name}`);
      return options.created ?? { ref: 'branchref', url: 'pglite://branch' };
    },
    deleteBranch: async (ref) => {
      deleted.push(ref);
    },
    waitForReplay: async () => options.replay ?? REPLAYED,
    replayLog: async () => options.replayLog ?? null,
    production: () => pgliteDb(production),
    connect: () => pgliteDb(branch),
    // What the CLI does: each pending file in a transaction, recorded in the history.
    push: async (_url, { dryRun }) => {
      const pending = await pendingOf();
      calls.push(dryRun ? 'push --dry-run' : 'push');
      const names = pending.map((m) => m.file);
      if (dryRun) return { files: options.cliList ? options.cliList(names) : names };
      for (const m of pending) {
        await branch.transaction(async (tx) => {
          await tx.exec(m.sql);
          await tx.query(
            'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
            [m.version, m.name, [m.sql]],
          );
        });
      }
      return { files: names };
    },
    log: (line) => {
      logged.push(line);
    },
  };
  return { deps, calls, deleted, logged };
}

describe('the dry run', () => {
  it('passes on a copy of production, lists the four files with their sha256, and deletes the branch', async () => {
    const h = await harness();
    const summary = await dryRun(h.deps, {
      files,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-1',
      commit: 'abc',
    });
    expect(summary.steps.filter((s) => s.result.startsWith('FAILED'))).toEqual([]);
    expect(summary.passed).toBe(true);
    expect(summary.steps.map((s) => s.step)).toEqual([
      'Create the branch from production',
      'Branch replayed every recorded migration',
      'Branch fingerprint equals the production fingerprint',
      'History is clean and each pending file has a rollback',
      'supabase db push',
      'Checks',
      'Each file runs again and changes nothing',
      'Rollbacks in reverse order restore the production fingerprint',
      'supabase db push again',
    ]);
    expect(summary.files).toEqual(
      files
        .filter((f) => f.version > '20261101000001')
        .map((f) => ({ file: f.file, sha256: f.sha256 })),
    );
    expect(summary.files).toHaveLength(4);
    expect(summary.rollbacks.map((r) => r.file)).toEqual(
      [...summary.files].reverse().map((f) => f.file.replace(/\.sql$/, '.revert.sql')),
    );
    expect(h.calls).toEqual(['create pr-1', 'push --dry-run', 'push', 'push --dry-run', 'push']);
    expect(h.deleted).toEqual(['branchref']);
    expect(renderDryRun(summary)).toContain(
      `| \`${summary.files[0]!.file}\` | \`${summary.files[0]!.sha256}\` |`,
    );
  }, 300_000);

  it('fails before any push when the branch is not a copy of production, naming the section', async () => {
    const h = await harness({ branchSetup: 'grant select on public.accounts to anon' });
    const summary = await dryRun(h.deps, {
      files,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-2',
      commit: 'abc',
    });
    expect(summary.passed).toBe(false);
    const failure = summary.steps.at(-1)!;
    expect(failure.step).toBe('Branch fingerprint equals the production fingerprint');
    expect(failure.result).toContain(
      'sections differ: acls (1 only on the branch, 0 only on production)',
    );
    // The lines go to the job log, not into the summary posted on the pull request.
    expect(failure.result).not.toContain('relation public.accounts anon SELECT');
    expect(h.logged.join('\n')).toContain('+ relation public.accounts anon SELECT');
    expect(h.calls).toEqual(['create pr-2']);
    expect(h.deleted).toEqual(['branchref']);
  }, 300_000);

  it.each([
    [
      'a row with no file',
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ('20260601174823', 'harden_handle_new_user_grants', array['revoke ...'])`,
      '20260601174823 harden_handle_new_user_grants',
    ],
    [
      'a row holding only a comment, as the owner inserted for 003 to 006b',
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ('20261102000001', 'v2_003_sites_checks', array['-- applied by owner (sha256 9380c15d)'])`,
      '20261102000001 v2_003_sites_checks',
    ],
  ])(
    "fails before any push while production's history needs the repair: %s",
    async (_label, setup, named) => {
      const h = await harness({ bothSetup: setup });
      const summary = await dryRun(h.deps, {
        files,
        checkFiles: V2_SET_CHECKS,
        branch: 'pr-3',
        commit: 'abc',
      });
      expect(summary.passed).toBe(false);
      expect(summary.steps.at(-1)!.result).toContain('needs the repair');
      expect(summary.steps.at(-1)!.result).toContain(named);
      expect(h.calls).toEqual(['create pr-3']);
    },
    300_000,
  );

  it('fails when the pull request changes a migration that is already applied', async () => {
    // The file's bytes now differ from what production recorded for it.
    const edited = files.map((f) =>
      f.file === '20260524000001_init_users.sql'
        ? { ...f, sql: `${f.sql}\nalter table public.users add column nickname text;\n` }
        : f,
    );
    const h = await harness({ fileList: edited });
    const summary = await dryRun(h.deps, {
      files: edited,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-6',
      commit: 'abc',
      changed: ['infra/supabase/migrations/20260524000001_init_users.sql'],
    });
    expect(summary.passed).toBe(false);
    expect(summary.steps.at(-1)!.result).toContain(
      '20260524000001_init_users.sql is already applied',
    );
    expect(h.calls).toEqual(['create pr-6']);
  }, 300_000);

  it.each([
    ['an added comment', (sql: string) => `-- a note added later\n${sql}`],
    ['a trailing newline', (sql: string) => `${sql}\n`],
  ])(
    'fails when an applied migration differs from its recorded bytes only by %s',
    async (_label, edit) => {
      const edited = files.map((f) =>
        f.file === '20260524000001_init_users.sql' ? { ...f, sql: edit(f.sql) } : f,
      );
      expect(edited.find((f) => f.file === '20260524000001_init_users.sql')!.sql).not.toBe(
        files.find((f) => f.file === '20260524000001_init_users.sql')!.sql,
      );
      const h = await harness({ fileList: edited });
      const summary = await dryRun(h.deps, {
        files: edited,
        checkFiles: V2_SET_CHECKS,
        branch: 'pr-6b',
        commit: 'abc',
        changed: ['infra/supabase/migrations/20260524000001_init_users.sql'],
      });
      expect(summary.passed).toBe(false);
      expect(summary.steps.at(-1)!.result).toContain(
        '20260524000001_init_users.sql is already applied',
      );
    },
    300_000,
  );

  it('accepts a migration the pull request adds when production recorded exactly its bytes before merge', async () => {
    // P1 and P2 of this pull request: applied to production ahead of the merge, with a history row
    // holding the file's bytes, so the file is in the diff against main and already recorded.
    // The branch's own row holds the statements split, as Supabase's replay records them.
    const h = await harness({
      branchSetup: `update supabase_migrations.schema_migrations
        set statements = array['create table x ()', 'alter table x enable row level security']
        where version = '20260524000001'`,
    });
    const summary = await dryRun(h.deps, {
      files,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-6c',
      commit: 'abc',
      changed: ['infra/supabase/migrations/20260524000001_init_users.sql'],
    });
    const history = summary.steps.find(
      (s) => s.step === 'History is clean and each pending file has a rollback',
    )!;
    expect(history.result).not.toContain('FAILED');
    expect(history.result).not.toContain('20260524000001_init_users.sql');
  }, 300_000);

  it('reverts and re-applies from an applied migration whose rollback the pull request changes', async () => {
    const h = await harness();
    const summary = await dryRun(h.deps, {
      files,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-7',
      commit: 'abc',
      changed: ['infra/supabase/rollbacks/20261101000001_v2_001_entitlement_tables.revert.sql'],
    });
    expect(summary.steps.filter((s) => s.result.startsWith('FAILED'))).toEqual([]);
    expect(summary.passed).toBe(true);
    const last = summary.steps.at(-1)!;
    expect(last.step).toBe('Changed rollbacks of applied migrations revert and re-apply');
    expect(last.result).toContain(
      'reverted and re-applied 20261101000001_v2_001_entitlement_tables.sql',
    );
    expect(summary.rollbacks.map((r) => r.file)).toContain(
      '20261101000001_v2_001_entitlement_tables.revert.sql',
    );
    expect(h.calls.slice(-2)).toEqual(['push --dry-run', 'push']);
  }, 300_000);

  it('fails when a pending migration has no rollback', async () => {
    const extra: MigrationFile = {
      version: '20991231000000',
      name: 'no_rollback',
      file: '20991231000000_no_rollback.sql',
      path: '/nowhere',
      sql: 'select 1;',
      sha256: 'x',
    };
    const h = await harness({ fileList: [...files, extra] });
    const summary = await dryRun(h.deps, {
      branch: 'pr-4',
      commit: 'abc',
      files: [...files, extra],
      checkFiles: V2_SET_CHECKS,
    });
    expect(summary.passed).toBe(false);
    expect(summary.steps.at(-1)!.result).toContain(
      'no rollback for 20991231000000_no_rollback.sql',
    );
    expect(h.calls).toEqual(['create pr-4']);
  }, 300_000);

  it('fails when the CLI would push other files than the pending ones', async () => {
    const h = await harness({ cliList: (pending) => pending.slice(1) });
    const summary = await dryRun(h.deps, {
      files,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-5',
      commit: 'abc',
    });
    expect(summary.passed).toBe(false);
    expect(summary.steps.at(-1)!.step).toBe('supabase db push');
    expect(summary.steps.at(-1)!.result).toContain('the CLI would push');
    expect(h.calls).toEqual(['create pr-5', 'push --dry-run']);
  }, 300_000);
  it('fails before the fingerprint when the branch did not record every migration, naming the first and its error', async () => {
    const h = await harness({
      productionSetup: `insert into supabase_migrations.schema_migrations (version, name, statements)
        values ('20261104000001', 'zz_needs_a_hand_made_table', array['select * from public.zz_made_by_hand'])`,
    });
    const summary = await dryRun(h.deps, {
      files,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-8',
      commit: 'abc',
    });
    expect(summary.passed).toBe(false);
    const failure = summary.steps.at(-1)!;
    expect(failure.step).toBe('Branch replayed every recorded migration');
    expect(failure.result).toContain('the branch has not recorded 1 of');
    expect(failure.result).toContain('first missing: 20261104000001 zz_needs_a_hand_made_table');
    // No run log: the error comes from running that migration's recorded statements on the
    // throwaway branch, in a transaction that is rolled back.
    expect(failure.result).toContain('error: relation "public.zz_made_by_hand" does not exist');
    expect(failure.result).toContain('replay steps: configure=EXITED');
    expect(h.logged.join('\n')).not.toContain('::group::Branch fingerprint');
    expect(h.calls).toEqual(['create pr-8']);
    expect(h.deleted).toEqual(['branchref']);
  }, 300_000);

  it('says so when the missing migration runs without error on the branch', async () => {
    // 001 is written to run again on a database that has it, so re-running it raises nothing.
    const h = await harness({
      branchSetup: `delete from supabase_migrations.schema_migrations where version >= '20261101000001'`,
    });
    const summary = await dryRun(h.deps, {
      files,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-11',
      commit: 'abc',
    });
    const failure = summary.steps.at(-1)!;
    expect(failure.step).toBe('Branch replayed every recorded migration');
    expect(failure.result).toContain('first missing: 20261101000001 v2_001_entitlement_tables');
    expect(failure.result).toContain(
      'error: none: its recorded statements run on the branch without one',
    );
  }, 300_000);

  it('quotes the first error line of the run log when Supabase has one', async () => {
    const log = [
      'Applying migration 20261101000001_v2_001_entitlement_tables.sql...',
      // A line that mentions an error without being one: it must not be quoted as the error.
      'Loaded 20261029000001_error_handling.sql; ON_ERROR_STOP is set',
      'ERROR: relation "public.accounts" does not exist (SQLSTATE 42P01)',
      'At statement: 12',
    ].join('\n');
    const h = await harness({
      branchSetup: `delete from supabase_migrations.schema_migrations where version >= '20261101000001'`,
      replayLog: log,
    });
    const summary = await dryRun(h.deps, {
      files,
      checkFiles: V2_SET_CHECKS,
      branch: 'pr-9',
      commit: 'abc',
    });
    const failure = summary.steps.at(-1)!;
    expect(failure.step).toBe('Branch replayed every recorded migration');
    expect(failure.result).toContain(
      'error: ERROR: relation "public.accounts" does not exist (SQLSTATE 42P01)',
    );
    // Only the error line is used: the rest of Supabase's log is printed nowhere, since the job log
    // of a public repository is public.
    expect(failure.result).not.toContain('At statement: 12');
    expect(h.logged.join('\n')).not.toContain('At statement: 12');
  }, 300_000);

  it.each([
    [
      'a DEAD step',
      { settled: true, failed: ['migrate'], steps: 'deploy=EXITED migrate=DEAD' },
      "Supabase's replay ended with migrate failed (deploy=EXITED migrate=DEAD)",
    ],
    [
      'a replay that did not finish',
      { settled: false, failed: [], steps: 'migrate=RUNNING' },
      "the branch's replay did not finish (migrate=RUNNING)",
    ],
  ])(
    'fails at the replay step on %s, before the fingerprint',
    async (_label, replay, said) => {
      const h = await harness({ replay });
      const summary = await dryRun(h.deps, {
        files,
        checkFiles: V2_SET_CHECKS,
        branch: 'pr-10',
        commit: 'abc',
      });
      expect(summary.passed).toBe(false);
      const failure = summary.steps.at(-1)!;
      expect(failure.step).toBe('Branch replayed every recorded migration');
      expect(failure.result).toContain(said);
      expect(h.calls).toEqual(['create pr-10']);
    },
    300_000,
  );
  it.each([
    ['its ref', { ref: 'ezspnfeyzwsisymytssm', url: 'pglite://branch' }],
    [
      'its connection URL',
      {
        ref: 'branchref',
        url: 'postgresql://postgres.ezspnfeyzwsisymytssm:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
      },
    ],
  ])(
    'refuses a branch whose %s names production, before connecting to it',
    async (_l, created) => {
      const h = await harness({ created });
      const summary = await dryRun(h.deps, {
        files,
        checkFiles: V2_SET_CHECKS,
        branch: 'pr-12',
        commit: 'abc',
      });
      expect(summary.passed).toBe(false);
      expect(summary.steps).toHaveLength(1);
      expect(summary.steps[0]!.result).toContain(
        'names production (ezspnfeyzwsisymytssm); refusing',
      );
      expect(h.deleted).toEqual([]);
    },
    300_000,
  );
  it('passes on production as it stood before P1 and P2, with every file after 006b pending and every check', async () => {
    // A migration added after these is pending here too, so this run exercises it as well. The
    // branch is a clone of this database: what a real branch lacks is the live dry run's to show.
    const all = listMigrations();
    const after006b = all.filter((f) => f.version > '20261103000001');
    expect(after006b.map((f) => f.version)).toEqual(
      expect.arrayContaining(['20261106000001', '20261106000002']),
    );
    const h = await harness({ database: productionBeforeP1, fileList: all });
    const summary = await dryRun(h.deps, { files: all, branch: 'pr-13', commit: 'abc' });
    expect(summary.steps.filter((s) => s.result.startsWith('FAILED'))).toEqual([]);
    expect(summary.passed).toBe(true);
    expect(summary.files).toEqual(after006b.map((f) => ({ file: f.file, sha256: f.sha256 })));
    expect(summary.rollbacks.map((r) => r.file)).toEqual(
      [...after006b].reverse().map((f) => f.file.replace(/\.sql$/, '.revert.sql')),
    );
    const checks = summary.steps.find((s) => s.step === 'Checks')!;
    expect(checks.result).toBe(`${listChecks().length} checks pass`);
    expect(listChecks().map((c) => c.file)).toContain('08-v1-client-grants.sql');
    expect(listChecks().map((c) => c.file)).toContain('09-definer-search-path.sql');
  }, 300_000);
});

describe('replayError runs recorded statements on the branch and keeps nothing', () => {
  it('returns the first error and rolls back what ran before it', async () => {
    const pg = await migratedDb(THROUGH_001);
    const db = pgliteDb(pg);
    const error = await replayError(db, [
      'create table public.zz_replay_probe (id int)',
      'select * from public.zz_missing',
    ]);
    expect(error).toBe('relation "public.zz_missing" does not exist');
    expect(await db.query(`select to_regclass('public.zz_replay_probe') as t`)).toEqual([
      { t: null },
    ]);
  }, 300_000);

  it('returns null when every statement runs, and still keeps nothing', async () => {
    const pg = await migratedDb(THROUGH_001);
    const db = pgliteDb(pg);
    expect(await replayError(db, ['create table public.zz_replay_probe (id int)'])).toBeNull();
    expect(await db.query(`select to_regclass('public.zz_replay_probe') as t`)).toEqual([
      { t: null },
    ]);
  }, 300_000);
});
