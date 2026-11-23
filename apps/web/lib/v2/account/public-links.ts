/**
 * The public links a v2 mint wrote to `public_reports` (F-123), read with the service role, so a
 * caller establishes the account and its site ids through their own session first.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountDataset } from '../view/account';

type Report = AccountDataset['reports'][number];

interface MintedRow {
  slug: string;
  check_id: string;
  site_id: string;
  created_at: string;
}

function asReport(r: MintedRow, accountId: string): Report {
  return {
    id: r.check_id,
    account_id: accountId,
    site_id: r.site_id,
    kind: 'public_link',
    format: 'html',
    status: 'ready',
    made_by: 'user',
    created_at: new Date(r.created_at).toISOString(),
    covers_check_ids: [r.check_id],
    byte_count: null,
    share_expires_at: null,
    public_slug: r.slug,
    scheduled_for: null,
    sent_at: null,
    recipient_email: null,
    owner_seat_id: null,
    headline: null,
    open_tracking: false,
    opened_at: null,
  };
}

/** The live links of these sites, newest first. A hidden or taken-down link answers 404 at `/r/`. */
export async function mintedLinks(
  admin: SupabaseClient,
  accountId: string,
  siteIds: readonly string[],
): Promise<Report[]> {
  if (siteIds.length === 0) return [];
  const { data, error } = await admin
    .from('public_reports')
    .select('slug, check_id, site_id, created_at')
    .in('site_id', [...siteIds])
    .eq('account_id', accountId)
    .not('check_id', 'is', null)
    .is('hidden_at', null)
    .is('takedown_requested_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`public_reports read failed: ${error.message}`);
  return ((data ?? []) as MintedRow[]).map((r) => asReport(r, accountId));
}

/**
 * Whether a link of this site was hidden or taken down. The page then offers no new one: a mint
 * would publish the host again, and for the withdrawn check it would answer the old slug and change
 * nothing. Answers true when it cannot tell, so a failed read cannot offer a republication.
 */
export async function siteLinkWithdrawn(
  admin: SupabaseClient,
  accountId: string,
  siteId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('public_reports')
    .select('hidden_at, takedown_requested_at')
    .eq('site_id', siteId)
    .eq('account_id', accountId);
  if (error) return true;
  return (
    (data ?? []) as { hidden_at: string | null; takedown_requested_at: string | null }[]
  ).some((r) => r.hidden_at !== null || r.takedown_requested_at !== null);
}
