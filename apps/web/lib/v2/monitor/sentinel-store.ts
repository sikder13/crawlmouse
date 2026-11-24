/**
 * Row 23: the sentinel's reads, over the service-role client. It reads only: a look writes nothing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Verdict } from '@crawlmouse/types/v2';
import { SENTINEL_PAGE, type SentinelStore } from './sentinel-work';

const fail = (what: string, error: { code?: string; message: string }): never => {
  throw new Error(`sentinel store: ${what}: ${error.code ?? ''} ${error.message}`);
};

export function supabaseSentinelStore(sb: SupabaseClient): SentinelStore {
  return {
    async watchableSites(offset) {
      const sites = await sb
        .from('sites')
        .select('id, host, account_id')
        .not('account_id', 'is', null)
        .is('removed_at', null)
        .is('staging_of_site_id', null)
        .eq('paused', false)
        .order('id')
        .range(offset, offset + SENTINEL_PAGE - 1);
      if (sites.error) fail('reading sites', sites.error);
      const rows = sites.data ?? [];
      if (rows.length === 0) return [];
      const ids = [...new Set(rows.map((r) => r.account_id as string))];
      const accounts = await sb.from('accounts').select('*').in('id', ids);
      if (accounts.error) fail('reading accounts', accounts.error);
      const byId = new Map((accounts.data ?? []).map((a) => [a.id as string, a]));
      return rows.flatMap((r) => {
        const account = byId.get(r.account_id as string);
        return account ? [{ siteId: r.id as string, host: r.host as string, account }] : [];
      });
    },

    async baseline(siteId) {
      const site = await sb.from('sites').select('host').eq('id', siteId).maybeSingle();
      if (site.error) fail('reading the site', site.error);
      if (!site.data) return null;
      const check = await sb
        .from('checks')
        .select('id')
        .eq('site_id', siteId)
        .in('status', ['finished', 'partial'])
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (check.error) fail('reading the latest check', check.error);
      if (!check.data) return null;
      const tests = await sb
        .from('access_tests')
        .select('ua, template_key, page_url, verdict, word_count')
        .eq('check_id', check.data.id);
      if (tests.error) fail('reading access tests', tests.error);
      return {
        checkId: check.data.id as string,
        host: site.data.host as string,
        tests: (tests.data ?? []).map((t) => ({
          ua: (t.ua ?? null) as string | null,
          template_key: t.template_key as string,
          page_url: t.page_url as string,
          verdict: t.verdict as Verdict,
          word_count: (t.word_count ?? null) as number | null,
        })),
      };
    },
  };
}
