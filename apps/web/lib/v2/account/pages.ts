/**
 * What the live account pages read (CC-26b D8): the viewer, then the records of the account a page
 * shows. The pages render the same screens as the previews, from these.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../supabase/admin';
import { supabaseCheckReader } from '../pipeline/load';
import type { AccountDataset, Viewer } from '../view/account';
import { loadAccountDataset } from './dataset';
import { readEntitlement } from './viewer';

export interface AccountRead {
  d: AccountDataset;
  viewer: Viewer;
}

/** `accountId`'s records, read at `now` for the caller sitting on it as `seatId`. */
export async function readAccount(
  session: SupabaseClient,
  accountId: string,
  seatId: string,
  now: Date,
): Promise<AccountRead> {
  const admin = supabaseAdmin();
  const d = await loadAccountDataset(
    { session, admin, records: supabaseCheckReader(admin) },
    accountId,
    now,
  );
  return { d, viewer: { accountId, seatId, now: now.toISOString() } };
}

/**
 * The live site a page opens, read with the caller's client: null for a site that does not exist,
 * one removed, or one on an account the caller has no active seat on (row security hides it).
 * Otherwise the site's account and the caller's seat there.
 */
export async function siteOfCaller(
  session: SupabaseClient,
  userId: string,
  siteId: string,
  now: Date,
): Promise<{ accountId: string; seatId: string } | null> {
  const site = await session
    .from('sites')
    .select('id, account_id')
    .eq('id', siteId)
    .is('removed_at', null)
    .maybeSingle();
  if (site.error) throw new Error(`site page: sites read failed: ${site.error.message}`);
  const accountId = (site.data as { account_id: string | null } | null)?.account_id;
  if (!accountId) return null;
  if ((await readEntitlement(session, accountId, now)) === null) return null;
  const seat = await session
    .from('seats')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (seat.error) throw new Error(`site page: seats read failed: ${seat.error.message}`);
  const seatId = (seat.data as { id: string } | null)?.id;
  return seatId ? { accountId, seatId } : null;
}
