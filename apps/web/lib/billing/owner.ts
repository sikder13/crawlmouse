/**
 * Which account a v2 billing request acts on (CC-03 D6–D8, spec 03 Q15). A request may name one;
 * CC-27's forms name none, and then it is the account of the caller's one active owner seat, or,
 * when they own several (CC-29's Agency trial adds one, Q26), their personal account.
 *
 * The personal account is the default account: `handle_new_user` (migration 001) gives each person
 * one personal account, owned, and sets `users.default_account_id` to it, and nothing else creates
 * a personal account. The caller's column grant on `users` leaves `default_account_id` out, and the
 * service role may not be made before the route's membership check (route-policy, class `member`),
 * so the account is found by its kind, read with the caller's own client.
 *
 * This decides which account, not whether the caller owns it: each route then asks
 * `member_role(account)` with the caller's session and refuses anything but `'owner'`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountChoice =
  | { ok: true; accountId: string }
  | { ok: false; status: 403; error: 'not_owner' }
  | { ok: false; status: 409; error: 'account_ambiguous' };

const AMBIGUOUS: AccountChoice = { ok: false, status: 409, error: 'account_ambiguous' };

/**
 * The account of the caller's active owner seat, read with the caller's own client (`seats` and
 * `accounts` are member-readable). None is a 403. With several, the one of them that is personal;
 * a 409 when none or more than one is, since the request then has to say which.
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
  if (rows.length === 1) return { ok: true, accountId: rows[0]!.account_id };

  const personal = await sb
    .from('accounts')
    .select('id')
    .in(
      'id',
      rows.map((r) => r.account_id),
    )
    .eq('kind', 'personal');
  if (personal.error) throw new Error(`accounts read failed: ${personal.error.message}`);
  const found = (personal.data ?? []) as { id: string }[];
  return found.length === 1 ? { ok: true, accountId: found[0]!.id } : AMBIGUOUS;
}

/** The account the request names, else the caller's owned one. */
export async function requestedAccountId(
  sb: SupabaseClient,
  userId: string,
  named: string | undefined,
): Promise<AccountChoice> {
  return named === undefined ? ownedAccountId(sb, userId) : { ok: true, accountId: named };
}
