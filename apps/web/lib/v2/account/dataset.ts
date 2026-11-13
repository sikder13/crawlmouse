/**
 * One account's records as the dashboard, the site page and the account frame read them
 * (`dashboardView`, `sitePage`, `accountShellView`): the account screens' dataset, measured.
 *
 * Which client reads what (plan revision R10). The caller's own client reads the account, its
 * seats and their site scopes, its subscription, API keys and brand, its alert rules and public
 * links, and the ids of its live sites. Row security decides each: a scoped seat's site list holds
 * only the sites of its `seat_sites` rows, and a developer's API key list is empty. The service role
 * then reads, for exactly those site ids, the site rows with their client report, their checks,
 * fixes, fix events and changes (`site_fixes` and `fix_events` have no client grant, and
 * `changes.fix_id` is outside the client's column grant), and the owner's `users.email`, which the
 * Account record carries.
 *
 * What it leaves empty: page_results, link_edges, access_tests, lineages, usage_events, withheld
 * and engine_derived. The three views read none of them; `dataset.test.ts` runs them over a
 * fixture with those collections emptied and gets the same models. `reports` holds the sites'
 * public links only, the one kind the site page reads.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountDataset } from '../view/account';
import {
  changeFromRow,
  checkFromRow,
  fixEventFromRow,
  fixFromRow,
  siteFromRow,
} from '../pipeline/rows';
import type { CheckReader } from '../pipeline/types';
import { sitesInScope } from '../agency/guard';
import { agencyTrialConsentAt } from './trial-consent';
import { accountFromRow, alertRuleFromRow, reportFromRow, seatsFromRows } from './rows';

export interface DatasetDeps {
  /** The caller's own client: row security applies. */
  session: SupabaseClient;
  /** The service role, for the owner's email. */
  admin: SupabaseClient;
  /** The service role's paged reader (`supabaseCheckReader(admin)` in production). */
  records: CheckReader;
}

type Row = Record<string, unknown>;

const ACCOUNT_COLUMNS =
  'id, name, state, tier, state_history, trial_ends_at, card_last4, timezone, site_limit, ' +
  'seat_limit, competitor_limit, email_change_notes, email_trial_reminder, current_subscription_id';
const SEAT_COLUMNS =
  'id, account_id, user_id, invited_email, name, role, status, alert_channels, theme, ' +
  'created_at, accepted_at, client_scope_all';
const SUBSCRIPTION_COLUMNS = 'id, interval, current_period_end, cancel_at_period_end';
const KEY_COLUMNS = 'prefix, created_at, last_used_at, revoked_at';
const BRAND_COLUMNS =
  'account_id, agency_name, logo_path, accent_hex, portal_domain, portal_txt_verified_at, ' +
  'portal_cname_found, portal_certificate_issued_at, sender_from, spf_passes, dkim_passes, ' +
  'dmarc_policy, open_tracking_default, postal_address';
const ALERT_COLUMNS =
  'id, account_id, site_id, kind, enabled, threshold_points, channels, last_fired_at, ' +
  'last_fired_check_id';
const REPORT_COLUMNS =
  'id, account_id, site_id, kind, format, status, made_by, created_at, covers_check_ids, ' +
  'byte_count, share_expires_at, public_slug, scheduled_for, sent_at, recipient_email, ' +
  'owner_seat_id, headline, open_tracking, opened_at';

interface Answer<T> {
  data: T | null;
  error: { message: string } | null;
}

async function rows(what: string, query: PromiseLike<Answer<unknown>>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`loadAccountDataset: ${what} failed: ${error.message}`);
  return (data ?? []) as Row[];
}

