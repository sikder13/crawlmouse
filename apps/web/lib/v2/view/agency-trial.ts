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
import { AGENCIES_COPY } from '../copy/agencies';
import { AGENCY_TRIAL_COPY as COPY } from '../copy/agency-trial';
import { SETTINGS_COPY } from '../copy/settings';
import { footerComing, tagged, type TaggedView } from './agencies';
import { portalRefusal } from '../../billing/portal-v2';
import { dayDate } from '../format';
import { PLAN_NAMES } from './account';
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
  /**
   * When the subscription it follows is set to cancel at its period's end (the cancel route sets
   * `cancel_at_period_end`), that end: the mirror's `current_period_end`, as Settings reads it
   * (`loadSettingsDataset`'s `billingEnd`). Null when it is not set to cancel, or follows none.
   */
  billingEnd: Date | null;
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
   * cancel route refuses (`no_subscription`), and when it is already set to cancel (`billingEnd`).
   */
  cancel: { ask: PageForm; confirm: (PageForm & { text: string }) | null } | null;
}

/**
 * A sentence that names a capability is a `TaggedView` (For agencies' table), marked "coming"
 * (`comingLabel`) when one of its capabilities is not built.
 */
export interface AgencyTrialForm {
  kind: 'form';
  title: string;
  lead: TaggedView[];
  returning: string | null;
  email: string | null;
  interval: Interval;
  intervalText: string;
  otherIntervalHref: string;
  defaults: { agencyName: string; site: string };
  consent: string;
  hints: { agencyName: TaggedView; site: TaggedView };
  fine: TaggedView;
  aside: { kicker: string; title: TaggedView; rows: [TaggedView, string][]; foot: TaggedView };
  comingLabel: string;
}

export type AgencyTrialView = (
  | AgencyTrialForm
  | { kind: 'held'; title: string; text: string }
  | { kind: 'used'; title: string; text: string }
) & {
  manage: ManageView[];
  /** The footer line's "coming" label (`footerComing`). */
  footerComing: string | null;
};

const BILLED: ReadonlySet<AccountState> = new Set(['agency_trial', 'agency', 'past_due']);
const PORTAL = '/api/billing/portal';
const CANCEL = '/api/billing/cancel';

function manageView(row: AgencyAccountRow, input: AgencyTrialInput): ManageView {
  const m = COPY.manage;
  const date = (d: Date | null) => (d === null ? null : dayDate(d.toISOString(), input.timeZone));
  const ends = date(row.trialEndsAt);
  const state = row.state as 'agency_trial' | 'agency' | 'past_due';
  const askFields: Record<string, string> = { cancel: row.id };
  if (input.interval === 'year') askFields.interval = 'year';
  // Set to cancel (correctness B-r2-1): Settings' words for a plan set to end, and no second Cancel.
  // A past-due account says first that its payment failed, as Settings' plan card does.
  const ending = date(row.billingEnd);
  const text =
    ending === null || state === 'past_due'
      ? m.state(state, ends)
      : state === 'agency_trial'
        ? SETTINGS_COPY.trialCancelled(ending)
        : SETTINGS_COPY.cancelling(PLAN_NAMES.agency, ending);
  return {
    accountId: row.id,
    title: row.name ?? m.unnamed,
    text,
    portal: portalRefusal(input.customers.get(row.id) ?? null)
      ? null
      : { method: 'post', action: PORTAL, fields: { accountId: row.id }, label: m.portal },
    cancel:
      row.subscriptionId === null || ending !== null
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
  const footer = footerComing();
  if (standing.held) return { kind: 'held', ...COPY.held, manage, footerComing: footer };
  if (standing.used !== null) {
    return {
      kind: 'used',
      manage,
      footerComing: footer,
      title: COPY.used.title,
      text: COPY.used.text(dayDate(standing.used.trialUsedAt.toISOString(), input.timeZone)),
    };
  }
  const switched = COPY.interval(interval);
  return {
    kind: 'form',
    manage,
    footerComing: footer,
    title: COPY.title,
    lead: COPY.lead(interval, chargeDate(now, input.timeZone)).map(tagged),
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
    hints: { agencyName: tagged(COPY.agencyNameHint), site: tagged(COPY.siteHint) },
    fine: tagged(COPY.fine()),
    aside: {
      kicker: COPY.aside.kicker(interval),
      title: tagged(COPY.aside.title),
      // A coming capability's value says so, not "yes" (SEO R2-N5).
      rows: COPY.aside.rows().map(([what, value]) => {
        const row = tagged(what);
        return [row, row.coming && value === COPY.aside.yes ? AGENCIES_COPY.coming : value];
      }),
      foot: tagged(COPY.aside.foot(interval)),
    },
    comingLabel: AGENCIES_COPY.coming,
  };
}
