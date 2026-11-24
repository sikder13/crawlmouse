/**
 * Row 18: the competitor work's reads and writes, over the service-role client. Every read is of a
 * row the work was handed the id of or derived the id of; nothing here is reachable from a request.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Check, CompetitorSnapshot } from '@crawlmouse/types/v2';
import { checkFromRow } from '../pipeline/rows';
import type { CompetitorStore } from './compare';

const ENDED = ['finished', 'partial'] as const;

const fail = (what: string, error: { code?: string; message: string }): never => {
  throw new Error(`competitor store: ${what}: ${error.code ?? ''} ${error.message}`);
};

export function supabaseCompetitorStore(sb: SupabaseClient): CompetitorStore {
  return {
    async planRow(checkId) {
      const check = await sb
        .from('checks')
        .select('status, site_id')
        .eq('id', checkId)
        .maybeSingle();
      if (check.error) fail('reading the check', check.error);
      if (!check.data) return null;
      const site = await sb
        .from('sites')
        .select('host, account_id, staging_of_site_id, removed_at, paused, competitor_hosts')
        .eq('id', check.data.site_id)
        .maybeSingle();
      if (site.error) fail('reading the site', site.error);
      if (!site.data) return null;
      let competitorLimit = 0;
      let siteLimit = 0;
      if (site.data.account_id !== null) {
        const account = await sb
          .from('accounts')
          .select('competitor_limit, site_limit')
          .eq('id', site.data.account_id)
          .maybeSingle();
        if (account.error) fail('reading the account', account.error);
        competitorLimit = account.data?.competitor_limit ?? 0;
        siteLimit = account.data?.site_limit ?? 0;
      }
      return {
        checkStatus: check.data.status as Check['status'],
        siteId: check.data.site_id as string,
        host: site.data.host as string,
        accountId: (site.data.account_id ?? null) as string | null,
        staging: site.data.staging_of_site_id !== null,
        removed: site.data.removed_at !== null,
        paused: site.data.paused === true,
        competitorHosts: (site.data.competitor_hosts ?? []) as string[],
        competitorLimit,
        siteLimit,
      };
    },

    async latestEnded(siteId) {
      const { data, error } = await sb
        .from('checks')
        .select('id, finished_at')
        .eq('site_id', siteId)
        .in('status', [...ENDED])
        .order('finished_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail('reading the latest check', error);
      return data ? { checkId: data.id as string, finishedAt: data.finished_at as string } : null;
    },

    async competitorState(siteId) {
      const site = await sb.from('sites').select('account_id').eq('id', siteId).maybeSingle();
      if (site.error) fail('reading the competitor site', site.error);
      if (!site.data) return null;
      const live = await sb
        .from('checks')
        .select('id')
        .eq('site_id', siteId)
        .in('status', ['queued', 'running', 'deferred'])
        .order('queued_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (live.error) fail('reading the competitor check under way', live.error);
      const ended = await sb
        .from('checks')
        .select('id, finished_at, expires_at')
        .eq('site_id', siteId)
        .in('status', [...ENDED])
        .order('finished_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ended.error) fail('reading the competitor check', ended.error);
      return {
        kept: site.data.account_id !== null,
        live: (live.data?.id ?? null) as string | null,
        ended: ended.data
          ? {
              checkId: ended.data.id as string,
              finishedAt: ended.data.finished_at as string,
              expiresAt: (ended.data.expires_at ?? null) as string | null,
            }
          : null,
      };
    },

    async ensureSite(siteId, host) {
      const { error } = await sb
        .from('sites')
        .upsert({ id: siteId, host }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) fail('inserting the site', error);
    },

    async endedCheck(checkId) {
      const { data, error } = await sb
        .from('checks')
        .select('*')
        .eq('id', checkId)
        .in('status', [...ENDED])
        .maybeSingle();
      if (error) fail('reading the competitor check', error);
      return data ? checkFromRow(data as Record<string, unknown>) : null;
    },

    async endedOf(checkIds) {
      const { data, error } = await sb
        .from('checks')
        .select('id')
        .in('id', [...checkIds])
        .in('status', [...ENDED, 'failed']);
      if (error) fail('reading check statuses', error);
      return (data ?? []).map((r) => r.id as string);
    },

    async writeCompetitors(checkId, snapshots: readonly CompetitorSnapshot[]) {
      const { data, error } = await sb
        .from('checks')
        .update({ competitors: snapshots })
        .eq('id', checkId)
        .in('status', [...ENDED])
        .select('id');
      if (error) fail('writing the snapshots', error);
      return (data ?? []).length > 0;
    },
  };
}
