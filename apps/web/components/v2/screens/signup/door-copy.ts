/**
 * The account door's sentences that state a number, a plan limit or a list, built from the code
 * that owns each fact: GATES (lib/entitlement-v2.ts), TRIAL_DAYS, the prices and the door's
 * constants. A component renders these; none of them types a number. The plan table and its
 * footer, which follow the Goal 1 switch and Agency's sale, are in plan-table.ts: this module is
 * imported by client components, and that one by the server-rendered Sign-up screen alone.
 */
import { GATES, type Tier } from '@/lib/entitlement-v2';
import { TRIAL_DAYS } from '@/lib/billing/state-machine';
import {
  EMAIL_KINDS,
  FIRST_AUDIT_MINUTES,
  TRIAL_REMINDER_DAYS_BEFORE_END,
  type EmailKind,
} from '@/lib/auth/constants';
import { numberWord } from '@/lib/v2/words';

export const cap = (s: string) => s.replace(/^[a-z]/, (c) => c.toUpperCase());

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

/** D6: the first audit is promised only when checks are public (V2_CHECKS_PUBLIC). */
export function siteHelper(checksPublic: boolean): string {
  return checksPublic
    ? `If you name one, its first audit starts the moment you open the sign-in link, about ${numberWord(FIRST_AUDIT_MINUTES)} minutes, if the account has room for another site.`
    : 'If you name one, it is added to your account when you open the sign-in link, if the account has room for another site.';
}

const KIND_PHRASE: Record<EmailKind, string> = {
  sign_in_link: 'a sign-in link now',
  change_note: 'a note when a re-check finds a change',
  trial_reminder: `one reminder ${numberWord(TRIAL_REMINDER_DAYS_BEFORE_END)} days before the ${trialDays} end`,
};

/** "a, b, and c": a serial comma before the last item. */
function list(items: readonly string[]): string {
  return items
    .map((item, i) => (i === 0 ? item : i === items.length - 1 ? `, and ${item}` : `, ${item}`))
    .join('');
}

export function emailKindsSentence(): string {
  return `${cap(numberWord(EMAIL_KINDS.length))} kinds of email, and no others: ${list(EMAIL_KINDS.map((k) => KIND_PHRASE[k]))}. If you pay, Stripe sends the receipts.`;
}
