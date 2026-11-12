/**
 * Pricing's written sentences (Final-Pricing, with FACTS-proposed Part 2's revisions A2, A3, A6, A8,
 * A9, B2, D5, K9, K10 and L6). Prices come from `prices.ts`, limits from `GATES`, the trial's length
 * from `TRIAL_DAYS`. Three figures are declared here: the Agency Plus row's (owner ruling Q7: nothing
 * is built behind that row), Free's price, and the annual renewal reminder days (L6).
 * components/v2/screens/pricing/pricing-numbers.test.tsx holds the rendered page to these sources.
 *
 * Every sentence that names a capability carries it (`capabilities`, keys of For agencies'
 * `CAPABILITIES`), and the page marks "coming" each one that is not built (SEO review 1–3, Q27);
 * components/v2/screens/pricing/pricing-capabilities.test.tsx sweeps the rendered page for it.
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
import type { Tagged } from './agencies';
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

export interface PlanRow extends Tagged {
  /** The short left-hand label: "5 sites", "weekly". */
  label: string;
}

export interface PlanCopy {
  name: string;
  tag: string;
  description: Tagged;
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
  capabilities: ['renders'],
});

/**
 * The three plan columns (A2: Pro has two seats; K9: renders; K10: the seat and site prices).
 * `proTrial`: whether the page offers Pro's no-card trial (`pricingView` decides it from Pro's
 * button and the flags); without it, Pro's tag says the card is required (SEO R2-N1).
 */
export function planCopy(interval: Interval, proTrial: boolean): Record<Tier, PlanCopy> {
  const { free, pro, agency } = GATES;
  return {
    free: {
      name: 'Free',
      tag: 'no card, ever',
      description: {
        text: 'One site you care about, re-checked monthly.',
        capabilities: ['sites', 'weekly_checks'],
      },
      rows: [
        {
          label: `${free.sites} ${plural(free.sites, 'site', 'sites')}`,
          text: `Up to ${pages('free')} per audit`,
          capabilities: ['sites'],
        },
        {
          label: 'monthly',
          text: 'Re-checked monthly; an email only if something changed',
          capabilities: ['weekly_checks', 'change_emails'],
        },
        {
          label: `${free.fixesVisible} fixes`,
          text: `The ${numberWord(freeFixes())} largest fixes per audit, with copy-paste packets`,
          capabilities: ['fix_packets'],
        },
        {
          label: 'kept',
          text: 'Every audit, its evidence and link map, kept',
          capabilities: ['free_audit'],
        },
      ],
    },
    pro: {
      name: 'Pro',
      tag: proTrial ? `free for ${trialDays}, no card` : 'card required',
      description: {
        text: `Freelancers and in-house developers watching up to ${pro.sites} sites. ${capitalise(numberWord(pro.seats))} ${plural(pro.seats, 'seat', 'seats')}.`,
        capabilities: ['sites', 'weekly_checks', 'seats'],
      },
      rows: [
        {
          label: `${pro.sites} sites`,
          text: `Up to ${pages('pro')} per audit`,
          capabilities: ['sites'],
        },
        {
          label: 'weekly',
          text: 'Re-checked weekly; alerts by email and Slack',
          capabilities: ['weekly_checks', 'change_emails', 'slack_alerts'],
        },
        {
          label: 'all fixes',
          text: 'Every fix the audit finds, with packets for your coding tool',
          capabilities: ['fix_packets'],
        },
        {
          label: `${pro.competitorsPerSite} ${plural(pro.competitorsPerSite, 'competitor', 'competitors')}`,
          text: 'Per site, audited the same way',
          capabilities: ['competitors'],
        },
        { label: 'export', text: 'PDF, CSV and JSON', capabilities: ['exports'] },
        {
          label: 'staging',
          text: 'Audit preview and staging URLs before you deploy',
          capabilities: ['staging'],
        },
        renders('pro'),
      ],
    },
    agency: {
      name: 'Agency',
      tag: `${TRIAL_DAYS}-day trial, card required`,
      description: {
        text: 'Agencies reporting to clients under their own name.',
        capabilities: ['client_reports'],
      },
      rows: [
        {
          label: `${agency.sites} sites`,
          text: seatAndSitePrices(interval),
          capabilities: ['sites', 'seats'],
        },
        {
          label: 'your brand',
          text: 'Reports on your domain with your logo; emails from your address',
          capabilities: ['client_report_page', 'sender_address'],
        },
        {
          label: 'one-pagers',
          text: 'Client prospect one-pagers from any public audit',
          capabilities: ['one_pagers'],
        },
        {
          label: `${agency.competitorsPerSite} competitors`,
          text: 'Per site',
          capabilities: ['competitors'],
        },
        {
          label: 'scheduled',
          text: 'Weekly or monthly client reports, sent for you',
          capabilities: ['client_reports', 'weekly_checks'],
        },
        renders('agency'),
        { label: 'everything', text: 'All of Pro, on every site', capabilities: ['sites'] },
      ],
    },
  };
}

