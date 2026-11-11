/**
 * The two statements a public start (POST /api/checks) needs beside the pipeline's own store: a
 * read of the rows its derived ids name, and the insert of the site no account keeps. The
 * implementation here is production's, over the service-role client; `start-store-sql.ts` is its
 * twin for PGlite, and `start-store.test.ts` runs one set of cases against both.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Check } from '@crawlmouse/types/v2';

export interface DerivedRows {
  /** The status of the check with the derived check id; null when there is none. */
  checkStatus: Check['status'] | null;
  /** The derived site exists and an account keeps it. */
  siteKept: boolean;
}

export interface StartStore {
  derived(siteId: string, checkId: string): Promise<DerivedRows>;
  /** `insert … on conflict (id) do nothing`: a site with this id is left as it is. */
  insertUnkeptSite(id: string, host: string): Promise<void>;
}

export function supabaseStartStore(sb: SupabaseClient): StartStore {
  return {
    async derived(siteId, checkId) {
      const check = await sb.from('checks').select('status').eq('id', checkId).maybeSingle();
      if (check.error) throw new Error(`start store: read check: ${check.error.message}`);
      const site = await sb.from('sites').select('account_id').eq('id', siteId).maybeSingle();
      if (site.error) throw new Error(`start store: read site: ${site.error.message}`);
      return {
        checkStatus: check.data === null ? null : (check.data.status as Check['status']),
        siteKept: site.data !== null && site.data.account_id !== null,
      };
    },

    async insertUnkeptSite(id, host) {
      const { error } = await sb
        .from('sites')
        .upsert({ id, host }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new Error(`start store: insert site: ${error.message}`);
    },
  };
}
