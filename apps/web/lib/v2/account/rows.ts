/**
 * The contract Account and Seat (packages/types/src/v2/{account,seat}.ts) from their tables' rows, as
 * PostgREST returns them. Each builder takes the rows it is given and reads nothing; the caller
 * decides which client reads them. Each record is parsed with its contract schema, so a row the
 * contract refuses throws here.
 *
 * Where each Account field comes from:
 * - `accounts`: id, name, state, state_history, trial_ends_at, card_last4, timezone, the stored
 *   limits (site_limit, seat_limit, competitor_limit) and email_prefs (email_change_notes,
 *   email_trial_reminder).
 * - `GATES[accounts.tier]`: limits.pages_per_audit and limits.full_renders_per_month, which no
 *   column stores.
 * - the caller: `email`, the account's address (the owner's `users.email`).
 * - `subscriptions` (the row `accounts.current_subscription_id` names): renews_at, the period end
 *   unless the subscription is set to cancel then; billing_period_months from its interval.
 * - `api_keys`: the account's unrevoked keys; a seat that cannot read them passes none.
 * - `agency_brands`: branding.
 *
 * What no table holds: integrations (no table records a connection, so the list is empty), the
 * Agency trial's consent (an account whose history holds an Agency trial is refused rather than
 * given a consent nothing recorded), and a logo URL (agency_brands.logo_path is a storage path; a
 * stored logo is refused rather than dropped).
 */
import {
  AccountSchema,
  AlertRuleSchema,
  ReportSchema,
  SeatSchema,
  type Account,
  type AgencyBranding,
  type AlertRule,
  type Report,
  type Seat,
} from '@crawlmouse/types/v2';
import { GATES, type Tier } from '../../entitlement-v2';
import { instantFromDb } from '../pipeline/rows';

type Row = Record<string, unknown>;

export interface AccountRows {
  account: Row;
  /** The account's address: its owner's `users.email`. */
  email: string;
  /** The subscription `accounts.current_subscription_id` names, or null for none. */
  subscription: Row | null;
  /** The account's `api_keys` rows; revoked ones are left out here. */
  apiKeys: readonly Row[];
  /** The account's `agency_brands` row, or null for none. */
  brand: Row | null;
  /**
   * `accounts.agency_trial_consent_at` (migration 20261114000001), which no client role reads: when
   * the owner ticked the Agency trial's consent. The loaders read it with the service role for an
   * account whose history holds an Agency trial (`agencyTrialConsentAt`); left out, it reads as none.
   */
  trialConsentAt?: unknown;
}

/** Whether the account's history holds an Agency trial: the accounts whose consent is read. */
export const hadAgencyTrial = (account: Row): boolean =>
  ((account.state_history as Row[] | undefined) ?? []).some((h) => h.state === 'agency_trial');

const instantOrNull = (v: unknown): string | null => (v === null ? null : instantFromDb(v));

const PERIOD_MONTHS: Record<string, number> = { month: 1, year: 12 };

export function accountFromRow(rows: AccountRows): Account {
  const { account: a, subscription: sub, brand } = rows;
  const history = (a.state_history as Row[] | undefined)?.map((h) => ({
    state: h.state,
    since: instantFromDb(h.since),
  }));
  // The contract holds the consent exactly when the account has had an Agency trial (its rule
  // `trial_consent`). CC-29's form records it before Checkout; a trial with none recorded is refused
  // here by name, not by the schema.
  const hadTrial = hadAgencyTrial(a);
  const consentAt = rows.trialConsentAt ?? null;
  if (hadTrial && consentAt === null)
    throw new Error(
      `accountFromRow: account ${String(a.id)} had an Agency trial and its consent is not recorded`,
    );
  const gates = GATES[a.tier as Tier];
  return AccountSchema.parse({
    id: a.id,
    email: rows.email,
    name: a.name,
    state: a.state,
    state_history: history,
    trial_ends_at: instantOrNull(a.trial_ends_at),
    card_last4: a.card_last4,
    renews_at:
      sub === null || sub.cancel_at_period_end === true
        ? null
        : instantOrNull(sub.current_period_end),
    billing_period_months: sub === null ? null : (PERIOD_MONTHS[sub.interval as string] ?? null),
    timezone: a.timezone,
    limits: {
      sites: a.site_limit,
      seats: a.seat_limit,
      pages_per_audit: gates?.pagesPerCheck,
      competitors_per_site: a.competitor_limit,
      full_renders_per_month: gates?.fullRendersPerMonth,
    },
    email_prefs: { change_notes: a.email_change_notes, trial_reminder: a.email_trial_reminder },
    integrations: [],
    api_keys: rows.apiKeys.filter(unrevoked).map((k) => ({
      prefix: k.prefix,
      created_at: instantFromDb(k.created_at),
      last_used_at: instantOrNull(k.last_used_at),
    })),
    branding: brand === null ? null : brandingFromRow(brand),
    agency_trial_consent: hadTrial ? { recorded_at: instantFromDb(consentAt) } : null,
  });
}