async function row(what: string, query: PromiseLike<Answer<unknown>>): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw new Error(`loadAccountDataset: ${what} failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

export async function loadAccountDataset(
  deps: DatasetDeps,
  accountId: string,
  now: Date,
): Promise<AccountDataset> {
  const { session, admin, records } = deps;
  const accountRow = await row(
    'accounts read',
    session.from('accounts').select(ACCOUNT_COLUMNS).eq('id', accountId).maybeSingle(),
  );
  if (accountRow === null) throw new Error(`loadAccountDataset: no account ${accountId}`);

  const [seatRows, scopeRows, keyRows, brand, siteIds, accountRules] = await Promise.all([
    rows(
      'seats read',
      session
        .from('seats')
        .select(SEAT_COLUMNS)
        .eq('account_id', accountId)
        .not('status', 'eq', 'removed'),
    ),
    rows(
      'seat_sites read',
      session.from('seat_sites').select('seat_id, site_id').eq('account_id', accountId),
    ),
    rows('api_keys read', session.from('api_keys').select(KEY_COLUMNS).eq('account_id', accountId)),
    row(
      'agency_brands read',
      session.from('agency_brands').select(BRAND_COLUMNS).eq('account_id', accountId).maybeSingle(),
    ),
    sitesInScope(session, accountId),
    rows(
      'alert_rules read',
      session
        .from('alert_rules')
        .select(ALERT_COLUMNS)
        .eq('account_id', accountId)
        .is('site_id', null),
    ),
  ]);
  const subscription =
    accountRow.current_subscription_id === null
      ? null
      : await row(
          'subscriptions read',
          session
            .from('subscriptions')
            .select(SUBSCRIPTION_COLUMNS)
            .eq('id', accountRow.current_subscription_id as string)
            .maybeSingle(),
        );

  const owner = seatRows.find((s) => s.role === 'owner' && s.status === 'active');
  if (!owner) throw new Error(`loadAccountDataset: account ${accountId} has no active owner`);
  const ownerUser = await row(
    'users read',
    admin
      .from('users')
      .select('email')
      .eq('id', owner.user_id as string)
      .maybeSingle(),
  );
  if (ownerUser === null) throw new Error(`loadAccountDataset: no user for ${accountId}'s owner`);
  const trialConsentAt = await agencyTrialConsentAt(admin, accountRow);

  const some = siteIds.length > 0;
  const [siteRows, schedules, checkRows, fixRows, changeRows, siteRules, links] = some
    ? await Promise.all([
        records.rows('sites', 'id', siteIds),
        records.rows('report_schedules', 'site_id', siteIds),
        records.rows('checks', 'site_id', siteIds),
        records.rows('site_fixes', 'site_id', siteIds),
        records.rows('changes', 'site_id', siteIds),
        rows(
          'alert_rules read',
          session.from('alert_rules').select(ALERT_COLUMNS).in('site_id', siteIds),
        ),
        rows(
          'reports read',
          session
            .from('reports')
            .select(REPORT_COLUMNS)
            .in('site_id', siteIds)
            .eq('kind', 'public_link'),
        ),
      ])
    : [[], [], [], [], [], [], []];
  const eventRows = fixRows.length
    ? await records.rows(
        'fix_events',
        'fix_id',
        fixRows.map((f) => f.id as string),
      )
    : [];

  const scheduleOf = new Map(schedules.map((r) => [r.site_id, r]));
  const asOf = now.toISOString();
  return {
    provenance: 'measured',
    as_of: asOf,
    description: `Account ${accountId}: ${siteIds.length} live sites, read at ${asOf}.`,
    engine_derived: [],
    accounts: [
      accountFromRow({
        account: accountRow,
        email: ownerUser.email as string,
        subscription,
        trialConsentAt,
        apiKeys: keyRows,
        brand,
      }),
    ],
    seats: seatsFromRows(seatRows, scopeRows),
    sites: siteRows.map((s) =>
      siteFromRow({ ...s, report_schedules: scheduleOf.get(s.id) ?? null }),
    ),
    checks: checkRows.map(checkFromRow),
    page_results: [],
    link_edges: [],
    access_tests: [],
    fixes: fixRows.map(fixFromRow),
    fix_events: eventRows.map(fixEventFromRow),
    changes: changeRows.map(changeFromRow),
    alert_rules: [...accountRules, ...siteRules].map(alertRuleFromRow),
    reports: links.map(reportFromRow),
    lineages: [],
    usage_events: [],
    withheld: [],
  };
}
