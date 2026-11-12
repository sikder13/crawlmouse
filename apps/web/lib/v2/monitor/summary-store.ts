/**
 * The weekly summary's ports over the service-role client: `due_summary_accounts` and
 * `summary_recipients` (migration 20261113000001, section C), and reads of the account, its live
 * sites and their changes. An error names the function or table and Postgres's code only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SummaryChange, SummarySite } from '../mail/templates/weekly-summary';
import { zoneOrUtc } from './alerts-store';
import { inLists, pagedRows } from './paged';
import type { SummaryStore } from './summary';

/**
 * The most change rows one summary reads; past it, `summary.read_capped` is logged and the summary
 * counts the rows read (spec 28, known gaps). Read a page at a time past PostgREST's 1,000 rows.
 */
export const SUMMARY_READ_MAX = 5000;

const fail = (what: string, error: { code?: string } | null) =>
  new Error(`${what}: ${error?.code ?? 'error'}`);

export function supabaseSummaryStore(
  sb: SupabaseClient,
  log: (event: 'summary.read_capped', fields: Readonly<Record<string, string | number>>) => void,
): SummaryStore {
  return {
    async due(now, after, limit) {
      const { data, error } = await sb.rpc('due_summary_accounts', {
        p_now: now.toISOString(),
        p_after: after,
        p_limit: limit,
      });
      if (error) throw fail('due_summary_accounts', error);
      return ((data ?? []) as { account_id: string; week_key: string; week_start: string }[]).map(
        (r) => ({
          accountId: r.account_id,
          weekKey: r.week_key,
          weekStart: new Date(r.week_start).toISOString(),
        }),
      );
    },

    async account(accountId) {
      const { data, error } = await sb
        .from('accounts')
        .select('timezone, deleted_at, deletion_confirmed_at')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw fail('accounts', error);
      if (!data) return null;
      return {
        marked: Boolean(data.deleted_at || data.deletion_confirmed_at),
        zone: zoneOrUtc(data.timezone),
      };
    },

    async sites(accountId, since, until): Promise<SummarySite[]> {
      const sites = await pagedRows<{ id: string; host: string }>('sites', (from, to) =>
        sb
          .from('sites')
          .select('id, host')
          .eq('account_id', accountId)
          .is('removed_at', null)
          .order('id')
          .range(from, to),
      );
      if (!sites.length) return [];
      // One row past the most a summary reads, so a week with more is logged, not cut silently.
      const list: (SummaryChange & { site_id: string })[] = [];
      for (const ids of inLists(sites.map((s) => s.id))) {
        if (list.length > SUMMARY_READ_MAX) break;
        list.push(
          ...(await pagedRows<SummaryChange & { site_id: string }>(
            'changes',
            (from, to) =>
              sb
                .from('changes')
                .select(
                  'site_id, kind, subject, severity, summary, where, pages_affected, ua, grade_deltas, detected_at',
                )
                .in('site_id', ids)
                .gte('detected_at', since)
                .lt('detected_at', until)
                .neq('kind', 'baseline')
                .order('detected_at')
                .order('id')
                .range(from, to),
            SUMMARY_READ_MAX + 1 - list.length,
          )),
        );
      }
      if (list.length > SUMMARY_READ_MAX) {
        list.length = SUMMARY_READ_MAX;
        log('summary.read_capped', { account: accountId, rows: SUMMARY_READ_MAX });
      }
      return sites.map((s) => ({
        siteId: s.id,
        host: s.host,
        changes: list.filter((c) => c.site_id === s.id).map(({ site_id: _site, ...c }) => c),
      }));
    },

    async recipients(accountId) {
      const { data, error } = await sb.rpc('summary_recipients', { p_account: accountId });
      if (error) throw fail('summary_recipients', error);
      return ((data ?? []) as { seat_id: string; email: string; sites: string[] | null }[]).map(
        (r) => ({ seatId: r.seat_id, email: r.email, sites: r.sites }),
      );
    },
  };
}
