/**
 * The card on the account pages (CC-37 Q25): its last four are the owner's to see. Migration
 * 20261117000001 revokes `accounts.card_last4` from `authenticated`, so the session cannot read it;
 * it is read here with the service role, after `member_role` through the caller's own session has
 * answered. The owner gets the digits; every other role gets `last4: null` and `onFile`, so what
 * depends on a card being on file (a card trial's actions) holds for them too, and no digit leaves
 * the server for them. The views read presence from `AccountView.cardOnFile`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CardRead {
  last4: string | null;
  onFile: boolean;
}

export async function cardFor(
  session: SupabaseClient,
  admin: SupabaseClient,
  accountId: string,
): Promise<CardRead> {
  const role = await session.rpc('member_role', { p_account: accountId });
  if (role.error) throw new Error(`member_role failed: ${role.error.message}`);
  const card = await admin.from('accounts').select('card_last4').eq('id', accountId).maybeSingle();
  if (card.error) throw new Error(`card read failed: ${card.error.message}`);
  const last4 = (card.data as { card_last4: string | null } | null)?.card_last4 ?? null;
  return { last4: role.data === 'owner' ? last4 : null, onFile: last4 !== null };
}

/**
 * Beside an account dataset: the accounts with a card on file, whether or not this reader may see
 * its digits (the account record's `card_last4` is null for every role but the owner).
 */
export interface CardsOnFile {
  cardsOnFile?: readonly string[];
}
