/**
 * One account's records as Settings, its plan card, its delete step and Trial ending read them
 * (`settingsView`, `deleteStepView`, `trialEndView`, `trialEndedView`). A narrow stand-in for CC-26b's
 * `loadAccountDataset` (lib/v2/account/dataset.ts on build/cc-26b-dashboard), which is not on this
 * branch's base: the lead swaps this file for that loader at the merge, keeping `billingEnd`.
 *
 * Which collections it fills, measured: run over the bad-site and clean-site fixtures with one
 * collection emptied at a time, Settings and the delete step change when accounts, sites, checks or
 * changes are emptied, and Trial ending when accounts, sites, checks, fixes, fix_events, changes,
 * alert_rules or reports are (settings-dataset.test.ts repeats that measurement). Seats are read too,
 * because the account frame looks for the owner's seat. page_results, link_edges, access_tests,
 * lineages, usage_events, withheld and engine_derived are left empty; the account's API keys and
 * brand are passed to `accountFromRow` as none, since no view here reads them.
 *
 * Which client reads what, as CC-26b's loader does. The caller's own client reads the account, its
 * seats and site scopes, its subscription, its alert rules and reports, and the ids of its live
 * sites; row security decides each. The service role then reads, for those site ids only, the site
 * rows with their client report, their checks, fixes, fix events and changes (no client grant on
 * site_fixes and fix_events), and the owner's `users.email`.
 */
import {
  AlertRuleSchema,
  ReportSchema,
  type AlertRule,
  type FixtureDataset,
  type Report,
} from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  changeFromRow,
  checkFromRow,
  fixEventFromRow,
  fixFromRow,
  instantFromDb,
  siteFromRow,
} from '../pipeline/rows';
import type { CheckReader } from '../pipeline/types';
import { accountFromRow, seatFromRow } from './rows';

export interface SettingsDatasetDeps {
  /** The caller's own client: row security applies. */
  session: SupabaseClient;
  /** The service role, for the owner's email. */
  admin: SupabaseClient;
  /** The service role's paged reader (`supabaseCheckReader(admin)` in production). */
  records: CheckReader;
}

/**
 * The account's records in the contract's shape, marked as measured. The views on this branch's base
 * take a FixtureDataset, whose provenance can only be "fixture"; CC-26b's `AccountDataset` widens it
 * to "measured". Until the merge, `viewInput` hands these records to the views.
 */
export type AccountRecords = Omit<FixtureDataset, 'provenance'> & { provenance: 'measured' };

/** The records as the views on this base type their input (see AccountRecords); goes at the merge. */
export const viewInput = (d: AccountRecords): FixtureDataset => d as unknown as FixtureDataset;

export interface SettingsDataset {
  d: AccountRecords;
  /**
   * When the paid plan ends, for a subscription set to cancel at its period's end: the plan is shown
   * until then (spec 27 "Cancel"). Null otherwise. The contract's Account has no field for it.
   */
  billingEnd: string | null;
}

type Row = Record<string, unknown>;

const ACCOUNT_COLUMNS =
  'id, name, state, tier, state_history, trial_ends_at, card_last4, timezone, site_limit, ' +
  'seat_limit, competitor_limit, email_change_notes, email_trial_reminder, current_subscription_id';
const SEAT_COLUMNS =
  'id, account_id, user_id, invited_email, name, role, status, alert_channels, theme, ' +
  'created_at, accepted_at, client_scope_all';
const SUBSCRIPTION_COLUMNS = 'id, interval, current_period_end, cancel_at_period_end';
const ALERT_COLUMNS =
  'id, account_id, site_id, kind, enabled, threshold_points, channels, last_fired_at, ' +
  'last_fired_check_id';
const REPORT_COLUMNS =
  'id, account_id, site_id, kind, format, status, made_by, created_at, covers_check_ids, ' +
  'byte_count, share_expires_at, public_slug, scheduled_for, sent_at, recipient_email, ' +
  'owner_seat_id, headline, open_tracking, opened_at';

interface Answer {
  data: unknown;
  error: { message: string } | null;
}

async function rows(what: string, query: PromiseLike<Answer>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`loadSettingsDataset: ${what} failed: ${error.message}`);
  return (data ?? []) as Row[];
}

async function row(what: string, query: PromiseLike<Answer>): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw new Error(`loadSettingsDataset: ${what} failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

const instantOrNull = (v: unknown): string | null => (v === null ? null : instantFromDb(v));

// CC-26b's rows.ts exports `alertRuleFromRow` and `reportFromRow` of the same shape; these two go at
// the merge with the rest of this file.
function alertRuleFromRow(r: Row): AlertRule {
  return AlertRuleSchema.parse({ ...r, last_fired_at: instantOrNull(r.last_fired_at) });
}

function reportFromRow(r: Row): Report {
  return ReportSchema.parse({
    ...r,
    created_at: instantFromDb(r.created_at),
    share_expires_at: instantOrNull(r.share_expires_at),
    scheduled_for: instantOrNull(r.scheduled_for),
    sent_at: instantOrNull(r.sent_at),
    opened_at: instantOrNull(r.opened_at),
  });
}

export async function loadSettingsDataset(
  deps: SettingsDatasetDeps,
  accountId: string,
  now: Date,
): Promise<SettingsDataset> {
  const { session, admin, records } = deps;
  const accountRow = await row(
    'accounts read',
    session.from('accounts').select(ACCOUNT_COLUMNS).eq('id', accountId).maybeSingle(),
  );
  if (accountRow === null) throw new Error(`loadSettingsDataset: no account ${accountId}`);

  const [seatRows, scopeRows, liveSites, accountRules] = await Promise.all([
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
    rows(
      'sites read',
      session.from('sites').select('id').eq('account_id', accountId).is('removed_at', null),
    ),
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
  if (!owner) throw new Error(`loadSettingsDataset: account ${accountId} has no active owner`);
  const ownerUser = await row(
    'users read',
    admin
      .from('users')
      .select('email')
      .eq('id', owner.user_id as string)
      .maybeSingle(),
  );
  if (ownerUser === null) throw new Error(`loadSettingsDataset: no user for ${accountId}'s owner`);

  const siteIds = liveSites.map((s) => s.id as string);
  const [siteRows, schedules, checkRows, fixRows, changeRows, siteRules, reportRows] =
    siteIds.length > 0
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
            session.from('reports').select(REPORT_COLUMNS).in('site_id', siteIds),
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
  const sitesOf = (seatId: unknown) =>
    scopeRows.filter((r) => r.seat_id === seatId).map((r) => r.site_id as string);
  const asOf = now.toISOString();
  const d: AccountRecords = {
    provenance: 'measured',
    as_of: asOf,
    description: `Account ${accountId}: ${siteIds.length} live sites, read at ${asOf} for Settings and Trial ending.`,
    engine_derived: [],
    accounts: [
      accountFromRow({
        account: accountRow,
        email: ownerUser.email as string,
        subscription,
        apiKeys: [],
        brand: null,
      }),
    ],
    seats: seatRows.map((s) => seatFromRow(s, sitesOf(s.id))),
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
    reports: reportRows.map(reportFromRow),
    lineages: [],
    usage_events: [],
    withheld: [],
  };
  return {
    d,
    billingEnd:
      subscription !== null && subscription.cancel_at_period_end === true
        ? instantFromDb(subscription.current_period_end)
        : null,
  };
}
