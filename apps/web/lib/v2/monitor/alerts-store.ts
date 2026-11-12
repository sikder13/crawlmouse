/**
 * The alert ports over the service-role client (migration 20261113000001, section C). Reads go to the
 * tables; the recipients, the Slack URL at send time, the Slack ledger and the record go through the
 * section's functions. An error names the function or table and Postgres's code, never a value read.
 */
import { seedDefaultAlertRules } from './alert-defaults';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Verdict } from '@crawlmouse/types/v2';
import { z } from 'zod';
import type { Claim } from '../mail/ledger';
import type { AlertContext, AlertData, AlertStore, Delivery, StoredChange } from './alerts';
import type { AlertFixEvent, AlertRuleInput } from './alert-rules';
import { inLists, pagedRows } from './paged';

const fail = (what: string, error: { code?: string } | null) =>
  new Error(`${what}: ${error?.code ?? 'error'}`);

/** The account's zone when the runtime knows it, else UTC (as `due_summary_accounts` reads it). */
export function zoneOrUtc(zone: string | null | undefined): string {
  if (!zone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

const Crawlers = z.array(z.object({ ua: z.string(), verdict: z.string() }).loose()).catch([]);
const WithoutJs = z.object({ site_text_share: z.number() }).loose().nullable().catch(null);

const ClaimSchema = z.union([
  z.strictObject({ outcome: z.literal('go'), attempt: z.int().min(1).max(3) }),
  z.strictObject({ outcome: z.enum(['done', 'busy', 'exhausted']) }),
]);

const CHANGE_COLUMNS =
  'id, site_id, check_id, kind, subject, severity, summary, where, pages_affected, ua, fix_id, grade_deltas';

export function supabaseAlertStore(sb: SupabaseClient): AlertStore {
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw fail(fn, error);
    return data as T;
  }

  return {
    async context(checkId) {
      const { data: check, error } = await sb
        .from('checks')
        .select('id, site_id, status, previous_check_id, finished_at')
        .eq('id', checkId)
        .maybeSingle();
      if (error) throw fail('checks', error);
      if (!check) return null;
      const { data: site, error: siteError } = await sb
        .from('sites')
        .select('account_id, host, slack_channel, removed_at')
        .eq('id', check.site_id)
        .single();
      if (siteError) throw fail('sites', siteError);
      let account: {
        timezone: string;
        deleted_at: string | null;
        deletion_confirmed_at: string | null;
      } | null = null;
      if (site.account_id) {
        const { data: a, error: accountError } = await sb
          .from('accounts')
          .select('timezone, deleted_at, deletion_confirmed_at')
          .eq('id', site.account_id)
          .single();
        if (accountError) throw fail('accounts', accountError);
        account = a;
      }
      const ctx: AlertContext = {
        checkId: check.id,
        siteId: check.site_id,
        accountId: site.account_id,
        siteRemoved: site.removed_at !== null,
        accountMarked: Boolean(account && (account.deleted_at || account.deletion_confirmed_at)),
        previousCheckId: check.previous_check_id,
        firstCheck: check.previous_check_id === null,
        finished: check.status === 'finished' || check.status === 'partial',
        host: site.host,
        slackChannel: site.slack_channel,
        finishedAt: check.finished_at,
        zone: zoneOrUtc(account?.timezone),
      };
      return ctx;
    },

    seedDefaultRules: (accountId) => seedDefaultAlertRules(sb, accountId),
    async data(ctx): Promise<AlertData> {
      // The check's changes, the account's rules and its fixes' events can each pass PostgREST's
      // 1,000 rows, so each is read a page at a time (paged.ts).
      const [rows, rules, checks] = await Promise.all([
        pagedRows<StoredChange>('changes', (from, to) =>
          sb
            .from('changes')
            .select(CHANGE_COLUMNS)
            .eq('check_id', ctx.checkId)
            .eq('site_id', ctx.siteId)
            .order('id')
            .range(from, to),
        ),
        pagedRows<AlertRuleInput>('alert_rules', (from, to) =>
          sb
            .from('alert_rules')
            .select('id, site_id, kind, enabled, threshold_points, channels')
            .eq('account_id', ctx.accountId)
            .order('id')
            .range(from, to),
        ),
        sb
          .from('checks')
          .select('id, crawlers, without_js')
          .in('id', [ctx.checkId, ...(ctx.previousCheckId ? [ctx.previousCheckId] : [])]),
      ]);
      if (checks.error) throw fail('checks', checks.error);
      const fixIds = [...new Set(rows.flatMap((c) => (c.fix_id ? [c.fix_id] : [])))];
      const fixEvents: AlertFixEvent[] = [];
      for (const ids of inLists(fixIds)) {
        fixEvents.push(
          ...(await pagedRows<AlertFixEvent>('fix_events', (from, to) =>
            sb
              .from('fix_events')
              .select('fix_id, kind, at, check_id')
              .in('fix_id', ids)
              .order('id')
              .range(from, to),
          )),
        );
      }
      const byId = new Map((checks.data ?? []).map((c) => [c.id as string, c]));
      const verdicts = (id: string | null) => {
        const c = id ? byId.get(id) : undefined;
        if (!c) return null;
        return Object.fromEntries(
          Crawlers.parse(c.crawlers).map((x) => [x.ua, x.verdict as Verdict]),
        );
      };
      const share = (id: string | null) => {
        const c = id ? byId.get(id) : undefined;
        return c ? (WithoutJs.parse(c.without_js)?.site_text_share ?? null) : null;
      };
      return {
        changes: rows,
        rules,
        verdicts: { now: verdicts(ctx.checkId) ?? {}, before: verdicts(ctx.previousCheckId) },
        textShare: { before: share(ctx.previousCheckId), now: share(ctx.checkId) },
        fixEvents,
      };
    },

    async emailRecipients(accountId, siteId) {
      const rows = await rpc<{ seat_id: string; email: string }[] | null>(
        'alert_email_recipients',
        { p_account: accountId, p_site: siteId },
      );
      return (rows ?? []).map((r) => ({ seatId: r.seat_id, email: r.email }));
    },

    async slackUrl(accountId, now) {
      const url = await rpc<string | null>('account_slack_webhook_url', {
        p_account: accountId,
        p_now: now.toISOString(),
      });
      return typeof url === 'string' && url.length > 0 ? url : null;
    },

    async claimSlack(key, accountId, now): Promise<Claim> {
      return ClaimSchema.parse(
        await rpc('claim_slack_send', {
          p_key: key,
          p_account: accountId,
          p_now: now.toISOString(),
        }),
      );
    },

    async finishSlack(key, status, errorCode, now) {
      await rpc('finish_slack_send', {
        p_key: key,
        p_status: status,
        p_error: errorCode,
        p_now: now.toISOString(),
      });
    },

    async record(delivery: Delivery) {
      await rpc('record_alert_delivery', { p: delivery });
    },
  };
}
