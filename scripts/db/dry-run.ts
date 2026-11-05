import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { failed, formatResults, runChecks } from './check';
import { connect, readOnlyApi, type Db } from './db';
import { listMigrations, type MigrationFile } from './files';
import {
  compareFingerprints,
  formatDifferences,
  readFingerprint,
  type Fingerprint,
} from './fingerprint';
import { diffHistory, formatDiff, readHistory } from './history';
import { missingRollbacks, rerun, revert } from './rollback';
import { digests, fileList, publish, renderDryRun, type DryRunSummary } from './summary';
import { ManagementApi, waitForBranch } from './supabase-api';
import { dbPush } from './supabase-cli';
import { PRODUCTION_REF } from './target';

/**
 * The migration dry run, as db-dry-run.yml runs it for a pull request:
 *
 *   1. delete the PR's Supabase branch if one exists, create it again from production, wait for it
 *   2. the branch is a copy of production: its fingerprint equals production's, section by section
 *   3. its history is clean, and every pending file has a rollback
 *   4. `supabase db push` applies the pending files (the CLI's list must equal them)
 *   5. the catalog checks pass
 *   6. each pending file runs again in its own transaction, and the fingerprint does not change
 *   7. the rollbacks run in reverse order, and the fingerprint equals production's again
 *   8. `supabase db push` applies them once more; fingerprint and checks as after step 5
 *
 * Any failed step stops the run, and the summary says which step and why. The branch is deleted
 * at the end, pass or fail.
 *
 *   SUPABASE_ACCESS_TOKEN=... tsx scripts/db/dry-run.ts --branch <name> --commit <sha> \
 *     --summary-json <path> [--summary-md <path>]
 */

export interface DryRunDeps {
  /** Creates the branch (deleting one of that name first) and returns a connection URL for it. */
  createBranch(name: string): Promise<{ ref: string; url: string }>;
  deleteBranch(ref: string): Promise<void>;
  production(): Db;
  connect(url: string): Db;
  push(url: string, options: { dryRun: boolean }): Promise<{ files: string[] }>;
  log(line: string): void;
}

export class StepFailed extends Error {}

export async function dryRun(
  deps: DryRunDeps,
  {
    branch,
    commit,
    files = listMigrations(),
  }: { branch: string; commit: string; files?: MigrationFile[] },
): Promise<DryRunSummary> {
  const summary: DryRunSummary = {
    passed: false,
    commit,
    branch,
    finishedAt: '',
    steps: [],
    files: [],
    production: {},
  };
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
  const same = (
    expected: Fingerprint,
    actual: Fingerprint,
    labels: { expected: string; actual: string },
  ) => {
    const differences = compareFingerprints(expected, actual);
    if (differences.length > 0) {
      const names = differences.map((d) => d.section).join(', ');
      throw new Error(`sections differ: ${names}\n${formatDifferences(differences, labels)}`);
    }
  };

  let created: { ref: string; url: string } | undefined;
  let db: Db | undefined;
  const prodDb = deps.production();
  try {
    created = await step('Create the branch from production', async () => {
      const b = await deps.createBranch(branch);
      return [b, `branch ${b.ref}`];
    });
    db = deps.connect(created.url);
    const branchDb = db;

    const production = await step('The branch is a copy of production', async () => {
      const prod = await readFingerprint(prodDb);
      same(prod, await readFingerprint(branchDb), { expected: 'production', actual: 'the branch' });
      summary.production = digests(prod);
      return [prod, `fingerprint equal in all ${prod.size} sections`];
    });

    const pending = await step(
      'History is clean and each pending file has a rollback',
      async () => {
        const diff = diffHistory(files, await readHistory(branchDb));
        if (diff.misversioned.length + diff.orphans.length + diff.withoutStatements.length > 0) {
          throw new Error(
            `production's history needs the repair in docs/ops/db-migrations.md first\n${formatDiff(diff)}`,
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

    const push = async () => {
      const listed = await deps.push(created!.url, { dryRun: true });
      const expected = pending.map((f) => f.file);
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

    await step('supabase db push', async () => [await push(), `applied ${pending.length} file(s)`]);
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

    await step('Rollbacks in reverse order return the branch to production', async () => {
      await revert(branchDb, [...pending].reverse(), deps.log);
      same(production, await readFingerprint(branchDb), {
        expected: 'production',
        actual: 'after the rollbacks',
      });
      return [undefined, 'fingerprint equals production'];
    });

    await step('supabase db push again', async () => {
      await push();
      same(applied, await readFingerprint(branchDb), {
        expected: 'the first push',
        actual: 'the second push',
      });
      return [undefined, `fingerprint equals the first push; ${await checks()}`];
    });

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
    },
  });
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  if (!values.branch) throw new Error('--branch <name> is required');
  const summary = await dryRun(liveDeps(token), { branch: values.branch, commit: values.commit });
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
