/**
 * Which account a v2 billing request acts on (CC-03 D6–D8, spec 03 Q15). A request may name one, as
 * the account screens' forms do; one that names none is about the account the caller acts in (the
 * switcher's, CC-31 D2b), or with no such choice their one owned account (`ownedAccountId`).
 *
 * This decides which account, not whether the caller owns it: each route then asks
 * `member_role(account)` with the caller's session and refuses anything but `'owner'`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountChoice =
  | { ok: true; accountId: string }
  | { ok: false; status: 403; error: 'not_owner' }
  | { ok: false; status: 409; error: 'account_ambiguous' };

interface ActiveSeat {
  account_id: string;
  role: string;
}

/** The caller's active seats, read with the caller's own client (their own rows are theirs to read). */
async function activeSeats(sb: SupabaseClient, userId: string): Promise<ActiveSeat[]> {
  const { data, error } = await sb
    .from('seats')
    .select('account_id, role')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw new Error(`seats read failed: ${error.message}`);
  return (data ?? []) as ActiveSeat[];
}

const owned = (seats: readonly ActiveSeat[]): string[] =>
  seats.filter((s) => s.role === 'owner').map((s) => s.account_id);

/**
 * The account a billing request that names none acts on. `chosen` is the account the caller acts in
 * (the switcher's). When it is one of their seats, the request is about that account and no other:
 * it is the answer when the caller owns it, and a 403 when they do not, so a form posted from an
 * account they only sit on is never acted on in another they own. With no such choice it is their
 * one owned account; none is a 403, and several a 409, since the request has to say which.
 */
export async function ownedAccountId(
  sb: SupabaseClient,
  userId: string,
  chosen: string | null = null,
): Promise<AccountChoice> {
  const seats = await activeSeats(sb, userId);
  const mine = owned(seats);
  if (chosen !== null && seats.some((s) => s.account_id === chosen)) {
    return mine.includes(chosen)
      ? { ok: true, accountId: chosen }
      : { ok: false, status: 403, error: 'not_owner' };
  }
  if (mine.length === 0) return { ok: false, status: 403, error: 'not_owner' };
  if (mine.length > 1) return { ok: false, status: 409, error: 'account_ambiguous' };
  return { ok: true, accountId: mine[0]! };
}

/**
 * The caller's own personal account: the one a person's email and deletion belong to, whichever
 * account their switcher names. A person owns one (`handle_new_user` makes it at sign-up).
 */
export async function ownPersonalAccountId(
  sb: SupabaseClient,
  userId: string,
): Promise<AccountChoice> {
  const mine = owned(await activeSeats(sb, userId));
  if (mine.length === 0) return { ok: false, status: 403, error: 'not_owner' };
  const { data, error } = await sb
    .from('accounts')
    .select('id')
    .in('id', mine)
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
