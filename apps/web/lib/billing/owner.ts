/**
 * Which account a v2 billing request acts on (CC-03 D6–D8, questions Q15). A request may name one;
 * CC-27's forms name none, and then it is the account of the caller's one active owner seat.
 *
 * This decides which account, not whether the caller owns it: each route then asks
 * `member_role(account)` with the caller's session and refuses anything but `'owner'`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountChoice =
  | { ok: true; accountId: string }
  | { ok: false; status: 403; error: 'not_owner' }
  | { ok: false; status: 409; error: 'account_ambiguous' };

/**
 * The account of the caller's active owner seat, read with the caller's own client (`seats` is
 * member-readable). None is a 403; more than one is a 409, since the request has to say which.
 */
export async function ownedAccountId(sb: SupabaseClient, userId: string): Promise<AccountChoice> {
  const { data, error } = await sb
    .from('seats')
    .select('account_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .eq('status', 'active');
  if (error) throw new Error(`seats read failed: ${error.message}`);
  const rows = (data ?? []) as { account_id: string }[];
  if (rows.length === 0) return { ok: false, status: 403, error: 'not_owner' };
  if (rows.length > 1) return { ok: false, status: 409, error: 'account_ambiguous' };
  return { ok: true, accountId: rows[0]!.account_id };
}

/** The account the request names, else the caller's owned one. */
export async function requestedAccountId(
  sb: SupabaseClient,
  userId: string,
  named: string | undefined,
): Promise<AccountChoice> {
  return named === undefined ? ownedAccountId(sb, userId) : { ok: true, accountId: named };
}
