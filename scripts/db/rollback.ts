import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { failed, formatResults, runChecks } from './check';
import type { Db } from './db';
import { hasRollback, listMigrations, rollbackPath, type MigrationFile } from './files';
import { openTarget } from './target';

/**
 * Runs rollback files and re-runs migration files, each as one transaction holding the tracked
 * file's bytes.
 *
 *   tsx scripts/db/rollback.ts --db-url-env DB_URL --file <version>_<name>.revert.sql [--yes-production]
 */

export const FORGET_VERSION =
  'delete from supabase_migrations.schema_migrations where version = $1 returning version';

export function missingRollbacks(migrations: MigrationFile[]): MigrationFile[] {
  return migrations.filter((m) => !hasRollback(m));
}

/**
 * Reverts each migration in the order given. One transaction per file runs the rollback's bytes and
 * deletes the migration's history row, so a revert that fails leaves both the schema and the history
 * as they were, and a migration that is not recorded is refused.
 */
export async function revert(
  db: Db,
  migrations: MigrationFile[],
  log = console.log,
): Promise<void> {
  for (const m of migrations) {
    const path = rollbackPath(m);
    const sql = readFileSync(path, 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      const forgotten = await tx.query(FORGET_VERSION, [m.version]);
      if (forgotten.length !== 1) {
        throw new Error(
          `${m.file} is not recorded as applied, so ${basename(path)} was rolled back`,
        );
      }
    });
    log(`reverted ${m.file} with ${basename(path)}`);
  }
}

/** Runs each migration's bytes again, one transaction per file, leaving the history alone. */
export async function rerun(db: Db, migrations: MigrationFile[], log = console.log): Promise<void> {
  for (const m of migrations) {
    await db.transaction((tx) => tx.exec(m.sql));
    log(`re-ran ${m.file}`);
  }
}

const REVERT_FILE = /^(\d{14})_([a-z0-9_]+)\.revert\.sql$/;

/** The migration a rollback file name reverts, refusing any name that is not a tracked rollback. */
export function migrationForRollback(file: string, migrations = listMigrations()): MigrationFile {
  if (!REVERT_FILE.test(file)) throw new Error(`${file} is not named <version>_<name>.revert.sql`);
  const migration = migrations.find((m) => basename(rollbackPath(m)) === file);
  if (!migration) throw new Error(`${file} matches no migration file`);
  if (!hasRollback(migration)) throw new Error(`${file} is not in infra/supabase/rollbacks`);
  return migration;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'db-url-env': { type: 'string' },
      file: { type: 'string', default: '' },
      'yes-production': { type: 'boolean', default: false },
    },
  });
  const migration = migrationForRollback(values.file);
  const target = openTarget({
    dbUrlEnv: values['db-url-env'],
    yesProduction: values['yes-production'],
  });
  try {
    await revert(target.db, [migration]);
    const results = await runChecks(target.db);
    console.log(`checks on ${target.label}\n${formatResults(results)}`);
    if (failed(results)) process.exitCode = 1;
  } finally {
    await target.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