function unrevoked(key: Row): boolean {
  if (!Object.hasOwn(key, 'revoked_at'))
    throw new Error('accountFromRow: an api_keys row must carry revoked_at');
  return key.revoked_at === null;
}

/** A row's columns are passed as they are, so one read without a column fails the schema. */
function brandingFromRow(b: Row): AgencyBranding {
  if (b.logo_path !== null)
    throw new Error(
      `accountFromRow: account ${String(b.account_id)} has a stored logo and no URL to serve it at`,
    );
  const domain = b.portal_domain;
  const sender = b.sender_from;
  return {
    agency_name: b.agency_name,
    logo_url: null,
    accent_hex: b.accent_hex,
    portal_domain: domain,
    dns:
      domain === null
        ? null
        : {
            txt_found: b.portal_txt_verified_at !== null,
            cname_found: b.portal_cname_found,
            certificate_issued_at: instantOrNull(b.portal_certificate_issued_at),
          },
    sender_email: sender,
    email_auth:
      sender === null
        ? null
        : { spf_passes: b.spf_passes, dkim_passes: b.dkim_passes, dmarc_policy: b.dmarc_policy },
    open_tracking_default: b.open_tracking_default,
    postal_address: b.postal_address,
  } as AgencyBranding;
}

/**
 * A seat. `siteIds` are the site ids of the seat's `seat_sites` rows: a scoped seat
 * (`client_scope_all` false) sees those, and one with none is refused, since the contract's scope
 * lists at least one site. The email is the address the seat was invited at (`invited_email`).
 */
export function seatFromRow(row: Row, siteIds: readonly string[]): Seat {
  const scoped = row.client_scope_all === false;
  if (scoped && siteIds.length === 0)
    throw new Error(`seatFromRow: seat ${String(row.id)} is scoped to no site`);
  return SeatSchema.parse({
    id: row.id,
    account_id: row.account_id,
    email: row.invited_email,
    name: row.name,
    role: row.role,
    client_scope: scoped ? [...siteIds] : 'all',
    alert_channels: row.alert_channels,
    theme: row.theme,
    invited_at: instantFromDb(row.created_at),
    accepted_at: instantOrNull(row.accepted_at),
  });
}

/**
 * An account's seats from the `seats` rows and `seat_sites` rows the caller reads. Row security
 * shows a seat scoped to some clients its own seat and the owner's, with the scope rows of the sites
 * it covers (migration 20261114000002, section S), so each seat that arrives here arrives with its
 * whole scope.
 */
export function seatsFromRows(seatRows: readonly Row[], scopeRows: readonly Row[]): Seat[] {
  const sitesOf = (seatId: unknown) =>
    scopeRows.filter((r) => r.seat_id === seatId).map((r) => r.site_id as string);
  return seatRows.map((s) => seatFromRow(s, sitesOf(s.id)));
}

/** An alert rule: its columns are the contract's fields. */
export function alertRuleFromRow(row: Row): AlertRule {
  return AlertRuleSchema.parse({
    id: row.id,
    account_id: row.account_id,
    site_id: row.site_id,
    kind: row.kind,
    enabled: row.enabled,
    threshold_points: row.threshold_points,
    channels: row.channels,
    last_fired_at: instantOrNull(row.last_fired_at),
    last_fired_check_id: row.last_fired_check_id,
  });
}

/** A report: its columns are the contract's fields, less the database's `storage_path`. */
export function reportFromRow(row: Row): Report {
  return ReportSchema.parse({
    id: row.id,
    account_id: row.account_id,
    site_id: row.site_id,
    kind: row.kind,
    format: row.format,
    status: row.status,
    made_by: row.made_by,
    created_at: instantFromDb(row.created_at),
    covers_check_ids: row.covers_check_ids,
    byte_count: row.byte_count,
    share_expires_at: instantOrNull(row.share_expires_at),
    public_slug: row.public_slug,
    scheduled_for: instantOrNull(row.scheduled_for),
    sent_at: instantOrNull(row.sent_at),
    recipient_email: row.recipient_email,
    owner_seat_id: row.owner_seat_id,
    headline: row.headline,
    open_tracking: row.open_tracking,
    opened_at: instantOrNull(row.opened_at),
  });
}
