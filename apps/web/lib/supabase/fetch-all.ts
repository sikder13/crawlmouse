import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST caps a single query at ~1000 rows by default. */
export const POSTGREST_PAGE = 1000;

/**
 * Fetch every row for an audit by paging with `.range()`.
 *
 * Any plain `select().eq('audit_id', id)` is silently truncated at ~1000 rows by
 * PostgREST, which would drop half the pages/findings of a 2,000-page Pro audit.
 * This pages until a short page is returned so callers get the complete set.
 *
 * `pageSize` is injectable for tests; production uses the PostgREST default.
 */
export async function fetchAll<T>(
  sb: SupabaseClient,
  table: string,
  columns: string,
  auditId: string,
  pageSize: number = POSTGREST_PAGE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .eq('audit_id', auditId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return out;
}
