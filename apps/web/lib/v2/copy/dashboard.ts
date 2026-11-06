/**
 * The dashboard's written sentences: the parts no record holds. Every number and date in them is a
 * parameter, so the view model fills it from the data (OPERATING-RULES §10). The lock corrections
 * for the two dashboard artboards follow, as for the segment pages.
 */
import { capitalise, numberWord, plural } from '../words';
import { TRIAL_DAYS } from './account';

/** The one address change notes come from (FACTS: "alerts from alerts@crawlmouse.com"). */
export const ALERTS_FROM = 'alerts@crawlmouse.com';

/** How long a re-check takes, as every screen that offers one says it. */
export const RECHECK_MINUTES = 2;

export const DASHBOARD_COPY = {
  kept: (host: string) => `${host} is kept.`,
  since: (weekday: string) => `Since ${weekday}’s check`,
  firstRunNote: 'Changes appear here after the first weekly check. Nothing to compare yet.',
  topFixesTitle: 'Start with the fix that pays most, estimated',
  topFixesFoot: (rest: number, open: string) =>
    `Each fix page has “Mark done and re-check now”, about ${RECHECK_MINUTES} minutes. The other ${rest} ${plural(rest, 'is', 'are')} ${open}.`,
  setupTrialTitle: 'Worth doing while Pro is on',
  setupLeftTitle: (n: number) =>
    n === 0
      ? 'Everything is set up'
      : `${capitalise(numberWord(n))} ${plural(n, 'thing', 'things')} left to set up`,
  setupTrialFoot: (n: number) =>
    `All ${numberWord(n)} stop when the ${TRIAL_DAYS} days end unless you keep Pro. The site, its audits and its monthly check do not.`,
  threeKinds: (reminder: string | null) =>
    `a sign-in link when you ask for one, a note from ${ALERTS_FROM} when a check finds a change${
      reminder ? `, and one reminder on ${reminder}, three days before the trial ends` : ''
    }. If you keep Pro, Stripe sends the receipts.`,
  threeKindsLead: (n: number) => `You will hear from us ${numberWord(n)} ways and no others:`,
  startProTitle: (days: number) => `Start ${days} days of Pro`,
  startProBody: (days: number, competitors: number, sites: number) =>
    `Weekly checks, every fix with its packet, Slack alerts and ${numberWord(competitors)} ${plural(competitors, 'competitor', 'competitors')} per site, on up to ${sites} sites, for ${days} days. No card. When it ends, this account goes back to Free; nothing you can see is deleted.`,
  sitesFirstRun: (free: string) => `Checked weekly for ${TRIAL_DAYS} days, then ${free} on Free`,
};

/** The Pro set-up items (FACTS l.57), each as an offer and as done. */
export const SETUP_COPY = {
  slack: { todo: 'Alerts to Slack, as well as email', done: 'Alerts to email and Slack' },
  competitor: {
    todo: (n: number) =>
      `Name ${numberWord(n)} ${plural(n, 'competitor', 'competitors')} to audit the same way`,
    done: (n: number) =>
      `${capitalise(numberWord(n))} ${plural(n, 'competitor', 'competitors')} added`,
  },
  searchConsole: {
    todo: 'Connect Search Console to lay Google’s impressions and clicks by page over the audit, and its AI-feature breakdown when its API exposes it',
    done: 'Search Console connected',
  },
  staging: {
    todo: 'Add a staging URL so audits run before each deploy',
    done: 'Staging audited on each deploy',
  },
  observed: {
    todo: 'Connect Cloudflare Analytics or a Vercel Drain to see what the AI crawlers actually fetched',
    done: 'Observed crawler activity connected',
  },
  schedule: (when: string) => `Choose the day and hour the weekly check runs (now ${when})`,
};
