import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { Db } from './db';
import { CHECKS_DIR, FINGERPRINT_FILE } from './files';
import { openTarget } from './target';

/**
 * Runs every catalog check in infra/supabase/checks against a target. A check is a file named
 * `NN-<name>.sql` whose query returns rows only when something is wrong; an empty result is a pass.
 * Its leading comment is its documentation: the first line says what holds, the following comment
 * lines say how it is checked. docs/ops/db-migrations.md renders that list from these files.
 *
 *   tsx scripts/db/check.ts --db-url-env DB_URL | --project-ref <ref> [--yes-production]
 */

const CHECK_FILE = /^\d{2}-[a-z0-9-]+\.sql$/;

export interface Check {
  file: string;
  title: string;
  meaning: string;
  sql: string;
}

export interface CheckResult {
  check: Check;
  findings: Array<Record<string, unknown>>;
}

function parseHeader(file: string, sql: string): { title: string; meaning: string } {
  const comments: string[] = [];
  for (const line of sql.split('\n')) {
    if (!line.startsWith('--')) break;
    comments.push(line.replace(/^--\s?/, ''));
  }
  const [title, ...rest] = comments;
  if (!title) throw new Error(`${file} must open with a comment line saying what it checks`);
  return { title: title.trim(), meaning: rest.join(' ').replace(/\s+/g, ' ').trim() };
}

/**
 * The check files, in name order. A `.sql` file that is neither a check nor the fingerprint throws,
 * so a misnamed check cannot be skipped, and an empty list throws.
 */
export function listChecks(dir = CHECKS_DIR): Check[] {
  const sqlFiles = readdirSync(dir).filter((f) => f.endsWith('.sql') && f !== FINGERPRINT_FILE);
  const misnamed = sqlFiles.filter((f) => !CHECK_FILE.test(f));
  if (misnamed.length > 0) {
    throw new Error(`${misnamed.join(', ')} in ${dir}: a check is named NN-<name>.sql`);
  }
  if (sqlFiles.length === 0) throw new Error(`${dir} holds no checks`);
  return sqlFiles.sort().map((file) => {
    const sql = readFileSync(join(dir, file), 'utf8');
    return { file, sql, ...parseHeader(file, sql) };
  });
}

export async function runChecks(db: Db, checks = listChecks()): Promise<CheckResult[]> {
  if (checks.length === 0) throw new Error('no checks to run');
  const results: CheckResult[] = [];
  for (const check of checks) results.push({ check, findings: await db.query(check.sql) });
  return results;
}

export function failed(results: CheckResult[]): boolean {
  return results.some((r) => r.findings.length > 0);
}

export function formatResults(results: CheckResult[]): string {
  return results
    .flatMap(({ check, findings }) => [
      `${findings.length === 0 ? 'pass' : 'FAIL'}  ${check.file}  ${check.title}`,
      ...findings.map((row) => `      ${Object.values(row).join(': ')}`),
    ])
    .join('\n');
}

/** The checks section of docs/ops/db-migrations.md, rendered from the files. */
export function renderChecksDoc(checks = listChecks()): string {
  return checks
    .map((c) => `- **\`${c.file}\`**: ${c.title}${c.meaning ? ` ${c.meaning}` : ''}`)
    .join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'db-url-env': { type: 'string' },
      'project-ref': { type: 'string' },
      'yes-production': { type: 'boolean', default: false },
    },
  });
  const target = openTarget({
    dbUrlEnv: values['db-url-env'],
    projectRef: values['project-ref'],
    yesProduction: values['yes-production'],
  });
  try {
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
