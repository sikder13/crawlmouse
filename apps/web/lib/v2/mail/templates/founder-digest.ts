/**
 * The founder digest (CC-33 D3): daily, for the day before in New York, and on Mondays weekly, for the
 * week before with the week before that and the change. Each figure is `founder_digest_counts`'s
 * (migration 20261115000001 section C), labelled as it is computed. The input is numbers and dates
 * of ours; nothing in it comes from outside our code.
 */
import { count } from '../../words';
import { layout } from '../layout';
import type { Template } from '../types';
import { para, small } from './parts';

/** The figures, in the order shown, each with what it counts. */
export const DIGEST_FIGURES = [
  ['signups_confirmed', 'Sign-ups (counted when the address is confirmed)'],
  ['trials_started', 'Trials started'],
  ['trials_ended', 'Trials ended (an account left a trial state)'],
  ['payments_first_or_returning', 'First and returning payments'],
  ['payments_failed', 'Payments failed'],
  ['cancellations', 'Cancellations'],
  ['checks_run_all', 'Checks run (all, incl. anonymous)'],
  ['checks_failed_all', 'Checks failed (all, incl. anonymous)'],
  ['mail_bounce_events', 'Bounces of sign-in and v1 mail (Resend events)'],
  ['mail_suppressions_new', 'Addresses newly suppressed for v2 mail (hard bounces and complaints)'],
  ['mail_send_failures', 'v2 mail sends that failed'],
] as const;

export type DigestFigure = (typeof DIGEST_FIGURES)[number][0];
export type DigestCounts = Readonly<Record<DigestFigure, number>>;

export type FounderDigestInput =
  | { variant: 'daily'; date: string; counts: DigestCounts }
  | { variant: 'weekly'; monday: string; week: DigestCounts; previous: DigestCounts };

const SCOPE =
  'Internal accounts are left out of the sign-up, trial, payment, cancellation, check and send-failure figures; the send failures also leave out these notices’ own mail. The two bounce figures count addresses, not accounts, so they include internal accounts’ mail.';
const WHY =
  'Sent to the founder address set in FOUNDER_NOTIFY_TO once a day, from 08:00 New York time.';

/** A change as a signed count: +3, −2, or 0. */
export const change = (now: number, before: number): string => {
  const d = now - before;
  return d > 0 ? `+${count(d)}` : d < 0 ? `−${count(-d)}` : '0';
};

export const founderDigest: Template<FounderDigestInput> = (input) => {
  if (input.variant === 'daily') {
    const title = `Crawlmouse daily: ${input.date}`;
    const lines = DIGEST_FIGURES.map(([k, label]) => `${label}: ${count(input.counts[k])}`);
    const lead = `${input.date}, New York time.`;
    return {
      subject: title,
      text: [lead, '', ...lines, '', SCOPE].join('\n'),
      html: layout({
        title,
        body: [para(lead), ...lines.map(para), small(SCOPE)].join(''),
        why: WHY,
      }),
    };
  }
  const title = `Crawlmouse weekly: week of ${input.monday}`;
  const lead = `The week from Monday ${input.monday}, New York time, against the week before.`;
  const lines = DIGEST_FIGURES.map(
    ([k, label]) =>
      `${label}: ${count(input.week[k])} (week before ${count(input.previous[k])}, change ${change(input.week[k], input.previous[k])})`,
  );
  return {
    subject: title,
    text: [lead, '', ...lines, '', SCOPE].join('\n'),
    html: layout({
      title,
      body: [para(lead), ...lines.map(para), small(SCOPE)].join(''),
      why: 'Sent to the founder address set in FOUNDER_NOTIFY_TO on Mondays, from 08:00 New York time.',
    }),
  };
};
