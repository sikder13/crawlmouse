import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { Db } from './db';
import { listMigrations, type MigrationFile } from './files';
import { openTarget } from './target';

/**
 * Compares `infra/supabase/migrations` with `supabase_migrations.schema_migrations` on a target,
 * and repairs the history table. The repair writes only to that table and only through the fixed
 * statements in REPAIR_STATEMENTS: a file's bytes reach the database as a bound parameter, never
 * as SQL to run.
 *
 *   tsx scripts/db/history.ts --project-ref <ref> [--yes-production] [--show-statements]
 *   tsx scripts/db/history.ts --db-url-env DB_URL [--yes-production] \
 *     --repair --applied-through <version> [--drop-orphan <version>]...
 */

export interface HistoryRow {
  version: string;
  name: string | null;
  statements: string[] | null;
}

export interface HistoryDiff {
  files: number;
  rows: number;
  /** Rows recorded under the file's own version, with statements. */
  matched: number;
  /** Rows recorded under another version, paired with the one unrecorded file of their name. */
  misversioned: Array<{ row: HistoryRow; file: MigrationFile }>;
  /**
   * Rows paired with a file (by version or by name) with no executable statement: null, empty, or
   * comments only. A branch is built by replaying `statements`, so such a row builds nothing.
   */
  withoutStatements: Array<{ row: HistoryRow; file: MigrationFile }>;
  /** Rows with no file. The CLI refuses to push while one exists. */
  orphans: HistoryRow[];
  /** Files with no row. */
  unrecorded: MigrationFile[];
}

const READ_HISTORY =
  'select version, name, statements from supabase_migrations.schema_migrations order by version';

export const REPAIR_STATEMENTS = {
  drop: 'delete from supabase_migrations.schema_migrations where version = $1',
  rename: 'update supabase_migrations.schema_migrations set version = $1 where version = $2',
  fill: 'update supabase_migrations.schema_migrations set statements = $1::text[] where version = $2',
  insert:
    'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3::text[])',
} as const;

export async function readHistory(db: Db): Promise<HistoryRow[]> {
  return db.query<HistoryRow & Record<string, unknown>>(READ_HISTORY);
}

/** True when the text holds something other than whitespace and SQL comments. */
export function executable(statement: string): boolean {
  return (
    statement
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim().length > 0
  );
}

const isEmpty = (row: HistoryRow) => !row.statements || !row.statements.some(executable);

export function diffHistory(files: MigrationFile[], rows: HistoryRow[]): HistoryDiff {
  const fileByVersion = new Map(files.map((f) => [f.version, f]));
  const recordedVersions = new Set(rows.map((r) => r.version));
  const claimed = new Set<string>();
  const diff: HistoryDiff = {
    files: files.length,
    rows: rows.length,
    matched: 0,
    misversioned: [],
    withoutStatements: [],
    orphans: [],
    unrecorded: [],
  };

  for (const row of [...rows].sort((a, b) => a.version.localeCompare(b.version))) {
    let file = fileByVersion.get(row.version);
    if (file) {
      if (!isEmpty(row)) diff.matched += 1;
    } else {
      const candidates = files.filter(
        (f) => f.name === row.name && !recordedVersions.has(f.version) && !claimed.has(f.version),
      );
      file = candidates.length === 1 ? candidates[0] : undefined;
      if (!file) {
        diff.orphans.push(row);
        continue;
      }
      diff.misversioned.push({ row, file });
    }
    claimed.add(file.version);
    if (isEmpty(row)) diff.withoutStatements.push({ row, file });
  }

  diff.unrecorded = files.filter(
    (f) => !recordedVersions.has(f.version) && !claimed.has(f.version),
  );
  return diff;
}

/**
 * The diff as text. A row with no file is shown by the md5 of its statements unless
 * `showStatements` is set: the text reaches public job logs, and a statement applied outside the
 * repository may hold a secret.
 */
export function formatDiff(diff: HistoryDiff, { showStatements = false } = {}): string {
  const lines = [
    `${diff.files} migration files, ${diff.rows} history rows`,
    `recorded under the file's version, with statements: ${diff.matched}`,
    `recorded under another version (--repair renames): ${diff.misversioned.length}`,
    ...diff.misversioned.map(({ row, file }) => `  ${row.version} ${row.name} -> ${file.version}`),
    `recorded with no executable statement (--repair adds the file's bytes): ${diff.withoutStatements.length}`,
    ...diff.withoutStatements.map(({ file }) => `  ${file.version} ${file.name}`),
    `rows with no file (--repair --drop-orphan <version> deletes): ${diff.orphans.length}`,
    ...diff.orphans.flatMap((row) => [
      `  ${row.version} ${row.name}`,
      ...(row.statements ?? []).map((s) =>
        showStatements
          ? `    ${s}`
          : `    statement md5 ${createHash('md5').update(s).digest('hex')}`,
      ),
    ]),
    `files with no row: ${diff.unrecorded.length}`,
    ...diff.unrecorded.map((f) => `  ${f.version} ${f.name}`),
  ];
  return lines.join('\n');
}

