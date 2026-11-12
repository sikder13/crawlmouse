/**
 * List reads past PostgREST's row cap (`max_rows = 1000`, infra/supabase/config.toml): a read that
 * can hold more rows than that repeats its select with `.range()` from where the rows so far end,
 * until an empty page, so a cap shortens the pages and never the list (the rule
 * `lib/v2/pipeline/store.ts` reads with). An error names what was read and Postgres's code only.
 */

/** Rows asked for per page: PostgREST's cap, so a page is never asked for more than it can give. */
export const PAGE_ROWS = 1000;
/** Ids per `in` filter, so the request URL stays short. */
export const IN_LIST = 100;

/** A PostgREST answer as supabase-js gives it; the rows are read as `T`. */
type Page = { data: unknown; error: { code?: string } | null };

/**
 * Every row of `page`, or the first `max` of them. `page(from, to)` asks for the rows `from`..`to`,
 * both inclusive, of one ordered select.
 */
export async function pagedRows<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<Page>,
  max = Number.POSITIVE_INFINITY,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < max) {
    const to = Math.min(rows.length + PAGE_ROWS, max) - 1;
    const { data, error } = await page(rows.length, to);
    if (error) throw new Error(`${what}: ${error.code ?? 'error'}`);
    const got = (data ?? []) as T[];
    if (got.length === 0) break;
    rows.push(...got);
  }
  return rows;
}

/** `ids` in lists of at most IN_LIST, in order. */
export function inLists<T>(ids: readonly T[]): T[][] {
  const lists: T[][] = [];
  ids.forEach((id, i) => {
    if (i % IN_LIST === 0) lists.push([]);
    lists[lists.length - 1]!.push(id);
  });
  return lists;
}
