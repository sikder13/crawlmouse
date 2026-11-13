/**
 * D3(c): every file in `infra/supabase/migrations` is in production's
 * `supabase_migrations.schema_migrations`. Read through the Management API's read-only endpoint with
 * `SUPABASE_ACCESS_TOKEN`, by the code `scripts/db/history.ts` uses (`readOnlyApi`, `readHistory`,
 * `diffHistory`). The project is `PRODUCTION_REF`, never a URL from the environment.
 */
import { readOnlyApi } from '../../db/db';
import { listMigrations, type MigrationFile } from '../../db/files';
import { diffHistory, readHistory } from '../../db/history';
import { PRODUCTION_REF } from '../../db/target';
import { fail, noToken, pass, unknown, type Probe } from './types';

export const migrationsProbe =
  (files: () => MigrationFile[] = listMigrations): Probe =>
  async (deps) => {
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
    const d = diffHistory(files(), rows);
    const counts =
      `${d.files} files, ${d.rows} rows; ${d.matched} matched, ${d.misversioned.length} under another ` +
      `version, ${d.withoutStatements.length} without statements, ${d.orphans.length} with no file`;
    if (d.unrecorded.length > 0) {
      return fail(`not applied: ${d.unrecorded.map((f) => f.version).join(', ')} (${counts})`);
    }
    return pass(counts);
  };
