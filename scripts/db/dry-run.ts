import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { failed, formatResults, runChecks } from './check';
import { connect, readOnlyApi, type Db } from './db';
import { listMigrations, rollbackPath, sha256, type MigrationFile } from './files';
import {
  compareFingerprints,
  formatDifferenceCounts,
  formatDifferences,
  readFingerprint,
  type Fingerprint,
} from './fingerprint';
import { diffHistory, formatDiff, readHistory, type HistoryRow } from './history';
import { missingRollbacks, rerun, revert } from './rollback';
import { digests, fileList, publish, renderDryRun, type DryRunSummary } from './summary';
import { ManagementApi, waitForBranch, waitForReplay, type ReplayState } from './supabase-api';
import { dbPush } from './supabase-cli';
import { PRODUCTION_REF, refOfUrl } from './target';

/**
 * The migration dry run, as db-dry-run.yml runs it for a pull request:
 *
 *   1. delete the PR's Supabase branch if one exists, create it again from production, wait for it
 *   2. Supabase's replay of production's history onto the branch finished, and the branch recorded
 *      every migration production records; otherwise name the first missing one and its error
 *   3. the branch fingerprint equals the production fingerprint, section by section
 *   4. its history is clean, and every pending file has a rollback
 *   5. `supabase db push` applies the pending files (the CLI's list must equal them)
 *   6. the catalog checks pass
 *   7. each pending file runs again in its own transaction, and the fingerprint does not change
 *   8. the rollbacks run in reverse order, and the fingerprint equals production's again
 *   9. `supabase db push` applies them once more; fingerprint and checks as after step 6
 *  10. if the pull request changes the rollback of an applied migration: the migrations from that
 *      one on are reverted, newest first, and pushed again, and the fingerprint must not change
 *
 * Step 4 also fails when the pull request changes a migration file that is already applied:
 * production would never receive the change. Add a new migration instead.
 *
 * Any failed step stops the run, and the summary says which step and why. The branch is deleted
 * at the end, pass or fail.
 *
 *   SUPABASE_ACCESS_TOKEN=... tsx scripts/db/dry-run.ts --branch <name> --commit <sha> \
 *     --summary-json <path> [--summary-md <path>] [--changed <file listing changed paths>]
 */

export interface DryRunDeps {
  /** Creates the branch (deleting one of that name first) and returns a connection URL for it. */
  createBranch(name: string): Promise<{ ref: string; url: string }>;
  deleteBranch(ref: string): Promise<void>;
  /** Waits for Supabase's replay of production's history onto the branch to finish. */
  waitForReplay(ref: string): Promise<ReplayState>;
  /** The replay's run log, or null when Supabase has none. */
  replayLog(ref: string): Promise<string | null>;
  production(): Db;
  connect(url: string): Db;
  push(url: string, options: { dryRun: boolean }): Promise<{ files: string[] }>;
  log(line: string): void;
}

export class StepFailed extends Error {}

/**
 * Runs a migration's recorded statements on the branch in a transaction that is always rolled
 * back, and returns the first error's message, or null when every statement ran. The branch is a
 * throwaway copy, and nothing is kept either way, unless a statement ends the transaction itself (no
 * migration file in this repository has a top-level `commit` or `begin`).
 */