export const PRICING_COPY = {
  /** The page's meta description. */
  /** The meta description: built capabilities only, since a search result carries no "coming" mark. */
  description: () =>
    `Every audit is free and complete. Pro is ${usd(PRO_MONTHLY)} a month for every fix the audit finds, on up to ${GATES.pro.sites} sites; Agency is ${usd(AGENCY_MONTHLY)} a month for ${GATES.agency.sites} client sites.`,
  /** The artboard's h1 (Q33): "watched" is checking again and telling you, which CC-28 builds. */
  title: {
    text: 'Every audit is free. Pay when you want it watched.',
    capabilities: ['weekly_checks', 'change_emails'],
  } as Tagged,
  lead: (): Tagged[] => [
    {
      text: `The first audit of any site is free and complete: every crawler, every page up to ${count(GATES.free.pagesPerCheck)}, the ${numberWord(freeFixes())} fixes with the largest effect.`,
      capabilities: ['free_audit'],
    },
    {
      text: 'Pro and Agency add what one audit cannot do: checking again, telling you what changed, and every fix the audit finds.',
      capabilities: ['weekly_checks', 'change_emails', 'fix_packets'],
    },
  ],
  intervals: { month: 'Monthly', year: 'Yearly' } as Record<Interval, string>,
  /** FACTS B2 (the crawlers, rewritten to I6) and L6 (the annual reminders). */
  crawlers: (): Tagged[] => [
    {
      text: 'Every plan tests the same AI crawlers on a sample of your pages: OAI-SearchBot, ChatGPT-User, PerplexityBot and Claude-SearchBot count towards your grade; GPTBot and ClaudeBot are shown, and blocking them is your choice. Googlebot and Bingbot are shown by robots.txt.',
      capabilities: ['free_audit'],
    },
    {
      text: 'Pro also lists the crawlers it has seen on your site (observed activity).',
      capabilities: ['observed_crawlers'],
    },
  ],
  annual: (): Tagged[] => {
    const [first, second] = ANNUAL_RENEWAL_REMINDER_DAYS;
    return [
      {
        text: `Annual: Pro ${usd(PRO_YEARLY)}, Agency ${usd(AGENCY_YEARLY)} — ${numberWord(monthsFree())} months free, from Settings.`,
        capabilities: [],
      },
      {
        text: `We email you ${first} and ${second} days before an annual renewal.`,
        capabilities: ['renewal_reminders'],
      },
    ];
  },
  buttons: {
    free: { label: 'Create a free account', note: `Includes ${trialDays} of Pro` },
    /** V2_ACCOUNT_DOOR off: v1's sign-in creates the account, and starts no trial. */
    freeSignIn: { label: 'Create a free account', note: 'One email, no card' },
    proSignIn: {
      label: 'Choose Pro',
      note: (interval: Interval) =>
        `Sign in first; ${usd(priceOf('pro', interval))} ${per(interval)}, the card taken by Stripe`,
    },
    /** V2_ACCOUNT_DOOR off, V2_CHECKS_PUBLIC on: v1's sign-in, then this page offers the trial. */
    proSignInTrial: {
      label: `Start with ${trialDays} of Pro`,
      note: `Sign in first; then ${trialDays} of Pro, no card`,
    },
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
    /** CC-03 answers `subscription_open`: the account's subscription is changed in the portal. */
    portal: {
      label: 'Manage billing',
      note: 'This account still has a subscription; change it from the billing page',
    },
    unavailable: { note: 'This account cannot choose this plan now' },
    agencyUsed: { note: 'Your agency trial was used, on an agency account since deleted' },
    current: { label: 'Your plan', note: 'The plan your account is on now' },
    included: { label: 'Included in your plan', note: 'Agency includes all of Pro' },
    freeBelow: { note: 'If you cancel, from Settings, the account returns to Free' },
    notOwner: { note: 'Only the account owner changes its plan' },
  },
  agencyPlus: {
    name: 'Agency Plus',
    limits: () => `${AGENCY_PLUS.sites} sites, ${AGENCY_PLUS.seats} seats`,
    price: () => `from ${usd(AGENCY_PLUS.fromMonthly)} a month`,
    link: 'Send a request',
    formTitle: 'Tell us about your agency',
    /** Nothing tells anyone of a request until CC-28's mailer (Q27). */
    reply: {
      text: 'We reply from support@crawlmouse.com.',
      capabilities: ['agency_plus_reply'],
    } as Tagged,
    email: 'Work email',
    sites: 'How many client sites',
    note: 'Anything we should know',
    noteHint: 'optional',
    submit: 'Send',
    /** What is true once the route answers: the request is stored. */
    sent: 'Sent. Your request is recorded.',
    errors: {
      invalid: 'Check the address and the number of sites, then send it again.',
      rate_limited:
        'That is the most this connection can send today. Email support@crawlmouse.com instead.',
      captcha_failed: 'The check that you are a person did not pass. Send it again.',
      failed: 'It did not send. Try again, or email support@crawlmouse.com.',
    } as Record<string, string>,
  },
  after: {
    /** Without Pro's trial on offer, the section is the Agency trial's (`proTrial`, SEO R2-N1). */
    title: (proTrial: boolean) =>
      proTrial
        ? `What happens when the ${trialDays} end`
        : `What happens when the Agency trial’s ${trialDays} end`,
    /** FACTS A6 (long form) and A8. */
    lead: (): Tagged[] => [
      { text: 'Nothing you can see is deleted.', capabilities: [] },
      {
        text: `Evidence older than ${EVIDENCE_CONDENSED_AFTER_DAYS} days is condensed to headers and the parts of pages that changed.`,
        capabilities: ['evidence_condensed'],
      },
      {
        text: `We email you ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before.`,
        capabilities: ['trial_reminder'],
      },
    ],
    columns: ['What', 'What happens'] as const,
    rows: (interval: Interval): [string, Tagged][] => [
      [
        'Your first site',
        {
          text: `Keeps monthly checks, ${numberWord(freeFixes())} fixes per audit, and its full history on Free`,
          capabilities: ['weekly_checks', 'fix_packets'],
        },
      ],
      [
        'Other sites',
        {
          text: 'Pause until you choose Pro or remove them; their history stays',
          capabilities: ['sites'],
        },
      ],
      [
        `Fixes beyond the first ${numberWord(freeFixes())}`,
        {
          text: 'Stay listed with their estimated effect; the packets reopen with Pro',
          capabilities: ['fix_packets'],
        },
      ],
      [
        'Agency trial',
        {
          text: `Card on file is charged ${usd(priceOf('agency', interval))} on day ${TRIAL_DAYS + 1} unless you cancel; from the Agency trial page, any day, ${numberWord(CANCEL_CLICKS)} clicks, no call`,
          capabilities: ['agency_trial', 'cancel'],
        },
      ],
    ],
  },
  why: {
    title: 'Why the first audit is free and complete',
    text: (): Tagged[] => [
      {
        text: `A sample that hides the verdict is a sales pitch, not an audit. You see what each crawler got back and the ${numberWord(freeFixes())} fixes that matter most, without an account.`,
        capabilities: ['free_audit'],
      },
      {
        text: 'If the audit is useful, you will want it kept and checked again; that is what you pay for.',
        capabilities: ['weekly_checks'],
      },
    ],
  },
  faq: {
    title: 'Questions people ask before paying',
    /** `proTrial`: whether the page offers Pro's no-card trial (SEO R2-N1). */
    items: (proTrial: boolean): { q: string; a: Tagged }[] => {
      const [first, second] = ANNUAL_RENEWAL_REMINDER_DAYS;
      const agencyCard =
        'Agency’s trial takes a card at the start, and the plan is charged when the trial ends unless you cancel.';
      return [
        {
          q: 'Do I need a card for Pro?',
          a: {
            text: proTrial
              ? `No. The ${trialDays} start with your email. ${agencyCard}`
              : `Yes: Pro starts when Stripe takes the card. ${agencyCard}`,
            capabilities: ['agency_trial', 'cancel'],
          },
        },
        {
          q: 'Which emails will I get?',
          // FACTS: three kinds, with renewal reminders the annual subscriber's exception (L6).
          a: {
            text: `${capitalise(numberWord(EMAIL_KINDS.length))} kinds and no others: a sign-in link, a note when a check finds a change, and one reminder ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before the ${trialDays} end; on an annual plan, also renewal reminders ${first} and ${second} days before it renews. If you pay, Stripe sends the receipts.`,
            capabilities: ['change_emails', 'trial_reminder', 'renewal_reminders'],
          },
        },
        {
          q: 'Can I cancel?',
          a: {
            text: 'Any day, with no call: from Settings, or for an agency account from the Agency trial page. The account goes back to Free; nothing you can see is deleted.',
            capabilities: ['cancel'],
          },
        },
      ];
    },
  },
} as const;
