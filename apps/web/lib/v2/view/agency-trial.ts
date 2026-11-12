/**
 * The Agency trial page (Final-AgencyTrial, CC-29 D3) as data, and what a person's agency accounts
 * say about it. Pure: the page reads the rows (lib/v2/pricing/read.ts) and passes them in.
 *
 * A person's standing, from the agency accounts they sit on, in the order
 * `start_agency_trial_account` (migration 20261114000001) decides it:
 * - `held`: one of them is on Agency now (paid, trial, or the past-due grace), so there is nothing
 *   to start;
 * - `used`: they own one whose trial was used, a deleted one included, so the function would answer
 *   `trial_used` (read by its rule, lib/v2/pricing/used-trial.ts);
 * - otherwise the form, which says the last Checkout did not finish when they own an agency account
 *   with no subscription and no trial used (owner ruling Q16: read from state, not from the URL).
 */
import type { Interval } from '../../billing/catalog';
import { TRIAL_DAYS } from '../../billing/state-machine';
import { effectiveTier, type Tier } from '../../entitlement-v2';
import type { AccountState } from '@crawlmouse/types/v2';
import { AGENCY_TRIAL_COPY as COPY } from '../copy/agency-trial';
import { portalRefusal } from '../../billing/portal-v2';
import { dayDate } from '../format';
import type { UsedTrial } from '../pricing/used-trial';

export interface AgencyAccountRow {
  id: string;
  /** The person's seat role on it. */
  role: string;
  name: string | null;
  state: AccountState;
  tier: Tier;
  pastDueTier: 'pro' | 'agency' | null;
  pastDueSince: Date | null;
  trialVariant: 'no_card' | 'card_required' | null;
  trialEndsAt: Date | null;
  trialUsedAt: Date | null;
  subscriptionId: string | null;
  /** The account's first site, when it holds one. */
  firstSite: string | null;
}

export interface AgencyStanding {
  held: boolean;
  /**
   * The owned accounts on the Agency trial, Agency or past due: each gets its own Manage billing and
   * Cancel here (Q26), since Settings acts on the person's default account.
   */
  billing: AgencyAccountRow[];
  used: UsedTrial | null;
  /** The account a Checkout that did not finish left: owned, Free, no trial used, no subscription. */
  open: AgencyAccountRow | null;
}

export function agencyStanding(
  rows: readonly AgencyAccountRow[],
  used: UsedTrial | null,
  now: Date,
): AgencyStanding {
  const owned = rows.filter((r) => r.role === 'owner');
  return {
    held: rows.some((r) => effectiveTier(r, now) === 'agency'),
    billing: owned.filter((r) => BILLED.has(r.state)),
    used,
    open:
      owned.find(
        (r) => r.state === 'free' && r.trialUsedAt === null && r.subscriptionId === null,
      ) ?? null,
  };
}

export interface AgencyTrialInput {
  email: string | null;
  interval: Interval;
  /** The zone the charge date is shown in: the viewer's account's, else UTC. */
  timeZone: string;
  standing: AgencyStanding;
  /** The Stripe customer of each account in `standing.billing`, which the portal needs. */
  customers: ReadonlyMap<string, string | null>;
  /** The account whose Cancel was asked (`?cancel=<id>`): its confirmation is shown. */
  cancelAsked: string | null;
}

/** A form on the page: its route, method and hidden fields. */
export interface PageForm {
  method: 'get' | 'post';
  action: string;
  fields: Readonly<Record<string, string>>;
  label: string;
}

/** One owned agency account's billing (Q26): CC-03's portal and cancel, naming the account. */
export interface ManageView {
  accountId: string;
  title: string;
  text: string;
  /** Null when CC-03's portal would refuse it (`portalRefusal`: no Stripe customer). */
  portal: PageForm | null;
  /**
   * CC-03 D8's two clicks: `ask` reloads this page with the confirmation; `confirm` posts to the
   * cancel route with `confirm=true`. Null when the account follows no subscription, which the
   * cancel route refuses (`no_subscription`).
   */
  cancel: { ask: PageForm; confirm: (PageForm & { text: string }) | null } | null;
}

export interface AgencyTrialForm {
  kind: 'form';
  title: string;
  lead: string;
  returning: string | null;
  email: string | null;
  interval: Interval;
  intervalText: string;
  otherIntervalHref: string;
  defaults: { agencyName: string; site: string };
  consent: string;
  aside: { kicker: string; title: string; rows: [string, string][]; foot: string };
}

export type AgencyTrialView = (
  | AgencyTrialForm
  | { kind: 'held'; title: string; text: string }
  | { kind: 'used'; title: string; text: string }
) & { manage: ManageView[] };

const BILLED: ReadonlySet<AccountState> = new Set(['agency_trial', 'agency', 'past_due']);
const PORTAL = '/api/billing/portal';
const CANCEL = '/api/billing/cancel';

function manageView(row: AgencyAccountRow, input: AgencyTrialInput): ManageView {
  const m = COPY.manage;
  const ends =
    row.trialEndsAt === null ? null : dayDate(row.trialEndsAt.toISOString(), input.timeZone);
  const state = row.state as 'agency_trial' | 'agency' | 'past_due';
  const askFields: Record<string, string> = { cancel: row.id };
  if (input.interval === 'year') askFields.interval = 'year';
  return {
    accountId: row.id,
    title: row.name ?? m.unnamed,
    text: m.state(state, ends),
    portal: portalRefusal(input.customers.get(row.id) ?? null)
      ? null
      : { method: 'post', action: PORTAL, fields: { accountId: row.id }, label: m.portal },
    cancel:
      row.subscriptionId === null
        ? null
        : {
            ask: {
              method: 'get',
              action: '/agency-trial',
              fields: askFields,
              label: m.cancel(state),
            },
            confirm:
              input.cancelAsked === row.id
                ? {
                    method: 'post',
                    action: CANCEL,
                    fields: { accountId: row.id, confirm: 'true' },
                    label: m.confirm,
                    text: m.confirmText(state, ends),
                  }
                : null,
          },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day the card is charged if the trial starts at `now`: day TRIAL_DAYS + 1. */
export function chargeDate(now: Date, timeZone: string): string {
  return dayDate(new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(), timeZone);
}

export const agencyTrialPath = (interval: Interval) =>
  interval === 'month' ? '/agency-trial' : '/agency-trial?interval=year';

export function agencyTrialView(input: AgencyTrialInput, now: Date): AgencyTrialView {
  const { standing, interval } = input;
  const manage = standing.billing.map((r) => manageView(r, input));
  if (standing.held) return { kind: 'held', ...COPY.held, manage };
  if (standing.used !== null) {
    return {
      kind: 'used',
      manage,
      title: COPY.used.title,
      text: COPY.used.text(dayDate(standing.used.trialUsedAt.toISOString(), input.timeZone)),
    };
  }
  const switched = COPY.interval(interval);
  return {
    kind: 'form',
    manage,
    title: COPY.title,
    lead: COPY.lead(interval, chargeDate(now, input.timeZone)),
    returning: standing.open ? COPY.returning : null,
    email: input.email,
    interval,
    intervalText: switched.text,
    otherIntervalHref: agencyTrialPath(switched.other),
    defaults: {
      agencyName: standing.open?.name ?? '',
      site: standing.open?.firstSite ?? '',
    },
    consent: COPY.consent(interval),
    aside: {
      kicker: COPY.aside.kicker(interval),
      title: COPY.aside.title,
      rows: COPY.aside.rows(),
      foot: COPY.aside.foot(interval),
    },
  };
}
