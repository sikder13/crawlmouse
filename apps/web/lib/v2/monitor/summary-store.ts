/**
 * The weekly summary's ports over the service-role client: `due_summary_accounts` and
 * `summary_recipients` (migration 20261113000001, section C), and reads of the account, its live
 * sites and their changes. An error names the function or table and Postgres's code only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SummaryChange, SummarySite } from '../mail/templates/weekly-summary';
import { zoneOrUtc } from './alerts-store';
import type { SummaryStore } from './summary';

/** The most change rows one summary reads; more than this is logged, not silently dropped. */
export const SUMMARY_READ_MAX = 5000;

const fail = (what: string, error: { code?: string } | null) =>
  new Error(`${what}: ${error?.code ?? 'error'}`);

export function supabaseSummaryStore(
  sb: SupabaseClient,
  log: (event: 'summary.read_capped', fields: Readonly<Record<string, string | number>>) => void,
): SummaryStore {
  return {
    async due(now) {
      const { data, error } = await sb.rpc('due_summary_accounts', { p_now: now.toISOString() });
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
      const { data: sites, error } = await sb
        .from('sites')
        .select('id, host')
        .eq('account_id', accountId)
        .is('removed_at', null);
      if (error) throw fail('sites', error);
      if (!sites?.length) return [];
      const { data: rows, error: changesError } = await sb
        .from('changes')
        .select(
          'site_id, kind, subject, severity, summary, where, pages_affected, ua, grade_deltas, detected_at',
        )
        .in(
          'site_id',
          sites.map((s) => s.id),
        )
        .gte('detected_at', since)
        .lt('detected_at', until)
        .neq('kind', 'baseline')
        .order('detected_at')
        .limit(SUMMARY_READ_MAX);
      if (changesError) throw fail('changes', changesError);
      const list = (rows ?? []) as (SummaryChange & { site_id: string })[];
      if (list.length >= SUMMARY_READ_MAX) {
        log('summary.read_capped', { account: accountId, rows: list.length });
      }
      return sites.map((s) => ({
        siteId: s.id as string,
        host: s.host as string,
        changes: list.filter((c) => c.site_id === s.id).map(({ site_id: _site, ...c }) => c),
      }));
    },

    async recipients(accountId) {
      const { data, error } = await sb.rpc('summary_recipients', { p_account: accountId });
      if (error) throw fail('summary_recipients', error);
      return ((data ?? []) as { seat_id: string; email: string }[]).map((r) => ({
        seatId: r.seat_id,
        email: r.email,
      }));
    },
  };
}
