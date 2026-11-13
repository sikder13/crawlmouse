/**
 * The founder's instant notices (CC-33 D3), mailed to FOUNDER_NOTIFY_TO (lib/v2/ops/founder.ts):
 * one event (`founderEvent`), or the "N more" notice that reports the events held over the hour's bound
 * (`founderOverflow`). A notice names the event in words, the plan, Stripe's amount, the account as its
 * support-console link, the account's first site's host and the owner's address. It holds no card
 * detail: nothing in its input can carry one. An internal account's notice has a `[TEST] ` subject.
 *
 * The host and the owner's address come from outside our code: each is one bounded line, escaped in
 * the HTML and never a link. The link targets are the console's, built here from a checked account
 * id (founder-event.test.ts reads them with `htmlTargets`).
 */
import { count, plural } from '../../words';
import { html, oneLine } from '../escape';
import { layout } from '../layout';
import { mailUrl } from '../links';
import type { Template } from '../types';
import { hostText, linkPara, para, small } from './parts';

export const FOUNDER_EVENT_KINDS = [
  'signup',
  'trial_started',
  'payment',
  'payment_failed',
  'cancellation',
  'agency_created',
] as const;
export type FounderEventKind = (typeof FOUNDER_EVENT_KINDS)[number];

export interface FounderAmount {
  /** Stripe's figure, in the currency's minor units (cents for USD). */
  minor: number;
  /** Stripe's lower-case ISO 4217 code. */
  currency: string;
}

export interface FounderEventInput {
  kind: FounderEventKind;
  internal: boolean;
  /** Null when the event names no account we could read. */
  accountId: string | null;
  plan: 'pro' | 'agency' | null;
  /** For a payment: whether the account had paid before; `unknown` when its history did not say. */
  payment?: 'first' | 'returning' | 'unknown';
  /** For a payment or a failed one: Stripe's figure, or null when it was not read. */
  amount?: FounderAmount | null;
  /** The account's first site, or null when it has none. */
  host: string | null;
  /** The account owner's address, or null when it was not read. */
  ownerEmail: string | null;
  /** When the event happened, ISO. */
  occurredAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Longest address shown: the bound an address has (RFC 5321's path). */
const EMAIL_MAX = 254;
const TEST_PREFIX = '[TEST] ';
const PLAN_WORDS = { pro: 'Pro', agency: 'Agency' } as const;

/** The support console's page for an account (app/internal/accounts/[id]). */
export function internalAccountUrl(accountId: string): string {
  if (!UUID.test(accountId)) throw new RangeError('not an account id');
  return mailUrl(`/internal/accounts/${accountId}`);
}

/** An event in words. */
export function eventWords(kind: FounderEventKind, payment?: FounderEventInput['payment']): string {
  switch (kind) {
    case 'signup':
      return 'New sign-up';
    case 'trial_started':
      return 'Trial started';
    case 'payment':
      return payment === 'first'
        ? 'First payment'
        : payment === 'returning'
          ? 'Payment (returning)'
          : 'Payment';
    case 'payment_failed':
      return 'Payment failed';
    case 'cancellation':
      return 'Cancellation';
    case 'agency_created':
      return 'Agency account created';
  }
}

/**
 * Stripe's minor units in the currency's own format, or null for a figure that is not a whole number
 * or a code that is not three lower-case letters (Stripe's spelling) or that `Intl` refuses.
 */
export function amountText(amount: FounderAmount): string | null {
  if (!Number.isSafeInteger(amount.minor) || !/^[a-z]{3}$/.test(amount.currency)) return null;
  try {
    const format = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: amount.currency.toUpperCase(),
    });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(amount.minor / 10 ** digits);
  } catch {
    return null;
  }
}

/** The console link for an account id, or null for none or one that is not an id. */
const accountUrl = (id: string | null): string | null =>
  id !== null && UUID.test(id) ? internalAccountUrl(id) : null;

export const founderEvent: Template<FounderEventInput> = (input) => {
  const words = eventWords(input.kind, input.payment);
  const plan = input.plan === null ? null : PLAN_WORDS[input.plan];
  const headline = plan === null ? words : `${words}: ${plan}`;
  const money =
    input.kind === 'payment' || input.kind === 'payment_failed'
      ? `Amount: ${(input.amount && amountText(input.amount)) ?? 'not read from Stripe'}`
      : null;
  const lines = [
    ...(money === null ? [] : [money]),
    `Site: ${input.host === null ? 'none yet' : hostText(input.host)}`,
    `Owner: ${input.ownerEmail === null ? 'not known' : oneLine(input.ownerEmail, EMAIL_MAX)}`,
    `When: ${input.occurredAt}`,
  ];
  const url = accountUrl(input.accountId);
  const test = input.internal
    ? 'This account is marked internal: it is left out of the digests.'
    : null;

  return {
    subject: `${input.internal ? TEST_PREFIX : ''}${headline}`,
    text: [
      headline,
      '',
      ...lines,
      url === null ? 'Account: not known' : `Account: ${url}`,
      ...(test === null ? [] : ['', test]),
    ].join('\n'),
    html: layout({
      title: headline,
      body: [
        ...lines.map(para),
        url === null ? para('Account: not known') : linkPara(url, 'Open the account'),
        ...(test === null ? [] : [small(test)]),
      ].join(''),
      why: 'Sent to the founder address set in FOUNDER_NOTIFY_TO, once for each event.',
    }),
  };
};

export interface FounderOverflowRow {
  kind: FounderEventKind;
  accountId: string | null;
  internal: boolean;
}

export interface FounderOverflowInput {
  /** How many notices were held. */
  total: number;
  /** The held notices listed, oldest first: at most the take's bound. */
  rows: readonly FounderOverflowRow[];
}

const LEAD =
  "More instant notices arrived than the hour's bound, so these were held and are listed here instead of mailed one by one.";

export const founderOverflow: Template<FounderOverflowInput> = ({ total, rows }) => {
  const allTest = rows.length > 0 && rows.length === total && rows.every((r) => r.internal);
  const headline = `${count(total)} more ${plural(total, 'notice', 'notices')} in the last hour`;
  const words = (r: FounderOverflowRow) => `${r.internal ? TEST_PREFIX : ''}${eventWords(r.kind)}`;
  const withheld = total - rows.length;
  const tail =
    withheld > 0
      ? `${count(withheld)} more ${plural(withheld, 'is', 'are')} not listed here; the support console holds each account.`
      : null;

  return {
    subject: `${allTest ? TEST_PREFIX : ''}${headline}`,
    text: [
      LEAD,
      '',
      ...rows.map((r) => `- ${words(r)}: ${accountUrl(r.accountId) ?? 'account not known'}`),
      ...(tail === null ? [] : ['', tail]),
    ].join('\n'),
    html: layout({
      title: headline,
      body: [
        para(LEAD),
        `<ul>${rows
          .map((r) => {
            const url = accountUrl(r.accountId);
            return `<li>${html(words(r))}: ${
              url === null
                ? 'account not known'
                : `<a href="${html(url)}">${html(r.accountId!)}</a>`
            }</li>`;
          })
          .join('')}</ul>`,
        ...(tail === null ? [] : [para(tail)]),
      ].join(''),
      why: 'Sent to the founder address set in FOUNDER_NOTIFY_TO when an hour holds more notices than its bound.',
    }),
  };
};
