/**
 * Pricing's written sentences (Final-Pricing, with FACTS-proposed Part 2's revisions A2, A3, A6, A8,
 * A9, B2, D5, K9, K10 and L6). Every price comes from `prices.ts`, every limit from `GATES`, the
 * trial's length from `TRIAL_DAYS`; the Agency Plus row's figures are the one set declared here
 * (owner ruling Q7), because nothing is built behind that row.
 */
import { TRIAL_REMINDER_DAYS_BEFORE_END, EMAIL_KINDS } from '../../auth/constants';
import type { Interval } from '../../billing/catalog';
import {
  AGENCY_MONTHLY,
  AGENCY_YEARLY,
  EXTRA_SEAT,
  EXTRA_SEAT_YEARLY,
  EXTRA_SITE,
  EXTRA_SITE_YEARLY,
  PRO_MONTHLY,
  PRO_YEARLY,
  usd,
} from '../../billing/prices';
import { TRIAL_DAYS } from '../../billing/state-machine';
import { GATES, type Tier } from '../../entitlement-v2';
import { CANCEL_CLICKS, EVIDENCE_CONDENSED_AFTER_DAYS } from './settings';
import { capitalise, count, numberWord, plural } from '../words';

/** FACTS A3: the Agency Plus anchor row. A contact form only; nothing is built behind it. */
export const AGENCY_PLUS = Object.freeze({ sites: 100, seats: 15, fromMonthly: 249 });

/** FACTS L6: an annual subscriber is emailed this many days before the renewal. */
export const ANNUAL_RENEWAL_REMINDER_DAYS = [45, 20] as const;

/** Free costs nothing on either interval. */
export const FREE_PRICE = 0;

/** A plan's price on an interval, in whole dollars. */
export function priceOf(tier: Tier, interval: Interval): number {
  if (tier === 'free') return FREE_PRICE;
  if (tier === 'pro') return interval === 'month' ? PRO_MONTHLY : PRO_YEARLY;
  return interval === 'month' ? AGENCY_MONTHLY : AGENCY_YEARLY;
}

/** "a month" or "a year". */
export const per = (interval: Interval) => (interval === 'month' ? 'a month' : 'a year');

/** The months a year's price saves against twelve monthly prices, read from the prices. */
export function monthsFree(): number {
  const pro = 12 - PRO_YEARLY / PRO_MONTHLY;
  const agency = 12 - AGENCY_YEARLY / AGENCY_MONTHLY;
  if (pro !== agency || !Number.isInteger(pro)) {
    throw new Error('the annual sentence assumes both plans save the same whole number of months');
  }
  return pro;
}

const trialDays = `${TRIAL_DAYS} days`;

/** How many fixes Free shows: a number on Free, or the page's sentences would not hold. */
function freeFixes(): number {
  const n = GATES.free.fixesVisible;
  if (n === 'all') throw new Error('the pricing copy assumes Free shows a number of fixes');
  return n;
}
const pages = (tier: Tier) => `${count(GATES[tier].pagesPerCheck)} pages`;

export interface PlanRow {
  /** The short left-hand label: "5 sites", "weekly". */
  label: string;
  text: string;
}

export interface PlanCopy {
  name: string;
  tag: string;
  description: string;
  rows: PlanRow[];
}

function seatAndSitePrices(interval: Interval): string {
  const a = GATES.agency;
  const seat = interval === 'month' ? EXTRA_SEAT : EXTRA_SEAT_YEARLY;
  const site = interval === 'month' ? EXTRA_SITE : EXTRA_SITE_YEARLY;
  return (
    `${a.seats} seats, ${usd(seat)} a seat ${per(interval)} beyond; ` +
    `${usd(site)} ${per(interval)} for each site from ${a.sites + 1} to ${a.maxSites}; ` +
    `up to ${pages('agency')} per audit`
  );
}

const renders = (tier: Tier): PlanRow => ({
  label: `${count(GATES[tier].fullRendersPerMonth)} renders`,
  text: 'Full JavaScript renders a month',
});

