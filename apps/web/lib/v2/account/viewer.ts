/**
 * The viewer (CC-26b D2): the signed-in caller, the account they act in, their seat on it, and
 * what that account may do right now. The signed-in screens and routes read it here, and nowhere
 * else.
 *
 * Which rows it can return. The seat list and the account are read with the caller's own client,
 * so row security decides them: `seats` and `accounts` are readable only by an active member
 * (`is_member`). The account is always the account of one of the caller's own active seats. The
 * service role reads one value, the caller's own `users.default_account_id` (the caller's column
 * grant leaves it out), and only to choose among those seats; an id that is not among them is
 * ignored. An account id or seat id of an account the caller does not sit on is therefore never
 * in the result, and the only email in it is the caller's own, from their session.
 *
 * Which account, for a person with several seats: the one their switcher cookie names when it is one
 * of those seats (CC-31 D2b, viewer-cookie.ts), else the default one. Nothing here writes
 * `users.default_account_id`, which stays the personal account (`prepare_email_undo` reads it so).
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '../../supabase/admin';
import { supabaseServer } from '../../supabase/server';
import { ACCOUNT_COOKIE, chosenAccount } from './viewer-cookie';
import { readViewer, type ViewerResult } from './viewer-read';

export {
  readEntitlement,
  readViewer,
  type AccountViewer,
  type Entitlement,
  type ViewerResult,
} from './viewer-read';

/** The account this request's switcher cookie names, or null: `readViewer`'s `chosen`. */
export async function chosenFromRequest(): Promise<string | null> {
  return chosenAccount((await cookies()).get(ACCOUNT_COOKIE)?.value);
}

/** The viewer of this request, from its session cookie. */
export async function loadViewer(): Promise<ViewerResult> {
  const session: SupabaseClient = await supabaseServer();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { kind: 'signed_out' };
  return readViewer(
    { session, admin: supabaseAdmin(), now: () => new Date() },
    { id: user.id, email: user.email ?? null },
    await chosenFromRequest(),
  );
}
