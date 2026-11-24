/**
 * The trial reminder (CC-03's `email.requested` `trial_reminder`): once, before a trial ends, in the
 * account's time zone, named by its short name or as "your time" (when.ts). Account mail (Q8): no unsubscribe; the person turns it off in Settings
 * (`accounts.email_trial_reminder`), which the sender honours before claiming.
 */
import { SETTINGS_COPY } from '../../copy/settings';
import { dayDate } from '../../format';
import { afterTrialSentence, type AfterTrial } from '../after-trial';
import { layout } from '../layout';
import { mailUrl } from '../links';
import type { Template } from '../types';
import { linkPara, para, small } from './parts';
import { clockTime } from './when';

export interface TrialReminderInput {
  plan: 'pro' | 'agency';
  variant: 'no_card' | 'card_required';
  /** `accounts.trial_ends_at`, ISO. */
  endsAt: string;
  /** `accounts.timezone`, an IANA name. */
  timezone: string;
  /**
   * With paid plans closed, what the trial's end does to this account's sites: the mail then offers
   * nothing that cannot be done. Absent while plans are open.
   */
  after?: AfterTrial;
}

const PLAN = { pro: 'Pro', agency: 'Agency' } as const;

/** The zone, or UTC when the runtime does not know it (a stored zone the runtime predates). */
function zoneOf(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

export const trialReminder: Template<TrialReminderInput> = ({
  plan,
  variant,
  endsAt,
  timezone,
  after,
}) => {
  const zone = zoneOf(timezone);
  const name = PLAN[plan];
  const day = dayDate(endsAt, zone);
  const subject = `Your Crawlmouse ${name} trial ends ${day}`;
  const lead = `Your ${name} trial ends on ${day} at ${clockTime(endsAt, zone)}.`;
  const closed = variant === 'no_card' ? after : undefined;
  const money = closed
    ? 'No card is on file, so nothing is charged and there is nothing you need to do. The account then moves to Free.'
    : variant === 'no_card'
      ? 'No card is on file, so nothing is charged. Unless you choose a plan, the account goes back to Free then, and nothing you can see is deleted.'
      : `Then the card on file is charged for ${name} unless you cancel in Settings before it ends.`;
  const pageLink = mailUrl('/trial-ended');
  const settings = mailUrl('/settings');
  const off = 'You get this reminder once per trial. Settings can turn it off.';
  const closedLines = closed
    ? [
        afterTrialSentence(closed),
        'Nothing you can see is deleted.',
        SETTINGS_COPY.plansOpenSoon(null),
      ]
    : [];
  // An account with no site has no such page: /trial-ended sends it to Settings.
  const showPage = closed?.kept !== null;
  return {
    subject,
    text: [
      lead,
      money,
      ...closedLines,
      '',
      ...(showPage ? [`What stays and what pauses: ${pageLink}`, ''] : []),
      `${off} ${settings}`,
    ].join('\n'),
    html: layout({
      title: subject,
      body: [
        para(lead),
        para(money),
        ...closedLines.map((line) => para(line)),
        ...(showPage ? [linkPara(pageLink, 'What stays and what pauses')] : []),
        small(off),
        linkPara(settings, 'Settings'),
      ].join(''),
      why: 'Sent because your Crawlmouse account is on a trial.',
    }),
  };
};
