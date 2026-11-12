/**
 * Which account a v2 billing request acts on (CC-03 D6–D8, spec 03 Q15). A request may name one;
 * CC-27's forms name none, and then it is the account the caller owns: the one their switcher names
 * when they own it (CC-31 D2b), else the account of their one active owner seat.
 *
 * This decides which account, not whether the caller owns it: each route then asks
 * `member_role(account)` with the caller's session and refuses anything but `'owner'`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountChoice =
  | { ok: true; accountId: string }
  | { ok: false; status: 403; error: 'not_owner' }
  | { ok: false; status: 409; error: 'account_ambiguous' };

async function ownedAccounts(sb: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await sb
    .from('seats')
    .select('account_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .eq('status', 'active');
  if (error) throw new Error(`seats read failed: ${error.message}`);
  return ((data ?? []) as { account_id: string }[]).map((r) => r.account_id);
}

/**
 * The account the caller owns, read with the caller's own client (`seats` is member-readable):
 * `chosen` (the switcher's account) when it is one of them, else their one owned account. None is a
 * 403; several with no choice among them is a 409, since the request has to say which.
 */
export async function ownedAccountId(
  sb: SupabaseClient,
  userId: string,
  chosen: string | null = null,
): Promise<AccountChoice> {
  const owned = await ownedAccounts(sb, userId);
  if (owned.length === 0) return { ok: false, status: 403, error: 'not_owner' };
  if (chosen !== null && owned.includes(chosen)) return { ok: true, accountId: chosen };
  if (owned.length > 1) return { ok: false, status: 409, error: 'account_ambiguous' };
  return { ok: true, accountId: owned[0]! };
}

/**
 * The caller's own personal account: the one a person's email and deletion belong to, whichever
 * account their switcher names. A person owns one (`handle_new_user` makes it at sign-up).
 */
export async function ownPersonalAccountId(
  sb: SupabaseClient,
  userId: string,
): Promise<AccountChoice> {
  const owned = await ownedAccounts(sb, userId);
  if (owned.length === 0) return { ok: false, status: 403, error: 'not_owner' };
  const { data, error } = await sb
    .from('accounts')
    .select('id')
    .in('id', owned)
    .eq('kind', 'personal');
  if (error) throw new Error(`accounts read failed: ${error.message}`);
  const personal = ((data ?? []) as { id: string }[]).map((a) => a.id);
  if (personal.length === 0) return { ok: false, status: 403, error: 'not_owner' };
  if (personal.length > 1) return { ok: false, status: 409, error: 'account_ambiguous' };
  return { ok: true, accountId: personal[0]! };
}

/** The account the request names, else the caller's owned one (`chosen` as `ownedAccountId` reads it). */
export async function requestedAccountId(
  sb: SupabaseClient,
  userId: string,
  named: string | undefined,
  chosen: string | null = null,
): Promise<AccountChoice> {
  return named === undefined ? ownedAccountId(sb, userId, chosen) : { ok: true, accountId: named };
}
