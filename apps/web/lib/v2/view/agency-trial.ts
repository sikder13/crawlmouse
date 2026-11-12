/**
 * The Agency trial page (Final-AgencyTrial, CC-29 D3) as data, and what a person's agency accounts
 * say about it. Pure: the page reads the rows (lib/v2/pricing/read.ts) and passes them in.
 *
 * A person's standing, from the agency accounts they sit on, in the order
 * `start_agency_trial_account` (migration 20261114000001) decides it:
 * - `held`: one of them is on Agency now (paid, trial, or the past-due grace), so there is nothing
 *   to start;
 * - `used`: they own one whose trial was used, so the function would answer `trial_used`;
 * - otherwise the form, which says the last Checkout did not finish when they own an agency account
 *   with no subscription and no trial used (owner ruling Q16: read from state, not from the URL).
 */
import type { Interval } from '../../billing/catalog';
import { TRIAL_DAYS } from '../../billing/state-machine';
import { effectiveTier, type Tier } from '../../entitlement-v2';
import type { AccountState } from '@crawlmouse/types/v2';
import { AGENCY_TRIAL_COPY as COPY } from '../copy/agency-trial';
import { dayDate } from '../format';

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
  used: AgencyAccountRow | null;
  /** The account a Checkout that did not finish left: owned, Free, no trial used, no subscription. */
  open: AgencyAccountRow | null;
}

export function agencyStanding(rows: readonly AgencyAccountRow[], now: Date): AgencyStanding {
  const owned = rows.filter((r) => r.role === 'owner');
  return {
    held: rows.some((r) => effectiveTier(r, now) === 'agency'),
    used: owned.find((r) => r.trialUsedAt !== null) ?? null,
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

export type AgencyTrialView =
  | AgencyTrialForm
  | { kind: 'held'; title: string; text: string }
  | { kind: 'used'; title: string; text: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day the card is charged if the trial starts at `now`: day TRIAL_DAYS + 1. */
export function chargeDate(now: Date, timeZone: string): string {
  return dayDate(new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(), timeZone);
}

export const agencyTrialPath = (interval: Interval) =>
  interval === 'month' ? '/agency-trial' : '/agency-trial?interval=year';

export function agencyTrialView(input: AgencyTrialInput, now: Date): AgencyTrialView {
  const { standing, interval } = input;
  if (standing.held) return { kind: 'held', ...COPY.held };
  if (standing.used !== null) {
    return {
      kind: 'used',
      title: COPY.used.title,
      text: COPY.used.text(dayDate(standing.used.trialUsedAt!.toISOString(), input.timeZone)),
    };
  }
  const switched = COPY.interval(interval);
  return {
    kind: 'form',
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
