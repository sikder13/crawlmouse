import { supabaseServer } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { MAGIC_LINK_PER_EMAIL_PER_HOUR } from '@/lib/limits';
import { isId, notFound, readBody } from '@/lib/v2/account/route';
import { doneTo, readReason } from '@/lib/v2/ops/actions';
import { supabaseConsoleStore } from '@/lib/v2/ops/console-store';
import { consoleAdmin, requireOperator } from '@/lib/v2/ops/operator';
import { requestSignInLink } from '@/lib/v2/ops/sign-in-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The support console's re-send of a sign-in link (CC-33 D2). Anyone but an operator gets 404,
 * before anything is read. The form names a user (`userId`), never an address: the link goes to the
 * address of that user's active seat on this account, or the answer is 404. The `reason` is required.
 *
 * In order: the `resend_sign_in` record line (questions.md Q9: an HTTP call to Supabase Auth cannot
 * share a transaction with it, so it is written first, outcome null); the magic-link route's own
 * per-email bucket (`magic:email:<address>`, MAGIC_LINK_PER_EMAIL_PER_HOUR an hour); the request to
 * Supabase Auth (`requestSignInLink`); and the outcome, set once on the line by `operator_finish`.
 * The answer is a 303 to the account's page with the outcome as `?done=`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const proof = await requireOperator(await supabaseServer());
  if (!proof) return notFound();
  const { id } = await params;
  if (!isId(id)) return notFound();
  const body = await readBody(req);
  const userId = body?.fields.userId;
  if (typeof userId !== 'string' || !isId(userId)) return notFound();
  const store = supabaseConsoleStore(consoleAdmin(proof), proof.userId);
  const address = await store.seatEmail(id, userId);
  if (address === null) return notFound();
  const reason = readReason(body!.fields);
  if (reason === null) return doneTo(id, 'reason_invalid');

  const line = await store.logResend(id, userId, reason);
  const email = address.toLowerCase();
  const bucket = await checkRateLimit(
    `magic:email:${email}`,
    MAGIC_LINK_PER_EMAIL_PER_HOUR,
    HOUR_MS,
  );
  if (!bucket.allowed) {
    await store.finish(line, 'rate_limited');
    return doneTo(id, 'rate_limited');
  }
  let outcome: 'sent' | 'refused';
  try {
    outcome = await requestSignInLink(email);
  } catch (e) {
    await store.finish(line, 'failed');
    throw e;
  }
  await store.finish(line, outcome);
  return doneTo(id, outcome === 'sent' ? 'link_sent' : 'link_refused');
}