/** The three plan columns (A2: Pro has two seats; K9: renders; K10: the seat and site prices). */
export function planCopy(interval: Interval): Record<Tier, PlanCopy> {
  const { free, pro, agency } = GATES;
  return {
    free: {
      name: 'Free',
      tag: 'no card, ever',
      description: 'One site you care about, re-checked monthly.',
      rows: [
        {
          label: `${free.sites} ${plural(free.sites, 'site', 'sites')}`,
          text: `Up to ${pages('free')} per audit`,
        },
        { label: 'monthly', text: 'Re-checked monthly; an email only if something changed' },
        {
          label: `${free.fixesVisible} fixes`,
          text: `The ${numberWord(freeFixes())} largest fixes per audit, with copy-paste packets`,
        },
        { label: 'kept', text: 'Every audit, its evidence and link map, kept' },
      ],
    },
    pro: {
      name: 'Pro',
      tag: `free for ${trialDays}, no card`,
      description: `Freelancers and in-house developers watching up to ${pro.sites} sites. ${capitalise(numberWord(pro.seats))} ${plural(pro.seats, 'seat', 'seats')}.`,
      rows: [
        { label: `${pro.sites} sites`, text: `Up to ${pages('pro')} per audit` },
        { label: 'weekly', text: 'Re-checked weekly; alerts by email and Slack' },
        {
          label: 'all fixes',
          text: 'Every fix the audit finds, with packets for your coding tool',
        },
        {
          label: `${pro.competitorsPerSite} ${plural(pro.competitorsPerSite, 'competitor', 'competitors')}`,
          text: 'Per site, audited the same way',
        },
        { label: 'export', text: 'PDF, CSV and JSON' },
        { label: 'staging', text: 'Audit preview and staging URLs before you deploy' },
        renders('pro'),
      ],
    },
    agency: {
      name: 'Agency',
      tag: `${TRIAL_DAYS}-day trial, card required`,
      description: 'Agencies reporting to clients under their own name.',
      rows: [
        { label: `${agency.sites} sites`, text: seatAndSitePrices(interval) },
        {
          label: 'your brand',
          text: 'Reports on your domain with your logo; emails from your address',
        },
        { label: 'one-pagers', text: 'Client prospect one-pagers from any public audit' },
        { label: `${agency.competitorsPerSite} competitors`, text: 'Per site' },
        { label: 'scheduled', text: 'Weekly or monthly client reports, sent for you' },
        renders('agency'),
        { label: 'everything', text: 'All of Pro, on every site' },
      ],
    },
  };
}

