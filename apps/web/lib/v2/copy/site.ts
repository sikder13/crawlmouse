/**
 * The site page's written sentences: the parts no record holds, every number a parameter. The lock
 * corrections for Final-Site follow.
 */
import type { AlertRule } from '@crawlmouse/types/v2';
import { RECHECK_MINUTES } from './dashboard';

/** FACTS D1: one line under every crawler table. */
export const TAGGED_UA_LINE =
  'Tested with tagged user agents from published IPs — crawlmouse.com/bot.';

export const SITE_COPY = {
  fixesSub: `Mark one done and it is re-checked in about ${RECHECK_MINUTES} minutes; it closes only when the next crawl agrees.`,
  copyAll: 'Copy all as one prompt',
  removeNote: 'Its history stays in your account in case you add it back',
  searchEngineCause: 'allowed by robots.txt; verified bot, not fetched',
  alertsFoot: (to: string) => `Sent to ${to}, once per check, only when something fires.`,
};

/** Each alert rule as the Site and Alerts screens name it. */
export const ALERT_LABELS: Record<AlertRule['kind'], (threshold: number | null) => string> = {
  crawler_blocked: () => 'A crawler becomes blocked',
  text_drop: (n) => `Text without JavaScript drops more than ${n} points`,
  grade_letter_moved: () => 'A grade moves a full letter',
  new_orphans: () => 'New orphan pages',
  fix_regressed: () => 'A fix you marked done regresses',
  any_change: () => 'Any change at all, including content',
};
