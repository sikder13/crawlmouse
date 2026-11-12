/**
 * The Agency trial page's sentences (Final-AgencyTrial, with FACTS-proposed Part 2's A6, A8, A9, D5
 * and K10, and J15 as overruled: Checkout is Stripe's hosted page, so the artboard's card fields
 * become the consent checkbox and the first client site, then the redirect). Every price comes from
 * `prices.ts`, every limit from `GATES`, the trial's length from `TRIAL_DAYS`. A sentence that names a
 * capability carries it, as For agencies' copy does, and the page marks "coming" each one that is
 * not built (Q27).
 */
import { EMAIL_KINDS, TRIAL_REMINDER_DAYS_BEFORE_END } from '../../auth/constants';
import type { Interval } from '../../billing/catalog';
import { AGENCY_YEARLY, EXTRA_SEAT, usd } from '../../billing/prices';
import { TRIAL_DAYS } from '../../billing/state-machine';
import { GATES } from '../../entitlement-v2';
import { count, numberWord, capitalise } from '../words';
import type { Tagged } from './agencies';
import { ANNUAL_RENEWAL_REMINDER_DAYS, monthsFree, priceOf } from './pricing';
import { CANCEL_CLICKS } from './settings';

const agency = GATES.agency;
const period = (interval: Interval) => (interval === 'month' ? 'month' : 'year');

