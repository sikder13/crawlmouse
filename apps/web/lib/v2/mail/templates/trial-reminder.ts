/**
 * The trial reminder (CC-03's `email.requested` `trial_reminder`): once, before a trial ends, in the
 * account's time zone. Account mail (Q8): no unsubscribe; the person turns it off in Settings
 * (`accounts.email_trial_reminder`), which the sender honours before claiming.
 */
import { dayDate, hourMinute } from '../../format';
import { layout } from '../layout';
import { mailUrl } from '../links';
import type { Template } from '../types';
import { linkPara, para, small } from './parts';

export interface TrialReminderInput {
  plan: 'pro' | 'agency';
  variant: 'no_card' | 'card_required';
  /** `accounts.trial_ends_at`, ISO. */
  endsAt: string;
  /** `accounts.timezone`, an IANA name. */
  timezone: string;
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
}) => {
  const zone = zoneOf(timezone);
  const name = PLAN[plan];
  const day = dayDate(endsAt, zone);
  const subject = `Your Crawlmouse ${name} trial ends ${day}`;
  const lead = `Your ${name} trial ends on ${day} at ${hourMinute(endsAt, zone)} (${zone}).`;
  const money =
    variant === 'no_card'
      ? 'No card is on file, so nothing is charged. Unless you choose a plan, the account goes back to Free then, and nothing you can see is deleted.'
      : `Then the card on file is charged for ${name} unless you cancel in Settings before it ends.`;
  const pageLink = mailUrl('/trial-ended');
  const settings = mailUrl('/settings');
  const off = 'You get this reminder once per trial. Settings can turn it off.';
  return {
    subject,
    text: [
      lead,
      money,
      '',
      `What stays and what pauses: ${pageLink}`,
      '',
      `${off} ${settings}`,
    ].join('\n'),
    html: layout({
      title: subject,
      body: [
        para(lead),
        para(money),
        linkPara(pageLink, 'What stays and what pauses'),
        small(off),
        linkPara(settings, 'Settings'),
      ].join(''),
      why: 'Sent because your Crawlmouse account is on a trial.',
    }),
  };
};
