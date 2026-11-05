import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { failed, formatResults, runChecks } from './check';
import { connect, readOnlyApi } from './db';
import { listMigrations, type MigrationFile } from './files';
import { formatFingerprint, readFingerprint } from './fingerprint';
import { diffHistory, formatDiff, readHistory } from './history';
import { migrationForRollback, revert } from './rollback';
import { filesTable, publish, renderDryRun, type DryRunSummary } from './summary';
import { ManagementApi } from './supabase-api';
import { dbPush } from './supabase-cli';
import { PRODUCTION_REF, assertAllowed } from './target';

/**
 * The production side of the workflows.
 *
 *   plan      db-apply-prod.yml, before the owner's approval, read-only: production's pending files,
 *             checked against the passed dry run of the pull request; writes the manifest the apply
 *             must match.
 *   apply     db-apply-prod.yml, after the approval: re-checks the manifest against the checked-out
 *             files and against production, runs `supabase db push`, the checks and the fingerprint.
 *   rollback  db-rollback-prod.yml, after the approval: runs one tracked rollback file, then the
 *             checks and the fingerprint.
 *
 *   tsx scripts/db/production.ts plan --yes-production --dry-run-summary <json> --manifest-out <json>
 *   tsx scripts/db/production.ts apply --yes-production --manifest <json>
 *   tsx scripts/db/production.ts rollback --yes-production --file <version>_<name>.revert.sql
 */

export type Manifest = Array<{ file: string; sha256: string }>;

const asManifest = (files: MigrationFile[]): Manifest =>
  files.map((f) => ({ file: f.file, sha256: f.sha256 }));

/** Why the dry run does not cover the pending files; empty when it does. */
export function gateProblems(pending: MigrationFile[], summary: DryRunSummary): string[] {
  const problems: string[] = [];
  if (!summary.passed) problems.push('the dry run did not pass');
  const tested = new Map(summary.files.map((f) => [f.file, f.sha256]));
  for (const f of pending) {
    const sha = tested.get(f.file);
    if (sha === undefined) problems.push(`${f.file} was not in the dry run`);
    else if (sha !== f.sha256)
      problems.push(`${f.file} differs from the bytes the dry run applied`);
  }
  return problems;
}

/** Why the files about to be applied are not the approved manifest; empty when they are. */
export function manifestProblems(manifest: Manifest, pending: MigrationFile[]): string[] {
  const expected = JSON.stringify(manifest);
  const actual = JSON.stringify(asManifest(pending));
  return expected === actual
    ? []
    : [
        `the pending files are not the approved manifest\napproved: ${expected}\nnow:      ${actual}`,
      ];
}

async function pendingOnProduction(token: string): Promise<MigrationFile[]> {
  const files = listMigrations();
  const db = readOnlyApi(PRODUCTION_REF, token);
  const diff = diffHistory(files, await readHistory(db));
  if (diff.misversioned.length + diff.orphans.length + diff.withoutStatements.length > 0) {
    throw new Error(
      `production's history needs the repair in docs/ops/db-migrations.md\n${formatDiff(diff)}`,
    );
  }
  return diff.unrecorded;
}

async function plan(token: string, summaryPath: string, manifestOut: string): Promise<void> {
  const pending = await pendingOnProduction(token);
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as DryRunSummary;
  const problems = pending.length > 0 ? gateProblems(pending, summary) : [];
  writeFileSync(manifestOut, JSON.stringify(asManifest(pending)));
  publish(
    [
      `### Pending on production (${PRODUCTION_REF})`,
      '',
      filesTable(asManifest(pending)),
      '',
      renderDryRun(summary),
      ...(problems.length > 0
        ? ['', '**The gate refuses:**', ...problems.map((p) => `- ${p}`)]
        : []),
    ].join('\n'),
  );
  if (problems.length > 0) throw new Error(`the gate refuses:\n${problems.join('\n')}`);
}

async function apply(token: string, password: string, manifestPath: string): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const problems = manifestProblems(manifest, await pendingOnProduction(token));
  if (problems.length > 0) throw new Error(problems.join('\n'));
  if (manifest.length === 0) {
    publish('### Nothing to apply\n\nProduction has no pending migration files.');
    return;
  }
  const url = await new ManagementApi(token).poolerUrl(PRODUCTION_REF, password);
  const listed = await dbPush(url, { dryRun: true });
  const expected = manifest.map((m) => m.file);
  if (listed.files.join(',') !== expected.join(',')) {
    throw new Error(
      `the CLI would push [${listed.files.join(', ')}], not [${expected.join(', ')}]`,
    );
  }
  await dbPush(url, { dryRun: false });
  await report(url, `### Applied to production (${PRODUCTION_REF})\n\n${filesTable(manifest)}`);
}

async function rollback(token: string, password: string, file: string): Promise<void> {
  const migration = migrationForRollback(file);
  const url = await new ManagementApi(token).poolerUrl(PRODUCTION_REF, password);
  const db = connect(url);
  try {
    await revert(db, [migration]);
  } finally {
    await db.close();
  }
  await report(
    url,
    `### Rolled back on production (${PRODUCTION_REF})\n\n\`${file}\` reverted \`${migration.file}\`.`,
  );
}

/** Runs the checks and the fingerprint, writes both to the job summary, and fails on a check. */
async function report(url: string, heading: string): Promise<void> {
  const db = connect(url);
  try {
    const results = await runChecks(db);
    const fp = await readFingerprint(db);
    publish(
      [
        heading,
        '',
        '```',
        formatResults(results),
        '```',
        '',
        'Fingerprint:',
        '',
        '```',
        formatFingerprint(fp),
        '```',
      ].join('\n'),
    );
    if (failed(results)) throw new Error(`the checks fail\n${formatResults(results)}`);
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'yes-production': { type: 'boolean', default: false },
      'dry-run-summary': { type: 'string', default: '' },
      'manifest-out': { type: 'string', default: '' },
      manifest: { type: 'string', default: '' },
      file: { type: 'string', default: '' },
    },
  });
  assertAllowed(PRODUCTION_REF, values['yes-production']);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const [command] = positionals;
  if (command === 'plan') {
    await plan(token, values['dry-run-summary'], values['manifest-out']);
  } else if (command === 'apply' || command === 'rollback') {
    const password = process.env.SUPABASE_DB_PASSWORD;
    if (!password) throw new Error('SUPABASE_DB_PASSWORD is not set');
    if (command === 'apply') await apply(token, password, values.manifest);
    else await rollback(token, password, values.file);
  } else {
    throw new Error('usage: production.ts plan|apply|rollback --yes-production ...');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
