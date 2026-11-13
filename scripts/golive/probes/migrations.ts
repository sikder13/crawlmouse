/**
 * D3(c): every file in `infra/supabase/migrations` at the live production commit (live.ts, listed by
 * `git ls-tree`, not read from the working tree) is in production's
 * `supabase_migrations.schema_migrations`. Read through the Management API's read-only endpoint with
 * `SUPABASE_ACCESS_TOKEN`, by the code `scripts/db/history.ts` uses (`readOnlyApi`, `readHistory`,
 * `diffHistory`). The project is `PRODUCTION_REF`, never a URL from the environment.
 */
import { readOnlyApi } from '../../db/db';
import type { MigrationFile } from '../../db/files';
import { diffHistory, readHistory } from '../../db/history';
import { PRODUCTION_REF } from '../../db/target';
import { liveCommit } from './live';
import { fail, noToken, pass, unknown, type Probe, type ProbeDeps } from './types';

export const MIGRATIONS_PATH = 'infra/supabase/migrations/';
/** `<14-digit version>_<name>.sql`, as scripts/db/files.ts names a migration. */
const MIGRATION_NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/** The migration files at `sha`, or why they cannot be listed. diffHistory reads version and name. */
async function filesAt(deps: ProbeDeps, sha: string): Promise<MigrationFile[] | string> {
  const tree = await deps.git(['ls-tree', '--name-only', sha, '--', MIGRATIONS_PATH]);
  const short = sha.slice(0, 12);
  if (tree.code !== 0) return `git ls-tree exited ${tree.code} at the live commit ${short}`;
  const files: MigrationFile[] = [];
  for (const path of tree.stdout.split('\n').filter((l) => l.endsWith('.sql'))) {
    const file = path.slice(path.lastIndexOf('/') + 1);
    const m = MIGRATION_NAME.exec(file);
    if (!m) return `a .sql file at the live commit ${short} is not named <version>_<name>.sql`;
    files.push({ version: m[1]!, name: m[2]!, file, path, sql: '', sha256: '' });
  }
  if (files.length === 0) return `no migration file at the live commit ${short}`;
  return files.sort((a, b) => a.version.localeCompare(b.version));
}

export const migrationsProbe = (): Probe => async (deps) => {
  const token = deps.env.SUPABASE_ACCESS_TOKEN;
  if (!token) return noToken('SUPABASE_ACCESS_TOKEN');
  let status = 0;
  const recording: typeof fetch = async (input, init) => {
    const res = await deps.fetch(input, init);
    status = res.status;
    return res;
  };
  let rows;
  try {
    rows = await readHistory(readOnlyApi(PRODUCTION_REF, token, recording));
  } catch {
    // readOnlyApi's message carries the response body; only the status is reported.
    return unknown(`the read-only history query failed${status ? ` (HTTP ${status})` : ''}`);
  }
  const live = await liveCommit(deps);
  if (!live.ok) return live.result;
  const files = await filesAt(deps, live.sha);
  if (typeof files === 'string') return unknown(files);
  const d = diffHistory(files, rows);
  const counts =
    `${d.files} files, ${d.rows} rows; ${d.matched} matched, ${d.misversioned.length} under another ` +
    `version, ${d.withoutStatements.length} without statements, ${d.orphans.length} with no file`;
  if (d.unrecorded.length > 0) {
    return fail(`not applied: ${d.unrecorded.map((f) => f.version).join(', ')} (${counts})`);
  }
  return pass(counts);
};
