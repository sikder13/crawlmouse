/**
 * The account door's sentences that state a number, a plan limit or a list, built from the code
 * that owns each fact: GATES (lib/entitlement-v2.ts), TRIAL_DAYS, the prices and the door's
 * constants. A component renders these; none of them types a number.
 */
import { GATES, type Tier } from '@/lib/entitlement-v2';
import { TRIAL_DAYS } from '@/lib/billing/state-machine';
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '@/lib/billing/prices';
import {
  EMAIL_KINDS,
  FIRST_AUDIT_MINUTES,
  TRIAL_REMINDER_DAYS_BEFORE_END,
  type EmailKind,
} from '@/lib/auth/constants';
import { count, numberWord } from '@/lib/v2/words';

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How often a tier re-checks a site it keeps, as a sentence says it. */
export function cadenceOf(tier: Tier): 'weekly' | 'monthly' {
  return GATES[tier].schedule === 'weekly' ? 'weekly' : 'monthly';
}

export const trialDays = `${TRIAL_DAYS} days`;

export function signupLead(): string {
  return (
    `One email. No password — we send a sign-in link. This creates a free account and starts ` +
    `${trialDays} of Pro; nothing is charged, and nothing you can see is deleted when the ` +
    `${trialDays} end.`
  );
}

/** D6: the first audit is promised only when the pipeline that starts it is on. */
export function siteHelper(pipeline: boolean): string {
  return pipeline
    ? `If you name one, its first audit starts the moment you open the sign-in link, about ${numberWord(FIRST_AUDIT_MINUTES)} minutes.`
    : 'If you name one, it becomes your first site when you open the sign-in link.';
}

const KIND_PHRASE: Record<EmailKind, string> = {
  sign_in_link: 'a sign-in link now',
  change_note: 'a note when a re-check finds a change',
  trial_reminder: `one reminder ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before the ${trialDays} end`,
};

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function emailKindsSentence(): string {
  return `${cap(numberWord(EMAIL_KINDS.length))} kinds of email, and no others: ${list(EMAIL_KINDS.map((k) => KIND_PHRASE[k]))}. If you pay, Stripe sends the receipts.`;
}

export interface PlanGroup {
  heading: string;
  plan: string;
  rows: { what: string; value: string }[];
}

/** The Sign-up card's table: what Free always includes, and what Pro adds for the trial. */
export function planGroups(): PlanGroup[] {
  const free = GATES.free;
  const pro = GATES.pro;
  if (free.fixesVisible === 'all' || pro.fixesVisible !== 'all') {
    throw new Error('the plan table assumes Free shows some fixes and Pro shows all');
  }
  const proChecks = [
    `${cap(cadenceOf('pro'))} checks`,
    pro.slack ? 'alerts to Slack' : null,
    `up to ${pro.sites} sites`,
  ].filter(Boolean);
  const proExtras = [
    `${cap(numberWord(pro.competitorsPerSite))} competitor${pro.competitorsPerSite === 1 ? '' : 's'}`,
    pro.exports ? 'PDF, CSV and JSON export' : null,
    pro.stagingAndDeployHooks ? 'staging audits' : null,
  ].filter(Boolean);
  return [
    {
      heading: 'Always',
      plan: 'Free',
      rows: [
        `${cap(numberWord(free.sites))} site, up to ${count(free.pagesPerCheck)} pages, re-checked ${cadenceOf('free')}`,
        'An email only if a check finds a change',
        `${cap(numberWord(free.fixesVisible))} complete fixes per audit, with packets`,
        'Every audit, its evidence and link map, kept',
      ].map((what) => ({ what, value: 'yes' })),
    },
    {
      heading: `For ${trialDays}`,
      plan: 'Pro',
      rows: ['Every fix with copy-paste packets', proChecks.join(', '), proExtras.join(', ')].map(
        (what) => ({ what, value: trialDays }),
      ),
    },
  ];
}

export function planFootnote(): string {
  return (
    `After ${trialDays} the account is Free. Pro is ${usd(PRO_MONTHLY)} a month only if you choose ` +
    `it. Agencies: ${GATES.agency.sites} sites under your brand, ${usd(AGENCY_MONTHLY)} a month, ` +
    `${TRIAL_DAYS}-day trial with a card.`
  );
}