export async function replayError(db: Db, statements: string[]): Promise<string | null> {
  const ranClean = new Error('every statement ran; rolling back');
  try {
    await db.transaction(async (tx) => {
      for (const statement of statements) await tx.exec(statement);
      throw ranClean;
    });
  } catch (err) {
    if (err === ranClean) return null;
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

export async function dryRun(
  deps: DryRunDeps,
  {
    branch,
    commit,
    files = listMigrations(),
    changed = [],
  }: {
    branch: string;
    commit: string;
    files?: MigrationFile[];
    /** Repository paths the pull request changes. */
    changed?: string[];
  },
): Promise<DryRunSummary> {
  const summary: DryRunSummary = {
    passed: false,
    commit,
    branch,
    finishedAt: '',
    steps: [],
    files: [],
    rollbacks: [],
    production: {},
  };
  const changedNames = new Set(changed.map((p) => basename(p)));
  const step = async <T>(name: string, fn: () => Promise<[T, string]>): Promise<T> => {
    deps.log(`::group::${name}`);
    try {
      const [value, result] = await fn();
      summary.steps.push({ step: name, result });
      deps.log(result);
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.steps.push({ step: name, result: `FAILED: ${message}` });
      deps.log(`FAILED: ${message}`);
      throw new StepFailed(`${name}: ${message}`);
    } finally {
      deps.log('::endgroup::');
    }
  };
  // The run log's first error line when Supabase kept a log; otherwise the error the missing
  // migration's recorded statements raise on the branch.
  const firstError = async (ref: string, branchDb: Db, row: HistoryRow): Promise<string> => {
    const log = await deps.replayLog(ref).catch(() => null);
    if (log) {
      // Only the error line is used: the job log of a public repository is public, so the rest
      // of Supabase's log is not printed.
      const line = log.split('\n').find((l) => /^\s*(ERROR|FATAL)\b/.test(l));
      if (line) return line.trim();
    }
    const error = await replayError(branchDb, row.statements ?? []);
    return error ?? 'none: its recorded statements run on the branch without one';
  };
  const same = (
    expected: Fingerprint,
    actual: Fingerprint,
    labels: { expected: string; actual: string },
  ) => {
    const differences = compareFingerprints(expected, actual);
    if (differences.length > 0) {
      // The differing lines go to the job log; the summary, posted on the pull request, names the
      // sections and counts the lines.
      deps.log(formatDifferences(differences, labels));
      throw new Error(
        `sections differ: ${formatDifferenceCounts(differences, labels)}; the lines are in the job log`,
      );
    }
  };

  let created: { ref: string; url: string } | undefined;
  let db: Db | undefined;
  const prodDb = deps.production();
  try {
    created = await step('Create the branch from production', async () => {
      const b = await deps.createBranch(branch);
      // Everything below writes to this database: refuse one that names production.
      if (b.ref === PRODUCTION_REF || refOfUrl(b.url) === PRODUCTION_REF) {
        throw new Error(`the branch connection names production (${PRODUCTION_REF}); refusing`);
      }
      return [b, `branch ${b.ref}`];
    });
    db = deps.connect(created.url);
    const branchDb = db;
    const createdRef = created.ref;

    await step('Branch replayed every recorded migration', async () => {
      const replay = await deps.waitForReplay(createdRef);
      const recorded = await readHistory(prodDb);
      const onBranch = new Set((await readHistory(branchDb)).map((r) => r.version));
      const missing = recorded.filter((r) => !onBranch.has(r.version));
      if (replay.settled && replay.failed.length === 0 && missing.length === 0) {
        return [
          undefined,
          `all ${recorded.length} recorded migrations; replay steps: ${replay.steps}`,
        ];
      }
      const problems: string[] = [];
      if (!replay.settled) problems.push(`the branch's replay did not finish (${replay.steps})`);
      if (replay.failed.length > 0) {
        problems.push(
          `Supabase's replay ended with ${replay.failed.join(', ')} failed (${replay.steps})`,
        );
      }
      if (missing.length > 0) {
        const first = missing[0]!;
        problems.push(
          `the branch has not recorded ${missing.length} of ${recorded.length} migrations; ` +
            `first missing: ${first.version} ${first.name ?? ''}`.trimEnd(),
        );
        problems.push(`error: ${await firstError(createdRef, branchDb, first)}`);
      }
      if (replay.settled && replay.failed.length === 0)
        problems.push(`replay steps: ${replay.steps}`);
      throw new Error(problems.join('; '));
    });

    const production = await step(
      'Branch fingerprint equals the production fingerprint',
      async () => {
        const prod = await readFingerprint(prodDb);
        same(prod, await readFingerprint(branchDb), {
          expected: 'production',
          actual: 'the branch',
        });
        summary.production = digests(prod);
        return [prod, `fingerprint equal in all ${prod.size} sections`];
      },
    );

    const pending = await step(
      'History is clean and each pending file has a rollback',
      async () => {
        const diff = diffHistory(files, await readHistory(branchDb));
        if (diff.misversioned.length + diff.orphans.length + diff.withoutStatements.length > 0) {
          throw new Error(
            `production's history needs the repair in docs/ops/db-migrations.md first\n${formatDiff(diff)}`,
          );
        }
        const editedApplied = files.filter(
          (f) => !diff.unrecorded.includes(f) && changedNames.has(f.file),
        );
        if (editedApplied.length > 0) {
          throw new Error(
            `${editedApplied.map((f) => f.file).join(', ')} is already applied; ` +
              'production would never receive the change. Add a new migration instead',
          );
        }
        const missing = missingRollbacks(diff.unrecorded);
        if (missing.length > 0) {
          throw new Error(`no rollback for ${missing.map((m) => m.file).join(', ')}`);
        }
        summary.files = fileList(diff.unrecorded);
        const names = diff.unrecorded.map((f) => f.file).join(', ') || 'none';
        return [diff.unrecorded, `pending: ${names}`];
      },
    );

    const push = async (toPush: MigrationFile[]) => {
      const listed = await deps.push(created!.url, { dryRun: true });
      const expected = toPush.map((f) => f.file);
      if (listed.files.join(',') !== expected.join(',')) {
        throw new Error(
          `the CLI would push [${listed.files.join(', ')}], not [${expected.join(', ')}]`,
        );
      }
      await deps.push(created!.url, { dryRun: false });
    };
    const checks = async () => {
      const results = await runChecks(branchDb);
      if (failed(results)) throw new Error(formatResults(results));
      return `${results.length} checks pass`;
    };

    const revertAll = async (migrations: MigrationFile[]) => {
      await revert(branchDb, migrations, deps.log);
      for (const m of migrations) {
        summary.rollbacks.push({
          file: basename(rollbackPath(m)),
          sha256: sha256(readFileSync(rollbackPath(m), 'utf8')),
        });
      }
    };

    await step('supabase db push', async () => [
      await push(pending),
      `applied ${pending.length} file(s)`,
    ]);
    await step('Checks', async () => [undefined, await checks()]);
    const applied = await readFingerprint(branchDb);

    await step('Each file runs again and changes nothing', async () => {
      await rerun(branchDb, pending, deps.log);
      same(applied, await readFingerprint(branchDb), {
        expected: 'after the push',
        actual: 'after the re-run',
      });
      return [undefined, 'fingerprint unchanged'];
    });

    await step('Rollbacks in reverse order restore the production fingerprint', async () => {
      await revertAll([...pending].reverse());
      same(production, await readFingerprint(branchDb), {
        expected: 'production',
        actual: 'after the rollbacks',
      });
      return [undefined, 'fingerprint equals production'];
    });

    await step('supabase db push again', async () => {
      await push(pending);
      same(applied, await readFingerprint(branchDb), {
        expected: 'the first push',
        actual: 'the second push',
      });
      return [undefined, `fingerprint equals the first push; ${await checks()}`];
    });

    const appliedBefore = files.filter((f) => !pending.includes(f));
    const changedRollbacks = appliedBefore.filter((m) =>
      changedNames.has(basename(rollbackPath(m))),
    );
    if (changedRollbacks.length > 0) {
      await step('Changed rollbacks of applied migrations revert and re-apply', async () => {
        const oldest = changedRollbacks[0]!.version;
        const range = files.filter((f) => f.version >= oldest);
        const missing = missingRollbacks(range);
        if (missing.length > 0) {
          throw new Error(`no rollback for ${missing.map((m) => m.file).join(', ')}`);
        }
        const before = await readFingerprint(branchDb);
        await revertAll([...range].reverse());
        await push(range);
        same(before, await readFingerprint(branchDb), {
          expected: 'before the rollbacks',
          actual: 'after the rollbacks and the push',
        });
        const names = range.map((f) => f.file).join(', ');
        return [
          undefined,
          `reverted and re-applied ${names}; fingerprint unchanged; ${await checks()}`,
        ];
      });
    }

    summary.passed = true;
  } catch (err) {
    if (!(err instanceof StepFailed)) {
      summary.steps.push({ step: 'The run itself', result: `FAILED: ${String(err)}` });
    }
  } finally {
    summary.finishedAt = new Date().toISOString();
    await db?.close();
    await prodDb.close();
    if (created) {
      await deps.deleteBranch(created.ref).catch((err: unknown) => {
        deps.log(`could not delete branch ${created!.ref}: ${String(err)}`);
      });
    }
  }
  return summary;
}

function liveDeps(token: string): DryRunDeps {
  const api = new ManagementApi(token);
  return {
    async createBranch(name) {
      for (const old of await api.listBranches(PRODUCTION_REF)) {
        if (old.name === name) {
          console.log(`deleting the previous branch ${old.project_ref}`);
          await api.deleteBranch(old.project_ref);
        }
      }
      const branch = await api.createBranch(PRODUCTION_REF, name);
      await waitForBranch(api, PRODUCTION_REF, branch.project_ref);
      const password = await api.branchPassword(branch.project_ref);
      return { ref: branch.project_ref, url: await api.poolerUrl(branch.project_ref, password) };
    },
    deleteBranch: (ref) => api.deleteBranch(ref),
    waitForReplay: (ref) => waitForReplay(api, ref),
    async replayLog(ref) {
      const runs = await api.listActionRuns(ref);
      const newest = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return newest ? api.actionRunLog(ref, newest.id) : null;
    },
    production: () => readOnlyApi(PRODUCTION_REF, token),
    connect,
    push: (url, { dryRun }) => dbPush(url, { dryRun }),
    log: (line) => console.log(line),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      branch: { type: 'string' },
      commit: { type: 'string', default: 'local' },
      'summary-json': { type: 'string' },
      'summary-md': { type: 'string' },
      changed: { type: 'string' },
    },
  });
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  if (!values.branch) throw new Error('--branch <name> is required');
  const changed = values.changed
    ? readFileSync(values.changed, 'utf8').split('\n').filter(Boolean)
    : [];
  const summary = await dryRun(liveDeps(token), {
    branch: values.branch,
    commit: values.commit,
    changed,
  });
  if (values['summary-json'])
    writeFileSync(values['summary-json'], JSON.stringify(summary, null, 2));
  publish(renderDryRun(summary), values['summary-md']);
  if (!summary.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