export interface RepairOptions {
  /** The last file applied on the target. Files after it stay unrecorded, for `db push`. */
  appliedThrough: string;
  /** The versions of rows with no file to delete. Every such row must be named. */
  dropOrphans: string[];
}

export interface RepairPlan {
  drops: HistoryRow[];
  renames: Array<{ from: string; to: string }>;
  /** Each file, with the comment-only statements its row already holds, kept in front of it. */
  fills: Array<{ file: MigrationFile; keep: string[] }>;
  inserts: MigrationFile[];
  pending: MigrationFile[];
}

export function planRepair(
  files: MigrationFile[],
  diff: HistoryDiff,
  options: RepairOptions,
): RepairPlan {
  const through = options.appliedThrough;
  if (!through) throw new Error('--repair needs --applied-through <version>');
  if (!files.some((f) => f.version === through)) {
    throw new Error(`--applied-through ${through} names no migration file`);
  }
  const orphanVersions = new Set(diff.orphans.map((r) => r.version));
  for (const v of options.dropOrphans) {
    if (!orphanVersions.has(v)) throw new Error(`--drop-orphan ${v} is not a row with no file`);
  }
  const unnamed = diff.orphans.filter((r) => !options.dropOrphans.includes(r.version));
  if (unnamed.length > 0) {
    const list = unnamed.map((r) => r.version).join(', ');
    throw new Error(`rows with no file must each be named: ${list} (--drop-orphan <version>)`);
  }
  const recordedFiles = files.filter((f) => !diff.unrecorded.includes(f));
  const beyond = recordedFiles.filter((f) => f.version > through);
  if (beyond.length > 0) {
    const list = beyond.map((f) => f.version).join(', ');
    throw new Error(`the history records ${list}, after --applied-through ${through}`);
  }

  return {
    drops: diff.orphans,
    renames: diff.misversioned.map(({ row, file }) => ({ from: row.version, to: file.version })),
    fills: diff.withoutStatements.map(({ row, file }) => ({ file, keep: row.statements ?? [] })),
    inserts: diff.unrecorded.filter((f) => f.version <= through),
    pending: diff.unrecorded.filter((f) => f.version > through),
  };
}

/** Applies the plan in one transaction, then re-reads the history and rolls back on any surprise. */
export async function applyRepair(db: Db, files: MigrationFile[], plan: RepairPlan): Promise<void> {
  await db.transaction(async (tx) => {
    for (const row of plan.drops) await tx.query(REPAIR_STATEMENTS.drop, [row.version]);
    for (const r of plan.renames) await tx.query(REPAIR_STATEMENTS.rename, [r.to, r.from]);
    for (const { file, keep } of plan.fills) {
      await tx.query(REPAIR_STATEMENTS.fill, [[...keep, file.sql], file.version]);
    }
    for (const f of plan.inserts) {
      await tx.query(REPAIR_STATEMENTS.insert, [f.version, f.name, [f.sql]]);
    }
    const after = diffHistory(files, await readHistory(tx));
    const pending = plan.pending.map((f) => f.version).join(',');
    const ok =
      after.misversioned.length === 0 &&
      after.orphans.length === 0 &&
      after.withoutStatements.length === 0 &&
      after.unrecorded.map((f) => f.version).join(',') === pending;
    if (!ok) {
      throw new Error(
        `the repair did not leave the history the plan promised; nothing was changed\n${formatDiff(after)}`,
      );
    }
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'db-url-env': { type: 'string' },
      'project-ref': { type: 'string' },
      'yes-production': { type: 'boolean', default: false },
      repair: { type: 'boolean', default: false },
      'applied-through': { type: 'string', default: '' },
      'drop-orphan': { type: 'string', multiple: true, default: [] },
      'show-statements': { type: 'boolean', default: false },
    },
  });
  const target = openTarget({
    dbUrlEnv: values['db-url-env'],
    projectRef: values['project-ref'],
    yesProduction: values['yes-production'],
  });
  try {
    const files = listMigrations();
    const diff = diffHistory(files, await readHistory(target.db));
    console.log(`target: ${target.label}`);
    console.log(formatDiff(diff, { showStatements: values['show-statements'] }));
    if (!values.repair) return;
    if (!target.writable) throw new Error('--repair needs a writable target: use --db-url-env');
    const plan = planRepair(files, diff, {
      appliedThrough: values['applied-through'],
      dropOrphans: values['drop-orphan'],
    });
    await applyRepair(target.db, files, plan);
    console.log(
      `\nrepaired: ${plan.drops.length} dropped, ${plan.renames.length} renamed, ` +
        `${plan.fills.length} filled, ${plan.inserts.length} inserted; ` +
        `pending for db push: ${plan.pending.map((f) => f.version).join(', ') || 'none'}`,
    );
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
