import { supabaseServer } from '@/lib/supabase/server';
import { notFound, readBody, refuse } from '@/lib/v2/account/route';
import { consoleStore } from '@/lib/v2/ops/console-store';
import { requireOperator } from '@/lib/v2/ops/operator';
import { classifyQuery } from '@/lib/v2/ops/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const see = (location: string) => new Response(null, { status: 303, headers: { location } });

/**
 * The support console's search (CC-33 D2): a POST, so the query (an address, often) is in no URL and
 * no log. Anyone but an operator gets 404, before anything is read. The query's kind is decided by
 * its shape (`classifyQuery`) and resolved to account ids; the search is recorded with its kind and
 * how many accounts it found, never the query. One account: a 303 to its page. Several: to the search
 * page with their ids (at most 20). None: to the search page with `found=0`.
 */
export async function POST(req: Request) {
  const proof = await requireOperator(await supabaseServer());
  if (!proof) return notFound();
  const body = await readBody(req);
  if (body === null) return refuse(400, 'invalid');
  const q = typeof body.fields.q === 'string' ? body.fields.q : '';
  const store = consoleStore(proof);
  const { kind, accountIds } = await store.resolve(classifyQuery(q));
  await store.logSearch(kind, accountIds.length);
  if (accountIds.length === 1) return see(`/internal/accounts/${accountIds[0]}`);
  if (accountIds.length === 0) return see('/internal?found=0');
  return see(`/internal?accounts=${accountIds.join(',')}`);
}