export const AGENCY_TRIAL_COPY = {
  /** The page's title and h1. */
  title: 'Start your Agency trial.',
  lead: (interval: Interval, chargeDate: string): Tagged[] => [
    {
      text: `${TRIAL_DAYS} days, nothing charged. On day ${TRIAL_DAYS + 1} — ${chargeDate} if you start today — the card is charged ${usd(priceOf('agency', interval))} for the ${period(interval)} unless you cancel, from this page, any day before, ${numberWord(CANCEL_CLICKS)} clicks; canceling puts the account on Free; nothing you can see is deleted.`,
      capabilities: ['agency_trial', 'cancel'],
    },
    {
      text: `We email you ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before, as with every trial.`,
      capabilities: ['trial_reminder'],
    },
  ],
  /** Q16: an agency account with no subscription and no trial used is a Checkout that did not finish. */
  returning:
    'Your last visit to the card page did not finish, so nothing started. Check the details and continue to the card again.',
  signedInAs: 'Signed in as',
  agencyName: 'Agency name',
  agencyNameHint: { text: 'shown on client reports', capabilities: ['client_reports'] } as Tagged,
  site: 'First client site',
  /** Q5: the site is stored, not audited, before the card is taken. */
  siteHint: {
    text: 'its first audit runs from the agency workspace',
    capabilities: ['agency_workspace'],
  } as Tagged,
  sitePlaceholder: 'clientsite.com',
  interval: (interval: Interval) =>
    interval === 'month'
      ? {
          text: `Paying monthly. Pay yearly instead: ${usd(AGENCY_YEARLY)} a year, ${numberWord(monthsFree())} months free.`,
          other: 'year' as const,
        }
      : {
          text: `Paying yearly. Pay monthly instead: ${usd(priceOf('agency', 'month'))} a month.`,
          other: 'month' as const,
        },
  switchInterval: 'Switch',
  /** The consent checkbox: renewal, EU withdrawal, Terms (FACTS J15, L6). */
  consent: (interval: Interval) =>
    `I agree that after ${TRIAL_DAYS} days the card is charged ${usd(priceOf('agency', interval))} a ${period(interval)}, renewing each ${period(interval)} until I cancel; that I ask for the service to start straight away, during the withdrawal period EU and UK law gives me; and to the Terms.`,
  terms: 'Terms',
  privacy: 'Privacy',
  card: 'The card is taken on Stripe’s own page next; the number never reaches our servers. Nothing is charged for the trial.',
  submit: `Start a ${TRIAL_DAYS}-day trial`,
  /** A9: Stripe sends the receipts. FACTS: renewal reminders are the annual subscriber's exception. */
  fine: (): Tagged => {
    const [first, second] = ANNUAL_RENEWAL_REMINDER_DAYS;
    return {
      text: `${capitalise(numberWord(EMAIL_KINDS.length))} kinds of email and no others: sign-in links, a note when a check finds a change, and the reminder ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before the trial ends; paid yearly, also renewal reminders ${first} and ${second} days before it renews. Stripe sends the receipts.`,
      capabilities: ['change_emails', 'trial_reminder', 'renewal_reminders'],
    };
  },
  /** Q15: where the trialist lands until the agency workspace (CC-31) has its switcher. */
  secondAccount:
    'The trial is a second account for the agency, separate from your own. After the card page you return to your own account’s plan; the agency account’s billing and its Cancel are on this page.',
  notSure: `Not sure yet? Your own account can start ${TRIAL_DAYS} days of Pro with no card, from`,
  pricing: 'Pricing',
  seePlans: 'See the plans',
  /** A `trial_refused` shows `trialRefusal`'s reason instead (AgencyTrialForm). */
  errors: {
    invalid: 'Tick the box, and give the agency a name and one client site.',
    invalid_host: 'That is not a site address. Type a domain such as clientsite.com.',
    host_refused:
      'That address is private or reserved, so it cannot be audited. Use the client’s public site.',
    trial_used: 'Your agency trial was used, so it cannot start again.',
    rate_limited: 'That is too many tries for now. Wait a few minutes and try again.',
    billing_unavailable: 'The card page is not available right now. Try again in a few minutes.',
    failed: 'It did not go through. Try again in a moment.',
  } as Record<string, string>,
  /** Q26: an owned agency account's billing and Cancel, naming the account (CC-03 D8). */
  manage: {
    title: 'Your agency accounts',
    unnamed: 'Your agency account',
    state: (state: 'agency_trial' | 'agency' | 'past_due', ends: string | null) =>
      state === 'agency_trial'
        ? `On the Agency trial${ends ? `, which ends ${ends}` : ''}. The card is charged when it ends unless you cancel.`
        : state === 'agency'
          ? 'On Agency.'
          : 'The last payment failed. Update the card from Manage billing to keep Agency.',
    portal: 'Manage billing',
    cancel: (state: 'agency_trial' | 'agency' | 'past_due') =>
      state === 'agency_trial' ? 'Cancel the trial' : 'Cancel',
    confirm: 'Yes, cancel',
    confirmText: (state: 'agency_trial' | 'agency' | 'past_due', ends: string | null) =>
      state === 'agency_trial'
        ? `The trial runs to ${ends ?? 'its end'} and the card is not charged; the account then goes to Free. Nothing you can see is deleted.`
        : state === 'agency'
          ? 'Agency runs to the end of the period paid for; the account then goes to Free. Nothing you can see is deleted.'
          : 'The subscription ends now and the account goes to Free. Nothing you can see is deleted.',
  },
  held: {
    title: 'You already have Agency.',
    text: 'One of your accounts is on Agency now, so there is no trial to start.',
  },
  used: {
    title: 'Your Agency trial was used.',
    text: (on: string) =>
      `The trial is one per person, and yours started ${on}. Agency can still be chosen, from Pricing.`,
  },
  aside: {
    kicker: (interval: Interval) =>
      `Agency · ${usd(priceOf('agency', interval))} a ${period(interval)} after the trial`,
    title: {
      text: `${agency.sites} sites, ${agency.seats} seats, reports under your name`,
      capabilities: ['sites', 'seats', 'client_reports'],
    } as Tagged,
    rows: (): [Tagged, string][] => [
      [
        {
          text: `Client sites, up to ${count(agency.pagesPerCheck)} pages each, checked weekly`,
          capabilities: ['sites', 'weekly_checks'],
        },
        String(agency.sites),
      ],
      [
        {
          text: `Seats · owner, account managers, developers · ${usd(EXTRA_SEAT)} a seat a month beyond`,
          capabilities: ['seats'],
        },
        String(agency.seats),
      ],
      [
        {
          text: 'Reports and client report pages on your domain, your logo',
          capabilities: ['client_report_page'],
        },
        'yes',
      ],
      [{ text: 'Emails to clients from your address', capabilities: ['sender_address'] }, 'yes'],
      [{ text: 'Prospect one-pagers from any audit you run', capabilities: ['one_pagers'] }, 'yes'],
      [
        {
          text: 'Scheduled client reports, weekly or monthly, sent for you',
          capabilities: ['client_reports', 'weekly_checks'],
        },
        'yes',
      ],
      [
        { text: 'Competitors per site', capabilities: ['competitors'] },
        String(agency.competitorsPerSite),
      ],
      [{ text: 'Everything in Pro, on every site', capabilities: ['sites'] }, 'yes'],
    ],
    /** D11: no Branding screen in this step, so day 1 names only what is built. */
    foot: (interval: Interval): Tagged => ({
      text:
        `Day 1: audit your first prospect. Day ${TRIAL_DAYS + 1}: ${usd(priceOf('agency', interval))}, or nothing if you canceled.` +
        (interval === 'month'
          ? ` Annual ${usd(AGENCY_YEARLY)}, ${numberWord(monthsFree())} months free: switch to yearly above.`
          : ''),
      capabilities: ['free_audit', 'agency_trial', 'cancel'],
    }),
  },
} as const;
