import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, from this file's location (scripts/db/). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

/**
 * The Supabase CLI reads `<workdir>/supabase/migrations`. The repository keeps its migrations in
 * `infra/supabase/migrations`, so `infra` is the CLI's workdir and no file moves.
 */
export const CLI_WORKDIR = join(REPO_ROOT, 'infra');
export const MIGRATIONS_DIR = join(CLI_WORKDIR, 'supabase', 'migrations');
export const ROLLBACKS_DIR = join(CLI_WORKDIR, 'supabase', 'rollbacks');
export const CHECKS_DIR = join(CLI_WORKDIR, 'supabase', 'checks');
export const FINGERPRINT_FILE = 'fingerprint.sql';

/** `<14-digit version>_<name>.sql`, the CLI's naming. */
const MIGRATION_NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  version: string;
  name: string;
  file: string;
  path: string;
  sql: string;
  sha256: string;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readMigration(dir: string, file: string): MigrationFile {
  const match = MIGRATION_NAME.exec(file);
  if (!match) throw new Error(`${file} in ${dir} is not named <14-digit version>_<name>.sql`);
  const path = join(dir, file);
  const sql = readFileSync(path, 'utf8');
  return { version: match[1]!, name: match[2]!, file, path, sql, sha256: sha256(sql) };
}

/**
 * Every `.sql` file in the directory, in version order. A `.sql` file the CLI would not recognise
 * throws rather than being skipped, so the list cannot be shorter than the directory.
 */
export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const migrations = files.map((f) => readMigration(dir, f));
  const versions = new Set(migrations.map((m) => m.version));
  if (versions.size !== migrations.length) throw new Error(`two files in ${dir} share a version`);
  return migrations;
}

export function rollbackPath(migration: MigrationFile, dir = ROLLBACKS_DIR): string {
  return join(dir, migration.file.replace(/\.sql$/, '.revert.sql'));
}

export function hasRollback(migration: MigrationFile, dir = ROLLBACKS_DIR): boolean {
  return existsSync(rollbackPath(migration, dir));
}
