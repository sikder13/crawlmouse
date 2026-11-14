import { notFound } from 'next/navigation';
import { ConsoleAccountScreen } from '@/components/v2/screens/internal/ConsoleAccountScreen';
import { supabaseServer } from '@/lib/supabase/server';
import { isId } from '@/lib/v2/account/route';
import { DONE_LINES, doneOf } from '@/lib/v2/ops/actions';
import { consoleStore } from '@/lib/v2/ops/console-store';
import { accountView } from '@/lib/v2/ops/console-view';
import { requireOperator } from '@/lib/v2/ops/operator';

export const dynamic = 'force-dynamic';

/**
 * One account in the support console (CC-33 D2). Anyone but an operator gets 404, before anything is
 * read. The view is written to `operator_actions` before the account is read, and a view that cannot
 * be written is not shown (the log's error is thrown). `?done=<code>` is the line an action sent the
 * page back with.
 */
export default async function ConsoleAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const proof = await requireOperator(await supabaseServer());
  if (!proof) notFound();
  const { id } = await params;
  if (!isId(id)) notFound();
  const store = consoleStore(proof);
  await store.logView(id);
  const dossier = await store.dossier(id);
  if (dossier === null) notFound();
  const done = doneOf(await searchParams);
  return (
    <ConsoleAccountScreen
      view={accountView(dossier)}
      notice={done === null ? null : DONE_LINES[done]}
    />
  );
}
