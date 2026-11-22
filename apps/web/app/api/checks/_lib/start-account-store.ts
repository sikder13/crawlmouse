/**
 * The reads a signed-in start makes with the caller's own client (RC-02), so row security and the
 * seat's scope decide what they can see. Nothing here uses the service role: an account, site or
 * check the caller does not sit on cannot be in an answer. The writes are `add_site` and
 * `request_capped_check`, through lib/v2/account/sites-store.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoveredSite } from './start-account';

export interface AccountStartStore {
  coveredSite(accountId: string, host: string): Promise<CoveredSite | null>;
  mayAdd(accountId: string, seatId: string): Promise<boolean>;
  liveSites(accountId: string): Promise<number>;
}

export function sessionAccountStartStore(session: SupabaseClient): AccountStartStore {
  return {
    async coveredSite(accountId, host) {
      const site = await session
        .from('sites')
        .select('id, paused_reason')
        .eq('account_id', accountId)
        .eq('host', host)
        .is('removed_at', null)
        .maybeSingle();
      if (site.error) throw new Error(`start: read site: ${site.error.message}`);
      const row = site.data as { id: string; paused_reason: string | null } | null;
      // Row security (`sites_member_read`, `is_member_for_site`) answers only a site the caller's
      // seat covers, so a seat scoped to other clients reads none of theirs here.
      if (row === null) return null;
      const latest = await session
        .from('checks')
        .select('id, status, trigger, queued_at')
        .eq('site_id', row.id)
        .order('queued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) throw new Error(`start: read latest check: ${latest.error.message}`);
      return {
        id: row.id,
        pausedReason: row.paused_reason,
        latest: latest.data as CoveredSite['latest'],
      };
    },

    async mayAdd(accountId, seatId) {
      const allowed = await session.rpc('seat_may', { p_account: accountId, p_action: 'add_site' });
      if (allowed.error) throw new Error(`start: seat_may: ${allowed.error.message}`);
      if (allowed.data !== true) return false;
      const scope = await session
        .from('seats')
        .select('client_scope_all')
        .eq('id', seatId)
        .maybeSingle();
      if (scope.error) throw new Error(`start: read seat: ${scope.error.message}`);
      return (scope.data as { client_scope_all?: unknown } | null)?.client_scope_all === true;
    },

    async liveSites(accountId) {
      const live = await session
        .from('sites')
        .select('id')
        .eq('account_id', accountId)
        .is('staging_of_site_id', null)
        .is('removed_at', null);
      if (live.error) throw new Error(`start: read sites: ${live.error.message}`);
      return (live.data ?? []).length;
    },
  };
}
