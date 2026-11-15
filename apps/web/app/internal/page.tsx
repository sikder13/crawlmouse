import { notFound } from 'next/navigation';
import { ConsoleSearchScreen } from '@/components/v2/screens/internal/ConsoleSearchScreen';
import { supabaseServer } from '@/lib/supabase/server';
import { isId } from '@/lib/v2/account/route';
import { consoleStore, SEARCH_RESULTS_MAX } from '@/lib/v2/ops/console-store';
import { resultsView } from '@/lib/v2/ops/console-view';
import { requireOperator } from '@/lib/v2/ops/operator';

export const dynamic = 'force-dynamic';

/**
 * The support console's search page (CC-33 D2). Anyone but an operator gets 404, before anything is
 * read. `?accounts=<id>,<id>` (as the search route writes it) lists those accounts: the ids that are
 * uuids, without repeats, the first 20 of them, recorded in `operator_actions` as one `list_accounts`
 * line an id before any is read (page.test.tsx); a listing that cannot be recorded is not shown (the
 * log's error is thrown).
 * `?found=0` says the last search found nothing.
 */
export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const proof = await requireOperator(await supabaseServer());
  if (!proof) notFound();
  const q = await searchParams;
  const ids =
    typeof q.accounts === 'string'
      ? [...new Set(q.accounts.split(',').filter(isId))].filter((_, i) => i < SEARCH_RESULTS_MAX)
      : [];
  let results = null;
  if (ids.length) {
    const store = consoleStore(proof);
    await store.logList(ids);
    results = resultsView(ids, await store.summaries(ids));
  }
  return <ConsoleSearchScreen results={results} nothingFound={q.found === '0'} />;
}
