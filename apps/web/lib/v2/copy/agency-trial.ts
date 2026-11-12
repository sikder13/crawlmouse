/**
 * The Agency trial page's sentences (Final-AgencyTrial, with FACTS-proposed Part 2's A6, A8, A9, D5
 * and K10, and J15 as overruled: Checkout is Stripe's hosted page, so the artboard's card fields
 * become the consent checkbox and the first client site, then the redirect). Every price comes from
 * `prices.ts`, every limit from `GATES`, the trial's length from `TRIAL_DAYS`.
 */
import { EMAIL_KINDS, TRIAL_REMINDER_DAYS_BEFORE_END } from '../../auth/constants';
import type { Interval } from '../../billing/catalog';
import { AGENCY_YEARLY, EXTRA_SEAT, usd } from '../../billing/prices';
import { TRIAL_DAYS } from '../../billing/state-machine';
import { GATES } from '../../entitlement-v2';
import { count, numberWord, capitalise } from '../words';
import { monthsFree, priceOf } from './pricing';
import { CANCEL_CLICKS } from './settings';

const agency = GATES.agency;
const period = (interval: Interval) => (interval === 'month' ? 'month' : 'year');

export const AGENCY_TRIAL_COPY = {
  /** The page's title and h1. */
  title: 'Start your Agency trial.',
  lead: (interval: Interval, chargeDate: string) =>
    `${TRIAL_DAYS} days, nothing charged. On day ${TRIAL_DAYS + 1} — ${chargeDate} if you start today — the card is charged ${usd(priceOf('agency', interval))} for the ${period(interval)} unless you cancel from Settings any day before, ${numberWord(CANCEL_CLICKS)} clicks; canceling puts the account on Free; nothing you can see is deleted. We email you ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before, as with every trial.`,
  /** Q16: an agency account with no subscription and no trial used is a Checkout that did not finish. */
  returning:
    'Your last visit to the card page did not finish, so nothing started. Check the details and continue to the card again.',
  signedInAs: 'Signed in as',
  agencyName: 'Agency name',
  agencyNameHint: 'shown on client reports',
  site: 'First client site',
  /** Q5: the site is stored, not audited, before the card is taken. */
  siteHint: 'its first audit runs from the agency workspace',
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
  /** A9: Stripe sends the receipts. */
  fine: `${capitalise(numberWord(EMAIL_KINDS.length))} kinds of email and no others: sign-in links, a note when a check finds a change, and the reminder ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before the trial ends. Stripe sends the receipts.`,
  /** Q15: where the trialist lands until the agency workspace (CC-31) has its switcher. */
  secondAccount:
    'The trial is a second account for the agency, separate from your own. After the card page you return to your own account’s plan; the agency account opens from the agency workspace.',
  notSure: `Not sure yet? Your own account can start ${TRIAL_DAYS} days of Pro with no card, from`,
  pricing: 'Pricing',
  seePlans: 'See the plans',
  errors: {
    invalid: 'Tick the box, and give the agency a name and one client site.',
    invalid_host: 'That is not a site address. Type a domain such as clientsite.com.',
    host_refused:
      'That address is private or reserved, so it cannot be audited. Use the client’s public site.',
    trial_used: 'Your agency trial was used, so it cannot start again.',
    trial_refused: 'This account cannot start a trial now.',
    rate_limited: 'That is too many tries for now. Wait a few minutes and try again.',
    billing_unavailable: 'The card page is not available right now. Try again in a few minutes.',
    failed: 'It did not go through. Try again in a moment.',
  } as Record<string, string>,
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
    title: `${agency.sites} sites, ${agency.seats} seats, reports under your name`,
    rows: (): [string, string][] => [
      [
        `Client sites, up to ${count(agency.pagesPerCheck)} pages each, checked weekly`,
        String(agency.sites),
      ],
      [
        `Seats · owner, account managers, developers · ${usd(EXTRA_SEAT)} a seat a month beyond`,
        String(agency.seats),
      ],
      ['Reports and client report pages on your domain, your logo', 'yes'],
      ['Emails to clients from your address', 'yes'],
      ['Prospect one-pagers from any audit you run', 'yes'],
      ['Scheduled client reports, weekly or monthly, sent for you', 'yes'],
      ['Competitors per site', String(agency.competitorsPerSite)],
      ['Everything in Pro, on every site', 'yes'],
    ],
    foot: (interval: Interval) =>
      `Day 1: audit your first prospect and set your domain and logo under Branding. Day ${TRIAL_DAYS + 1}: ${usd(priceOf('agency', interval))}, or nothing if you canceled. Annual ${usd(AGENCY_YEARLY)}, ${numberWord(monthsFree())} months free, from Settings.`,
  },
} as const;
