/**
 * The dashboard's written sentences: the parts no record holds. Every number and date in them is a
 * parameter, so the view model fills it from the data (OPERATING-RULES §10). The lock corrections
 * for the two dashboard artboards follow, as for the segment pages.
 */
import { capitalise, numberWord, plural } from '../words';
import type { Addition, CopyChange, LockedScreen } from '../copy-registry';
import { RECHECK_MINUTES } from '../recheck';
import { TRIAL_DAYS } from './account';

/** The one address change notes come from (FACTS: "alerts from alerts@crawlmouse.com"). */
export const ALERTS_FROM = 'alerts@crawlmouse.com';

export const DASHBOARD_COPY = {
  kept: (host: string) => `${host} is kept.`,
  since: (weekday: string) => `Since ${weekday}'s check`,
  firstRunNote: 'Changes appear here after the first weekly check. Nothing to compare yet.',
  topFixesTitle: 'Start with the fix that pays most, estimated',
  topFixesFoot: (rest: number, open: string) =>
    `Each fix page has "Mark done and re-check now", about ${RECHECK_MINUTES} minutes. The other ${rest} ${plural(rest, 'is', 'are')} ${open}.`,
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
    todo: "Connect Search Console to lay Google's impressions and clicks by page over the audit, and its AI-feature breakdown when its API exposes it",
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

// ── Where the dashboards differ from their locked HTML ─────────────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/dashboard.test.tsx). The rail's rows are
// shared with the site page (railChanges).

const ZONE =
  'FACTS D4 and Q4 (owner ruling): dates and times in the account’s zone, America/Indiana/Indianapolis; the locked page wrote them in UTC';

/** The trial card the rail shows after the first run, where the dashboard and the site page share it. */
export function railChanges(screen: LockedScreen): CopyChange[] {
  return [
    {
      screen,
      kind: 'facts',
      locked: 'ends Sun 8 Nov',
      rendered: 'ends Sat 7 Nov',
      source: `${ZONE}: trial_ends_at 8 Nov 02:41Z is Sat 7 Nov 21:41 there`,
    },
    {
      screen,
      kind: 'facts',
      locked: '9 days left',
      rendered: '8 days left',
      source:
        'FACTS D4 and Q4 (owner ruling): calendar days in the account’s zone, Fri 30 Oct to Sat 7 Nov',
    },
    {
      screen,
      kind: 'ruling',
      locked: 'the other four sites pause',
      // In the trial card's note, which the locked page and ours hide on a phone.
      hiddenOnPhone: true,
      rendered: 'the other three sites pause',
      source:
        'Owner ruling Q10: a staging site holds no primary slot (ARCH-2 §2.5), so four primary sites, three besides example-outfitter.com',
    },
    {
      screen,
      kind: 'facts',
      locked: "Nothing is deleted. We'll email you two days before.",
      // In the trial card's note, which the locked page and ours hide on a phone.
      hiddenOnPhone: true,
      rendered: "Nothing you can see is deleted. We'll email you three days before.",
      source: 'FACTS A6 (short form) and A8 (the reminder three days before)',
    },
  ];
}

const DAY0: CopyChange[] = [
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'ends Sun 8 Nov',
    rendered: 'ends Sat 7 Nov',
    source: `${ZONE}: trial_ends_at 8 Nov 02:41Z is Sat 7 Nov 21:41 there`,
    all: true,
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'Nothing is deleted.',
    // In the trial card's note, which the locked page and ours hide on a phone.
    hiddenOnPhone: true,
    rendered: 'Nothing you can see is deleted.',
    source: 'FACTS A6, short form',
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'Sun 25 Oct · 1 site · audited 02:34 UTC',
    rendered: 'Sat 24 Oct · 1 site · audited 22:34',
    source: `${ZONE}. Day 0 is read when the account begins, 25 Oct 02:41Z (Q9, owner ruling), Sat 24 Oct there; the first audit finished 02:34Z, 22:34 there`,
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'next weekly check Fri 30 Oct 06:00',
    rendered: 'next weekly check Fri 30 Oct around 06:00',
    source: 'FACTS H4: scheduled checks spread over a window that starts at the chosen hour',
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'AI visibility',
    rendered: 'AI readability',
    source: 'FACTS A1',
    all: true,
  },
  {
    screen: 'dashboard-day0',
    kind: 'fixture',
    locked: 'first audit · 14 fixes',
    rendered: 'first audit · 13 fixes',
    source:
      'The fixture’s first audit found fixes 1 to 13; fixes 0, 14 and 15 were first seen at Friday’s check, after day 0',
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'weekly, Fri Sun 02:34',
    rendered: 'weekly, Fri Sat 22:34',
    source: `${ZONE}: the first audit finished 25 Oct 02:34Z`,
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'Start with the fix that pays most',
    rendered: 'Start with the fix that pays most, estimated',
    source: 'FACTS A5: "estimated" on the first appearance of an effect on a page',
  },
  {
    screen: 'dashboard-day0',
    kind: 'fixture',
    locked: 'Cloudflare · about 10 min',
    // The locked page hides the effort on a phone, and so does ours.
    hiddenOnPhone: true,
    rendered: 'Cloudflare · about 10 minutes',
    source:
      'The fixture’s effort is 10 minutes, worded as every screen words it (effortText, as on the fix page)',
  },
  {
    screen: 'dashboard-day0',
    kind: 'fixture',
    locked: 'Link the 7 orphan pages',
    rendered: 'Link the 7 orphan pages from their collections',
    source: 'The fixture’s fix 3 is "Link the 7 orphan pages from their collections"',
  },
  {
    screen: 'dashboard-day0',
    kind: 'fixture',
    locked: 'collections · about 20 min',
    rendered: 'collections · about 20 minutes',
    source: 'The fixture’s effort is 20 minutes, worded by effortText, as on the fix page',
    // The locked page hides the effort on a phone, and so does ours.
    hiddenOnPhone: true,
  },
  {
    screen: 'dashboard-day0',
    kind: 'fixture',
    locked: 'The other 11 are open',
    rendered: 'The other 10 are open',
    source: 'The fixture’s 13 fixes at day 0, less the three shown',
  },
  {
    screen: 'dashboard-day0',
    kind: 'fixture',
    locked:
      'Alerts to Slack, as well as email Connect Name one competitor to audit the same way Add',
    rendered: 'done Alerts to email and Slack done One competitor added',
    source:
      'The contract records no date for an integration or a competitor, so day 0 cannot roll them back: the account has Slack connected and summitgear.co named, shown done',
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: "Connect Search Console to lay Google's AI-feature impressions over these pages",
    rendered:
      "Connect Search Console to lay Google's impressions and clicks by page over the audit, and its AI-feature breakdown when its API exposes it",
    source: 'FACTS H6',
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'before each deploy Add All four stop',
    rendered:
      'before each deploy Add Connect Cloudflare Analytics or a Vercel Drain to see what the AI crawlers actually fetched Connect All five stop',
    source:
      'FACTS l.57: observed crawler activity is the fifth Pro set-up item (GATES.observedCrawlerActivity); the count is the items’',
  },
  {
    screen: 'dashboard-day0',
    kind: 'facts',
    locked: 'one reminder on Fri 6 Nov, two days before the trial ends.',
    rendered:
      'one reminder on Wed 4 Nov, three days before the trial ends. If you keep Pro, Stripe sends the receipts.',
    source:
      'FACTS A8 (row 181) and A9; the date is trial_ends_at less three days in the account’s zone (D4, Q4): 5 Nov 02:41Z is Wed 4 Nov there',
  },
];

