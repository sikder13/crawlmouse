/** `StartStore` over SQL, for PGlite: the statements of `supabaseStartStore`, written out. */
import type { Check } from '@crawlmouse/types/v2';
import type { SqlDb } from '../../../../lib/v2/pipeline/test-support/sql-store';
import type { StartStore } from './start-store';

export function sqlStartStore(db: SqlDb): StartStore {
  return {
    async derived(siteId, checkId) {
      const { rows } = await db.query<{ check_status: Check['status'] | null; site_kept: boolean }>(
        `select (select status from public.checks where id = $2) as check_status,
                exists (select 1 from public.sites
                         where id = $1 and account_id is not null) as site_kept`,
        [siteId, checkId],
      );
      return { checkStatus: rows[0]!.check_status, siteKept: rows[0]!.site_kept };
    },

    async insertUnkeptSite(id, host) {
      await db.query(
        `insert into public.sites (id, host) values ($1, $2) on conflict (id) do nothing`,
        [id, host],
      );
    },
  };
}
