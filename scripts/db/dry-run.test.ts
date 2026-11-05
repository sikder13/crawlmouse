import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { dryRun, type DryRunDeps } from './dry-run';
import { listMigrations, type MigrationFile } from './files';
import { diffHistory, readHistory } from './history';
import { renderDryRun } from './summary';
import { HISTORY_TABLE, migratedDb, pgliteDb } from './test-support';

const THROUGH_001 = (f: string) => f.slice(0, 14) <= '20261101000001';
const files = listMigrations();

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

async function harness(
  options: {
    branchSetup?: string;
    cliList?: (pending: string[]) => string[];
    fileList?: MigrationFile[];
  } = {},
): Promise<Harness> {
  const production = await productionLike();
  const branch = await productionLike();
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
      return { ref: 'branchref', url: 'pglite://branch' };
    },
    deleteBranch: async (ref) => {
      deleted.push(ref);
    },
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
    const summary = await dryRun(h.deps, { branch: 'pr-1', commit: 'abc' });
    expect(summary.steps.filter((s) => s.result.startsWith('FAILED'))).toEqual([]);
    expect(summary.passed).toBe(true);
    expect(summary.steps.map((s) => s.step)).toEqual([
      'Create the branch from production',
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
    const summary = await dryRun(h.deps, { branch: 'pr-2', commit: 'abc' });
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
      const h = await harness({ branchSetup: setup });
      const summary = await dryRun(h.deps, { branch: 'pr-3', commit: 'abc' });
      expect(summary.passed).toBe(false);
      expect(summary.steps.at(-1)!.result).toContain('needs the repair');
      expect(summary.steps.at(-1)!.result).toContain(named);
      expect(h.calls).toEqual(['create pr-3']);
    },
    300_000,
  );

  it('fails when the pull request changes a migration that is already applied', async () => {
    const h = await harness();
    const summary = await dryRun(h.deps, {
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

  it('reverts and re-applies from an applied migration whose rollback the pull request changes', async () => {
    const h = await harness();
    const summary = await dryRun(h.deps, {
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
    });
    expect(summary.passed).toBe(false);
    expect(summary.steps.at(-1)!.result).toContain(
      'no rollback for 20991231000000_no_rollback.sql',
    );
    expect(h.calls).toEqual(['create pr-4']);
  }, 300_000);

  it('fails when the CLI would push other files than the pending ones', async () => {
    const h = await harness({ cliList: (pending) => pending.slice(1) });
    const summary = await dryRun(h.deps, { branch: 'pr-5', commit: 'abc' });
    expect(summary.passed).toBe(false);
    expect(summary.steps.at(-1)!.step).toBe('supabase db push');
    expect(summary.steps.at(-1)!.result).toContain('the CLI would push');
    expect(h.calls).toEqual(['create pr-5', 'push --dry-run']);
  }, 300_000);
});
