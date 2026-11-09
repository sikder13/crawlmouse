/**
 * The one writer of a built check (CC-20b D5). Workstream A implements it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrawlPage } from '@crawlmouse/types/v2';
import type { PageVantage, PersistDb, PersistInput, PersistOutcome } from './types';

export async function persistBuiltCheck(
  _db: PersistDb,
  _input: PersistInput,
): Promise<PersistOutcome> {
  throw new Error('persistBuiltCheck: workstream A implements this');
}

/** Each fetched crawl row's vantage, by URL. */
export function pageVantage(_pages: readonly CrawlPage[]): Map<string, PageVantage> {
  throw new Error('pageVantage: workstream A implements this');
}

export function supabasePersistDb(_sb: SupabaseClient): PersistDb {
  throw new Error('supabasePersistDb: workstream A implements this');
}
