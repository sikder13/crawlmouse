/**
 * The public links a v2 mint wrote to `public_reports` (F-123), read with the service role, so a
 * caller establishes the account and its site ids through their own session first.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain } from '../../domain';
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

/** Whether a seat that may publish can be offered a new link for this site. */
export type LinkGate = 'open' | 'withdrawn' | 'unknown';

/**
 * A takedown is about a host, so one on any report of this domain closes it: a v1 report (which has
 * no site id), a site removed and added again, a `www.` sibling, another account's site. A hide is
 * the site's own: anyone can mint and hide a v1 report for a domain, so a hide elsewhere must not
 * close it for its owner. `unknown` when a read fails, which offers no new link either.
 */
export async function siteLinkGate(
  admin: SupabaseClient,
  accountId: string,
  site: { id: string; host: string },
): Promise<LinkGate> {
  const [takenDown, hidden] = await Promise.all([
    admin
      .from('public_reports')
      .select('slug')
      .eq('domain', normalizeDomain(site.host))
      .not('takedown_requested_at', 'is', null)
      .limit(1),
    admin
      .from('public_reports')
      .select('slug')
      .eq('site_id', site.id)
      .eq('account_id', accountId)
      .not('hidden_at', 'is', null)
      .limit(1),
  ]);
  if (takenDown.error || hidden.error) return 'unknown';
  return (takenDown.data ?? []).length + (hidden.data ?? []).length > 0 ? 'withdrawn' : 'open';
}
