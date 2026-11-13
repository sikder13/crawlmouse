/**
 * What the schedule routes read of the caller once their own session has answered
 * `is_member_for_site` (each route file makes that call, and `seat_may`, itself: the route registry
 * reads them from the route's source). Both reads here go through the caller's own client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { paywall, refuseTo, type RequestBody } from '../account/route';
import { readEntitlement } from '../account/viewer-read';
import { CLIENT_REPORTS_PAGE, type ClientSite } from './schedules';

/** The live site and its account, or null for a removed site and one the caller's seat does not read. */
export async function clientSiteOf(
  session: SupabaseClient,
  siteId: string,
): Promise<ClientSite | null> {
  const { data, error } = await session
    .from('sites')
    .select('id, account_id')
    .eq('id', siteId)
    .is('removed_at', null)
    .maybeSingle();
  if (error) throw new Error(`sites read failed: ${error.message}`);
  const accountId = (data as { account_id: string | null } | null)?.account_id;
  return accountId ? { siteId, accountId } : null;
}

/**
 * The refusal for an account whose plan has no client reports (`GATES.agencyBranding`, the row
 * Agency alone holds: questions.md Q12), or null when it has them. 402 with the gate's name; a form
 * goes back to its page with the notice.
 */
export async function clientReportsGate(
  session: SupabaseClient,
  accountId: string,
  kind: RequestBody['kind'],
  now: Date,
): Promise<Response | null> {
  const entitlement = await readEntitlement(session, accountId, now);
  if (entitlement?.gates.agencyBranding) return null;
  return kind === 'form'
    ? refuseTo(kind, CLIENT_REPORTS_PAGE, 402, 'upgrade_required')
    : paywall('agencyBranding');
}