export const PRICING_COPY = {
  /** The page's meta description. */
  description: () =>
    `Every audit is free and complete. Pro is ${usd(PRO_MONTHLY)} a month for every fix and weekly checks on up to ${GATES.pro.sites} sites; Agency is ${usd(AGENCY_MONTHLY)} a month for ${GATES.agency.sites} client sites reported under your name.`,
  title: 'Every audit is free. Pay when you want it watched.',
  lead: () =>
    `The first audit of any site is free and complete: every crawler, every page up to ${count(GATES.free.pagesPerCheck)}, the ${numberWord(freeFixes())} fixes with the largest effect. Pro and Agency add what one audit cannot do: checking again, telling you what changed, and every fix the audit finds.`,
  intervalLabel: 'Billing',
  intervals: { month: 'Monthly', year: 'Yearly' } as Record<Interval, string>,
  /** FACTS B2 (the crawlers, rewritten to I6) and L6 (the annual reminders). */
  crawlers:
    'Every plan tests the same AI crawlers on a sample of your pages: OAI-SearchBot, ChatGPT-User, PerplexityBot and Claude-SearchBot count towards your grade; GPTBot and ClaudeBot are shown, and blocking them is your choice. Googlebot and Bingbot are shown by robots.txt. Pro also lists the crawlers it has seen on your site (observed activity).',
  annual: () => {
    const [first, second] = ANNUAL_RENEWAL_REMINDER_DAYS;
    return `Annual: Pro ${usd(PRO_YEARLY)}, Agency ${usd(AGENCY_YEARLY)} — ${numberWord(monthsFree())} months free, from Settings. We email you ${first} and ${second} days before an annual renewal.`;
  },
  buttons: {
    free: { label: 'Create a free account', note: `Includes ${trialDays} of Pro` },
    proTrial: {
      label: `Start with ${trialDays} of Pro`,
      note: (interval: Interval) =>
        `Same account; ${usd(priceOf('pro', interval))} ${per(interval)} only if you keep Pro`,
    },
    proBuy: {
      label: 'Choose Pro',
      note: (interval: Interval) =>
        `${usd(priceOf('pro', interval))} ${per(interval)}; the card is taken by Stripe`,
    },
    agencyTrial: {
      label: `Start a ${TRIAL_DAYS}-day trial`,
      note: `Card required; nothing charged for ${trialDays}`,
    },
    agencyBuy: {
      label: 'Choose Agency',
      note: (interval: Interval) =>
        `${usd(priceOf('agency', interval))} ${per(interval)}; your agency has used its trial`,
    },
    current: { label: 'Your plan', note: 'The plan your account is on now' },
    included: { label: 'Included in your plan', note: 'Agency includes all of Pro' },
    freeBelow: { label: 'Your account returns to Free', note: 'If you cancel, from Settings' },
    notOwner: { note: 'Only the account owner changes its plan' },
  },
  agencyPlus: {
    name: 'Agency Plus',
    limits: () => `${AGENCY_PLUS.sites} sites, ${AGENCY_PLUS.seats} seats`,
    price: () => `from ${usd(AGENCY_PLUS.fromMonthly)} a month`,
    link: 'Talk to us',
    formTitle: 'Tell us about your agency',
    email: 'Work email',
    sites: 'How many client sites',
    note: 'Anything we should know',
    noteHint: 'optional',
    submit: 'Send',
    sent: 'Sent. We reply from support@crawlmouse.com.',
    errors: {
      invalid: 'Check the address and the number of sites, then send it again.',
      rate_limited:
        'That is the most this connection can send today. Email support@crawlmouse.com instead.',
      captcha_failed: 'The check that you are a person did not pass. Send it again.',
      failed: 'It did not send. Try again, or email support@crawlmouse.com.',
    } as Record<string, string>,
  },
  after: {
    title: `What happens when the ${trialDays} end`,
    /** FACTS A6 (long form) and A8. */
    lead: () =>
      `Nothing you can see is deleted. Evidence older than ${EVIDENCE_CONDENSED_AFTER_DAYS} days is condensed to headers and the parts of pages that changed. We email you ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before.`,
    columns: ['What', 'What happens'] as const,
    rows: (interval: Interval): [string, string][] => [
      [
        'Your first site',
        `Keeps monthly checks, ${numberWord(freeFixes())} fixes per audit, and its full history on Free`,
      ],
      ['Other sites', 'Pause until you choose Pro or remove them; their history stays'],
      [
        `Fixes beyond the first ${numberWord(freeFixes())}`,
        'Stay listed with their estimated effect; the packets reopen with Pro',
      ],
      [
        'Agency trial',
        `Card on file is charged ${usd(priceOf('agency', interval))} on day ${TRIAL_DAYS + 1} unless you cancel; from Settings, any day, ${numberWord(CANCEL_CLICKS)} clicks, no call`,
      ],
    ],
  },
  why: {
    title: 'Why the first audit is free and complete',
    text: `A sample that hides the verdict is a sales pitch, not an audit. You see what each crawler got back and the ${numberWord(freeFixes())} fixes that matter most, without an account. If the audit is useful, you will want it kept and checked again; that is what you pay for.`,
  },
  faq: {
    title: 'Questions people ask before paying',
    items: (): { q: string; a: string }[] => [
      {
        q: 'Do I need a card for Pro?',
        a: `No. The ${trialDays} start with your email. Agency needs a card because it sends email from your domain.`,
      },
      {
        q: 'Which emails will I get?',
        a: `${capitalise(numberWord(EMAIL_KINDS.length))} kinds and no others: a sign-in link, a note when a check finds a change, and one reminder ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before the ${trialDays} end. If you pay, Stripe sends the receipts.`,
      },
      {
        q: 'Can I cancel?',
        a: 'Any day, from Settings, with no call. The account goes back to Free; nothing you can see is deleted.',
      },
    ],
  },
} as const;
