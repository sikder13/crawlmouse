/**
 * Which account a v2 billing request acts on (CC-03 D6–D8, spec 03 Q15). A request may name one;
 * CC-27's forms name none, and then it is the account of the caller's one active owner seat, or,
 * when they hold several (CC-29's Agency trial adds one, Q26), their default account if it is one
 * of them.
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
 * The caller's own `users.default_account_id`. The caller's column grant leaves it out of their own
 * client, so a route passes `readDefaultAccountId` over the service role (lib/v2/account/viewer-read.ts,
 * the viewer's reader). It is called only when the caller holds more than one owner seat.
 */
export type DefaultAccount = () => Promise<string | null>;

/**
 * The account of the caller's active owner seat, read with the caller's own client (`seats` is
 * member-readable). None is a 403. With more than one, it is the caller's default account when that
 * is one of the owned accounts, and a 409 otherwise, since the request has to say which.
 */
export async function ownedAccountId(
  sb: SupabaseClient,
  userId: string,
  defaultAccount: DefaultAccount,
): Promise<AccountChoice> {
  const { data, error } = await sb
    .from('seats')
    .select('account_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .eq('status', 'active');
  if (error) throw new Error(`seats read failed: ${error.message}`);
  const rows = (data ?? []) as { account_id: string }[];
  if (rows.length === 0) return { ok: false, status: 403, error: 'not_owner' };
  if (rows.length === 1) return { ok: true, accountId: rows[0]!.account_id };
  const id = await defaultAccount();
  return rows.some((r) => r.account_id === id)
    ? { ok: true, accountId: id! }
    : { ok: false, status: 409, error: 'account_ambiguous' };
}

/** The account the request names, else the caller's owned one. */
export async function requestedAccountId(
  sb: SupabaseClient,
  userId: string,
  named: string | undefined,
  defaultAccount: DefaultAccount,
): Promise<AccountChoice> {
  return named === undefined
    ? ownedAccountId(sb, userId, defaultAccount)
    : { ok: true, accountId: named };
}