const HOME: CopyChange[] = [
  ...railChanges('dashboard'),
  {
    screen: 'dashboard',
    kind: 'fixture',
    locked: 'last check today 06:00',
    rendered: 'last check today 06:02',
    source:
      'The fixture’s weekly check finished at 10:02Z, 06:02 in the account’s zone; the locked page gave the scheduled hour',
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked: 'next weekly check Fri 6 Nov 06:00',
    rendered: 'next weekly check Fri 6 Nov around 06:00',
    source: 'FACTS H4',
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked: 'trial ends Sun 8 Nov',
    rendered: 'trial ends Sat 7 Nov',
    source: ZONE,
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: '5 of 5 on Pro',
    rendered: '4 of 5 on Pro',
    source: 'Owner ruling Q10: a staging site holds no primary slot (ARCH-2 §2.5)',
    all: true,
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: 'Run an audit now',
    rendered: 'Run a check now',
    source: 'Owner ruling Q7: the action is named as every other surface names it',
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: 'Opened 1 crawler blocked Resolved 3 orphan pages linked Other changes 17',
    rendered: 'Opened 2 crawlers blocked Resolved 1 orphan pages Other changes 3',
    source:
      'Owner ruling Q5: the strip counts change records in each site’s window: two opened (Claude-SearchBot, ClaudeBot), one resolved (nahltech.com’s orphans), three other (a grade move, a content change, a new baseline), so the headline equals the rows and the sites table',
  },
  {
    screen: 'dashboard',
    kind: 'fixture',
    locked: 'ClaudeBot is now blocked on example-outfitter.com Detected Fri 06:00',
    rendered: 'Claude-SearchBot is now blocked on example-outfitter.com Detected Fri 06:02',
    source:
      'The fixture’s change records: Claude-SearchBot (scored) and ClaudeBot (unscored) opened at Friday’s check, detected 10:02Z, 06:02 in the account’s zone',
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: 'AI visibility D → F',
    rendered: 'this check: AI readability D → F',
    source:
      'Owner ruling Q12 and FACTS A1 (row 98): the grade move is its own change record at the same check, named as that check’s, not as the block’s effect',
  },
  {
    screen: 'dashboard',
    kind: 'fixture',
    // The locked page's three buttons touch, so its text runs them together.
    locked: 'sent to Slack #seo DiffCopy fixEmail to my developer',
    rendered:
      'sent to Slack #seo Diff Copy fix Email to my developer blocked ClaudeBot is now blocked on example-outfitter.com Detected Fri 06:02 · robots.txt changed Thu 19:40 · 214 pages · this check: AI readability D → F · sent to Slack #seo Diff',
    source:
      'The fixture’s second opened change, ClaudeBot, has a row of its own; it carries no fix, so it offers only the diff',
  },
  {
    screen: 'dashboard',
    kind: 'fixture',
    locked: '3 orphan pages now linked Fri 06:00',
    rendered: '3 orphan pages now linked Fri 06:01',
    source: 'The fixture’s change was detected 10:01:30Z, 06:01 in the account’s zone',
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked: '6 checks since 25 Oct',
    rendered: '6 checks since 24 Oct',
    source: `${ZONE}: the first audit finished 25 Oct 02:34Z`,
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked: 'AI visibility',
    rendered: 'AI readability',
    source: 'FACTS A1',
    all: true,
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked:
      'Crawler access by check · ● full ▲ partial ■ blocked GPTBot OAI-SearchBot ClaudeBot PerplexityBot',
    rendered:
      'Crawler access by check · allowed, thin challenged: the real crawler may pass blocked by robots.txt blocked by a rule OAI-SearchBot ChatGPT-User PerplexityBot Claude-SearchBot GPTBot ClaudeBot',
    source:
      'FACTS I6 (the six AI crawlers, in the check’s order) and I2 (each verdict in the shared words; a challenge is not "blocked"); the legend lists the verdicts the rows show',
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked:
      'Googlebot ● full Bingbot ● full OAI-SearchBot ▲ partial GPTBot ■ 403 ClaudeBot ■ robots PerplexityBot ■ challenge',
    rendered:
      'Googlebot allowed by robots Bingbot allowed by robots OAI-SearchBot allowed, thin ChatGPT-User allowed, thin PerplexityBot challenged: the real crawler may pass Claude-SearchBot blocked by robots.txt GPTBot blocked by a rule ClaudeBot blocked by robots.txt Tested with tagged user agents from published IPs — crawlmouse.com/bot.',
    source:
      'FACTS B2 (row 222), I2, I6 (eight crawlers, verdicts not status codes) and D1 (the line under every crawler table)',
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: 'Need more? Agency watches 25, $69 a month',
    rendered: '',
    source:
      'Owner ruling Q10: the Agency line renders only when primary sites equal the limit (4 of 5 here); when it does, its price is AGENCY_MONTHLY, $99 (FACTS D6, the decision of 2026-11-03)',
  },
  {
    screen: 'dashboard',
    kind: 'fixture',
    locked: 'F 22 ■ 1 blocked weekly, Fri Fri 06:00',
    rendered: 'F 22 2 blocked weekly, Fri Fri 06:02',
    source:
      'The fixture’s window for example-outfitter.com: two crawlers newly blocked by robots.txt; the check finished 06:02 in the account’s zone',
  },
  {
    screen: 'dashboard',
    kind: 'fixture',
    locked: 'A 93 ● 3 resolved weekly, Fri Fri 06:00',
    rendered: 'A 93 1 resolved weekly, Fri Fri 06:01',
    source:
      'The fixture’s window for nahltech.com: one resolved change (its three orphans); finished 06:01',
  },
  {
    screen: 'dashboard',
    kind: 'fixture',
    locked: 'B 78 no change weekly, Fri Fri 06:00',
    rendered: 'B 78 1 other change weekly, Fri Fri 06:01',
    source:
      'The fixture’s window for redbirdaviation.com holds one change, a new baseline (grading moved to 2.0.0); finished 06:01',
  },
  {
    screen: 'dashboard',
    kind: 'fixture',
    locked: 'C 66 no change weekly, Fri Fri 06:00',
    rendered: 'C 66 no change weekly, Fri Fri 06:01 · check queued',
    source:
      'The fixture’s drivepei.ca: its weekly check finished 06:01 and a manual check is queued at as_of',
  },
  {
    screen: 'dashboard',
    kind: 'fixture',
    locked: 'B+ 86 A- 88 no change on each deploy Thu 18:22',
    rendered: 'A- 86 A- 88 no change on each deploy Thu 18:23',
    source:
      'The fixture’s staging check: Technical SEO 86 is A- (letters.ts), finished 22:23:10Z, 18:23 in the account’s zone',
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked:
      "One competitor added 2 min Connect Search Console to lay Google's AI-feature impressions over these pages Connect 1 min",
    rendered:
      "One competitor added Connect Search Console to lay Google's impressions and clicks by page over the audit, and its AI-feature breakdown when its API exposes it Connect done Staging audited on each deploy Connect Cloudflare Analytics or a Vercel Drain to see what the AI crawlers actually fetched Connect",
    source:
      'FACTS H6 and l.57: the Pro set-up items from the gates, staging done (a staging site exists) and observed crawler activity not connected; the efforts "2 min" and "1 min" are in no record and are left out',
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked: '(now Fri 06:00)',
    rendered: '(now Fri around 06:00)',
    source: 'FACTS H4 (row 272)',
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked:
      'example-outfitter.com vs summitgear.co Change You summitgear.co Crawlers with full access 2 / 6 6 / 6 Text readable without JavaScript 31% 96% Product schema ● yes ● yes Technical SEO B · 79 B- · 72',
    rendered: '',
    source: 'CC-26 brief, out of scope: competitor data is a later step; this card is not built',
  },
];

export const DASHBOARD_CHANGES: CopyChange[] = [...DAY0, ...HOME];

export const DASHBOARD_ADDITIONS: Addition[] = [
  {
    screen: 'dashboard',
    what: 'Under the health mean, the sites it leaves out and why ("1 site excluded: AI readability withheld"), shown only when one is',
    source: 'CC-26 brief, D5',
  },
  {
    screen: 'dashboard',
    what: 'The one-time "Start 14 days of Pro" card, for a Free account that never had a trial',
    source: 'CC-26 brief, D7; DECISION-LOG H5',
  },
];
