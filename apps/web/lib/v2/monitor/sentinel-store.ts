/**
 * Row 23: the sentinel's reads, over the service-role client. It reads only: a look writes nothing.
 * A site whose account is marked for deletion (`deleted_at` or `deletion_confirmed_at`) is not listed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IdentityRole, Verdict } from '@crawlmouse/types/v2';
import { ACCOUNT_CLOCK_COLUMNS } from '../pipeline/load-for';
import {
  SENTINEL_PAGE,
  type BaselineTest,
  type SentinelStore,
  type WatchableSite,
} from './sentinel-work';

const fail = (what: string, error: { code?: string; message: string }): never => {
  throw new Error(`sentinel store: ${what}: ${error.code ?? ''} ${error.message}`);
};

export function supabaseSentinelStore(sb: SupabaseClient): SentinelStore {
  const testsOf = async (checkId: string): Promise<BaselineTest[]> => {
    const tests = await sb
      .from('access_tests')
      .select('identity_role, ua, template_key, page_url, verdict, word_count')
      .eq('check_id', checkId);
    if (tests.error) fail('reading access tests', tests.error);
    return (tests.data ?? []).map((t) => ({
      identity_role: t.identity_role as IdentityRole,
      ua: (t.ua ?? null) as string | null,
      template_key: t.template_key as string,
      page_url: t.page_url as string,
      verdict: t.verdict as Verdict,
      word_count: (t.word_count ?? null) as number | null,
    }));
  };

  /**
   * Kept, live, unpaused, non-staging sites, one page or one site, with the accounts of those not
   * marked for deletion: the one rule both `watchableSites` and `watchableSite` read.
   */
  const listed = async (
    only: { siteId: string } | { offset: number },
  ): Promise<{ sites: WatchableSite[]; scanned: number }> => {
    const query = sb
      .from('sites')
      .select('id, host, account_id')
      .not('account_id', 'is', null)
      .is('removed_at', null)
      .is('staging_of_site_id', null)
      .eq('paused', false);
    const sites =
      'siteId' in only
        ? await query.eq('id', only.siteId)
        : await query.order('id').range(only.offset, only.offset + SENTINEL_PAGE - 1);
    if (sites.error) fail('reading sites', sites.error);
    const rows = (sites.data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return { sites: [], scanned: 0 };
    const ids = [...new Set(rows.map((r) => r.account_id as string))];
    // An account marked for deletion is watched no more, as the schedule and alerts skip it.
    const accounts = await sb
      .from('accounts')
      .select(`id, ${ACCOUNT_CLOCK_COLUMNS}`)
      .in('id', ids)
      .is('deleted_at', null)
      .is('deletion_confirmed_at', null);
    if (accounts.error) fail('reading accounts', accounts.error);
    const byId = new Map(
      ((accounts.data ?? []) as Record<string, unknown>[]).map((a) => [a.id as string, a]),
    );
    return {
      scanned: rows.length,
      sites: rows.flatMap((r) => {
        const account = byId.get(r.account_id as string);
        return account ? [{ siteId: r.id as string, host: r.host as string, account }] : [];
      }),
    };
  };

  return {
    async watchableSites(offset) {
      return listed({ offset });
    },

    async watchableSite(siteId) {
      return (await listed({ siteId })).sites[0] ?? null;
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
      return {
        checkId: check.data.id as string,
        host: site.data.host as string,
        tests: await testsOf(check.data.id as string),
      };
    },

    testsOf,
  };
}
