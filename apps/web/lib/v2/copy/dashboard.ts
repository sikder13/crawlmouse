/**
 * The dashboard's written sentences: the parts no record holds. Every number and date in them is a
 * parameter, so the view model fills it from the data (OPERATING-RULES §10). The lock corrections
 * for the two dashboard artboards follow, as for the segment pages.
 */
import { capitalise, numberWord, plural } from '../words';
import type { Addition, CopyChange, LockedScreen } from '../copy-registry';
import { RECHECK_MINUTES } from '../recheck';
import { ALERTS_SENDER } from '../../auth/constants';
import { TRIAL_DAYS } from './account';
import { formatPlanPrice } from './plan-price';

/**
 * What a plan's offer lists, each part only where it is offered (D-16, M5): "Weekly checks, every
 * fix with its packet, Slack alerts and one competitor per site", or "Weekly checks and every fix with
 * its packet" with neither Slack nor competitors offered.
 */
const planParts = (checks: string, slack: boolean, competitors: number) => {
  const parts = [
    checks,
    'every fix with its packet',
    slack ? 'Slack alerts' : null,
    competitors > 0
      ? `${numberWord(competitors)} ${plural(competitors, 'competitor', 'competitors')} per site`
      : null,
  ].filter((p): p is string => p !== null);
  return `${parts.filter((_, i) => i < parts.length - 1).join(', ')} and ${parts.at(-1)}`;
};

export const DASHBOARD_COPY = {
  /** The heading: the site, or with several, the account's count of them (F-118). */
  kept: (hosts: readonly string[]) =>
    hosts.length === 1
      ? `${hosts[0]} is kept.`
      : `${capitalise(numberWord(hosts.length))} sites are kept.`,
  /** The heading when every site the account keeps is paused (F-235). */
  allPaused: 'Every site is paused.',
  /** The sites note with some paused, within the plan's limit: a paused site still holds its slot. */
  sitesWithPaused: (slots: number, limit: number, plan: string, paused: number) =>
    `${slots} of ${limit} on ${plan} · ${paused} paused`,
  /** Beside the sites note: the staging copies the table lists, which hold no slot (F-097, Q10). */
  stagingApart: (n: number) =>
    n === 1 ? '1 staging copy holds no slot' : `${n} staging copies hold no slot`,
  /** The health tile's label when no site carries both grades: what its figure is instead (D-10). */
  healthSeoOnly: (n: number) =>
    `Technical SEO, mean of ${n} ${plural(n, 'site', 'sites')} · no site has both grades`,
  /** The card of AI crawlers blocked on sites the crawler panels do not read (D-09). */
  blockedElsewhereTitle: (panels: boolean) =>
    panels ? 'AI crawlers blocked on your other sites' : 'AI crawlers blocked on your sites',
  /** The sites note over the plan's limit, as after a trial ends: how many are checked (F-235). */
  sitesOverLimit: (checked: number, slots: number, plan: string, limit: number) =>
    `${checked} of ${slots} sites checked · ${plan} checks ${limit} ${plural(limit, 'site', 'sites')}`,
  /** The first-run note with every site paused: no check is scheduled to compare against (F-234). */
  firstRunAllPaused: 'Every site is paused, so none is scheduled. Nothing to compare yet.',
  /** "Since Thursday's check", or, where a weekday would be ambiguous, "Since the check of Fri 23 Oct". */
  since: (name: { weekday: string } | { date: string }) =>
    'weekday' in name ? `Since ${name.weekday}'s check` : `Since the check of ${name.date}`,
  /** The first-run note, by when the site is next checked (its schedule, not a promise). */
  firstRunNote: (cadence: 'weekly' | 'monthly' | 'on_deploy' | null) =>
    `Changes appear here ${
      cadence === 'weekly' || cadence === 'monthly'
        ? `after the first ${cadence} check`
        : cadence === 'on_deploy'
          ? 'after the next deploy is audited'
          : 'once the site is checked again'
    }. Nothing to compare yet.`,
  topFixesTitle: 'Start with the fix that pays most, estimated',
  topFixesFoot: (rest: number, open: string) =>
    `Each fix page has "Mark done and re-check now", about ${RECHECK_MINUTES} ${plural(RECHECK_MINUTES, 'minute', 'minutes')}.${rest === 0 ? '' : ` The other ${rest} ${plural(rest, 'is', 'are')} ${open}.`}`,
  setupTrialTitle: 'Worth doing while Pro is on',
  /** The set-up card with no item listed, only the schedule line (M1): it claims nothing done. */
  setupScheduleTitle: 'Weekly check schedule',
  /** The tile's line when it shows the Technical SEO mean: what is withheld, and on how many. */
  withheldOn: (n: number) => `AI readability withheld on ${n} ${plural(n, 'site', 'sites')}`,
  /** Another reason a site is left out, said the same way: "no finished check yet on 1 site". */
  reasonOn: (why: string, n: number) => `${why} on ${n} ${plural(n, 'site', 'sites')}`,
  setupLeftTitle: (n: number) =>
    n === 0
      ? 'Everything is set up'
      : `${capitalise(numberWord(n))} ${plural(n, 'thing', 'things')} left to set up`,
  setupTrialFoot: (n: number, plansOpen = true, sitePaused = false) =>
    `${n === 1 ? 'It stops' : n === 2 ? 'Both stop' : `All ${numberWord(n)} stop`} when the ${TRIAL_DAYS} days end${plansOpen ? ' unless you keep Pro' : ''}. ${
      sitePaused
        ? 'The site and its audits do not.'
        : 'The site, its audits and its monthly check do not.'
    }`,
  /** The kinds of email the account gets, each a clause, read from its preferences. */
  emailKinds: (changeNotes: boolean, reminder: string | null) =>
    [
      'a sign-in link when you ask for one',
      changeNotes ? `a note from ${ALERTS_SENDER} when a check finds a change` : null,
      reminder ? `one reminder on ${reminder}, three days before the trial ends` : null,
    ].filter((k): k is string => k !== null),
  /** "a, b, and c", as the locked page lists them; "a and b" for two. */
  threeKinds: (kinds: readonly string[], plansOpen = true) =>
    `${
      kinds.length > 2
        ? `${kinds.slice(0, -1).join(', ')}, and ${kinds.at(-1)}`
        : kinds.join(' and ')
    }.${plansOpen ? ' If you keep Pro, Stripe sends the receipts.' : ''}`,
  threeKindsLead: (n: number) =>
    `You will hear from us ${numberWord(n)} ${plural(n, 'way', 'ways')} and no others:`,
  startProTitle: (days: number) => `Start ${days} days of Pro`,
  startProHeading: 'Weekly checks and every fix, if you want them',
  /** `competitors` is 0 where competitors are not offered (built and shown, D-16): no clause. */
  startProBody: (days: number, competitors: number, sites: number, slack = true) =>
    `${planParts('Weekly checks', slack, competitors)}, on up to ${sites} sites, for ${days} days. No card. When it ends, this account goes back to Free; nothing you can see is deleted.`,
  sitesFirstRun: (free: string) => `Checked weekly for ${TRIAL_DAYS} days, then ${free} on Free`,
  /** Day 0 with no site yet: the account exists, nothing is watched. */
  noSiteTitle: 'Add the site to watch',
  /** Day 0 for a seat that cannot add a site (a developer, or a manager scoped to some clients). */
  noSiteSeatTitle: 'No site here yet',
  noSiteSeatNote:
    'Sites are added by the account’s owner, or by a manager whose seat covers every client. When a site you can see is added, its first check and its results appear here.',
  noSiteNote:
    'Adding a site starts its first check. Its grades, crawlers and fixes appear here when that check ends.',
  /** What a trial with no site yet includes (F-103), every limit read from the account. */
  noSiteTrial: (
    plan: string,
    until: string,
    schedule: string,
    competitors: number,
    sites: number,
    noCard: boolean,
    slack = true,
  ) =>
    `You have ${plan} until ${until}: ${planParts(`${schedule} checks`, slack, competitors)}, on up to ${sites} sites.${noCard ? ' No card.' : ''}`,
  /** The email-a-developer form's one field, on a live page. */
  developerField: { label: 'Developer’s email', placeholder: 'dev@example.com' },
  /** Copy fix on a live page: what the status line says. */
  copyFix: {
    copying: 'Copying…',
    copied: 'Copied the fix as a prompt.',
    paywall: 'This fix’s packet is on a paid plan.',
    failed: 'The fix could not be fetched. Try again, or open it from the site page.',
    blocked: 'This browser did not allow copying.',
  },
  /** The add-site form's one field, on a live page. */
  siteField: { label: 'Site address', placeholder: 'example.com' },
  /** A signed-in person whose sign-in reaches no account, or several with none chosen. */
  noAccountTitle: 'No account to show',
  noAccountBody:
    'This sign-in is not a member of any account. If you were invited, open the invitation link from its email.',
  /** CC-36 D5: a viewer whose own user id has v1 audits, in the sites card. */
  earlierLine: 'Your earlier audits are still at their links',
  earlierListLabel: 'Earlier audits',
  /** A v1 audit's grade, named as the earlier grade: v1 grades are not v2 grades. */
  earlierGrade: (grade: string | null) =>
    grade === null ? 'not graded' : `earlier grade ${grade}`,
  /**
   * A row's link name. The host alone repeats when a site was audited more than once; with the date
   * and grade it repeats only for two audits of one site on one day with one grade.
   */
  earlierLinkName: (host: string, date: string, grade: string) => `${host}, ${date}, ${grade}`,
  ambiguousTitle: 'More than one account',
  /** `support` is the footer's address (SUPPORT_EMAIL in components/v2/footer-links.ts). */
  ambiguousBody: (support: string) =>
    `This sign-in is a member of more than one account and none is set as the one to open. Ask the owner of the account you want, or write to ${support}.`,
};

/** The Pro set-up items (FACTS l.57), each as an offer and as done. */
/**
 * Each set-up item's `subject` is what its row is about, and its to-do text is written around it.
 * The row's control is named for the subject ("Connect for Search Console"), so the control's name
 * comes from the words the row shows.
 */
const competitorsOf = (n: number) => `${numberWord(n)} ${plural(n, 'competitor', 'competitors')}`;
const SLACK = 'Slack';
const STAGING = 'a staging URL';

export const SETUP_COPY = {
  slack: {
    subject: SLACK,
    todo: `Alerts to ${SLACK}, as well as email`,
    done: 'Slack alerts connected',
  },
  competitor: {
    subject: competitorsOf,
    todo: (n: number) => `Name ${competitorsOf(n)} to audit the same way`,
    done: (n: number) =>
      `${capitalise(numberWord(n))} ${plural(n, 'competitor', 'competitors')} added`,
  },
  staging: {
    subject: STAGING,
    todo: `Add ${STAGING} so audits run after each staging deploy`,
    done: 'Staging audited on each deploy',
  },
  schedule: (host: string, when: string) =>
    `Choose the day and hour ${host} is checked weekly (now ${when})`,
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
    rendered: 'Sat 24 Oct · 1 site · audited today 22:34',
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
    // The locked page hides the effort on a phone; ours shows it there (the phone-only rows below).
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
    // The locked page hides the effort on a phone; ours shows it there (the phone-only rows below).
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
    rendered: 'done Slack alerts connected',
    source:
      'The contract records no date for an integration, so day 0 cannot roll it back: the account has Slack connected, shown done. Done, the Slack row names Slack alone, since Free keeps the email alerts (FACTS l.31). The competitor row is not offered: QA dashboard walk D-16 (F-279): the set-up card offers an item only when its capability is built and shown (CAPABILITIES, the Goal 1 switch) and its control has a page: competitors and staging are "coming"; Search Console and observed crawler visits are not offered (CTO ruling 047, 23 Nov)',
  },
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    locked:
      "Connect Search Console to lay Google's AI-feature impressions over these pages Connect",
    rendered: '',
    source:
      'V2R register, F-279 (QA dashboard walk D-16): the set-up card offers an item only when its capability is built and shown (CAPABILITIES, the Goal 1 switch) and its control has a page: competitors and staging are "coming"; Search Console and observed crawler visits are not offered (CTO ruling 047, 23 Nov)',
  },
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    locked: 'before each deploy Add All four stop',
    rendered: 'before each deploy It stops',
    source:
      'V2R register, F-279 (QA dashboard walk D-16) and FACTS l.57: the foot counts the items the card offers, here the one Slack row, so "It stops"; the count is the items’',
  },
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    locked: 'Add a staging URL so audits run before each deploy',
    rendered: '',
    source:
      'V2R register, F-279 (QA dashboard walk D-16): the set-up card offers an item only when its capability is built and shown (CAPABILITIES, the Goal 1 switch) and its control has a page: competitors and staging are "coming"; Search Console and observed crawler visits are not offered (CTO ruling 047, 23 Nov)',
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
  // ── On a phone: the effort, which the locked page hides there (applied after the rows above) ──
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    onlyOnPhone: true,
    locked: 'through Cloudflare +24 AI',
    rendered: 'through Cloudflare · about 10 minutes +24 AI',
    source:
      'Owner ruling 2026-11-08 (ruling 1): the effort is data, so a phone shows it, where the locked page hides it',
  },
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    onlyOnPhone: true,
    locked: 'Server-render the product template +22 AI',
    rendered: 'Server-render the product template · one template, one deploy +22 AI',
    source:
      'Owner ruling 2026-11-08 (ruling 1): the effort is data, so a phone shows it, where the locked page hides it',
  },
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    onlyOnPhone: true,
    locked: 'from their collections +4 SEO',
    rendered: 'from their collections · about 20 minutes +4 SEO',
    source:
      'Owner ruling 2026-11-08 (ruling 1): the effort is data, so a phone shows it, where the locked page hides it',
  },
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    locked: 'Worth doing while Pro is on',
    rendered: 'Everything is set up',
    source:
      'V2R register, F-269 (QA dashboard walk D-06, review M1): the title claims only what the card lists, and its one listed row, Slack, is connected',
  },
];

const HOME: CopyChange[] = [
  ...railChanges('dashboard'),
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: '5 sites ·',
    rendered: '4 sites ·',
    source:
      'Owner ruling Q10: a staging site holds no primary slot (ARCH-2 §2.5), so the count of sites leaves it out (F-097)',
  },
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
    rendered: 'Opened 2 crawlers blocked Resolved 1 change: orphan pages Other changes 3',
    source:
      'Owner ruling Q5: the strip counts change records in each site’s window: two opened (Claude-SearchBot, ClaudeBot), one resolved (nahltech.com’s orphans), three other (a grade move, a content change, a new baseline), so the headline equals the rows and the sites table. A count other than crawlers blocked names records ("1 change: orphan pages"), not the pages in them',
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
      'Crawler access by check · allowed, thin challenged: the real crawler may pass blocked by robots.txt blocked by a rule OAI-SearchBot ChatGPT-User PerplexityBot Claude-SearchBot GPTBot ClaudeBot Tested with tagged user agents from published IPs — crawlmouse.com/bot.',
    source:
      'FACTS I6 (the six AI crawlers, in the check’s order) and I2 (each verdict in the shared words; a challenge is not "blocked"); the legend lists the verdicts the rows show; D1 puts its line under this crawler table too',
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
    source: `Owner ruling Q10: the Agency line renders only when primary sites equal the limit (4 of 5 here); when it does, its price is AGENCY_MONTHLY, ${formatPlanPrice('agency')} (FACTS D6, the decision of 2026-11-03)`,
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
    kind: 'ruling',
    locked: 'Two things left to set up',
    rendered: 'Everything is set up',
    source:
      'V2R register, F-269 and F-279 (QA dashboard walk D-06, D-16): the title counts the rows the card lists as left, and the card lists none (the one offered item, Slack, is connected)',
  },
  {
    screen: 'dashboard',
    kind: 'facts',
    locked: 'done Alerts to email and Slack',
    rendered: 'done Slack alerts connected',
    source:
      'FACTS l.31: Free keeps "email if changed", so the Pro set-up item is Slack; done, it names Slack alone',
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked:
      "done One competitor added 2 min Connect Search Console to lay Google's AI-feature impressions over these pages Connect 1 min",
    rendered: '',
    source:
      'V2R register, F-279 (QA dashboard walk D-16): the set-up card offers an item only when its capability is built and shown (CAPABILITIES, the Goal 1 switch) and its control has a page: competitors and staging are "coming"; Search Console and observed crawler visits are not offered (CTO ruling 047, 23 Nov); the efforts "2 min" and "1 min" are in no record',
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
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: 'Choose the day and hour the weekly check runs',
    rendered: 'Choose the day and hour example-outfitter.com is checked weekly',
    source:
      'V2R register, F-279 (review M6): the schedule line names the site whose schedule it sets, from the data',
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: 'mean of both grades 74',
    rendered: 'mean of both grades 71',
    source:
      'V2R register, F-097 (A1’s rule; review of PR 1): a staging copy holds no slot, so the health mean is over the four primary sites, 569 / 8 = 71.1; the locked 74 averaged in the staging copy',
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
    what: 'Beside the health move, the sites on a first baseline it leaves out ("1 new"), counted from the records, shown only when one is',
    source: 'Owner ruling 2026-11-08 (ruling 2)',
  },
  {
    screen: 'dashboard',
    what: 'The one-time "Start 14 days of Pro" card, for a Free account that never had a trial',
    source: 'CC-26 brief, D7; DECISION-LOG H5',
  },
  {
    screen: 'dashboard',
    what: 'Day 0 with no site: the header asks for the site, the sites card says a first check starts when one is added',
    source: 'CC-26b brief, D8',
  },
  {
    screen: 'dashboard',
    what: 'Day 0 with no site, for a seat that cannot add one: who adds sites, with no add control',
    source: 'CC-26b review round 2 (pages, minor 1)',
  },
  {
    screen: 'dashboard',
    what: 'On a live page, the add-site form’s address field',
    source: 'CC-26b plan revision R13',
  },
  {
    screen: 'dashboard',
    what: 'A sign-in with no account, or several with none chosen: a plain page that says so',
    source: 'CC-26b plan revision R22',
  },
  {
    screen: 'dashboard',
    what: 'On a live page, Email to my developer’s address field, and Copy fix copying the packet as a prompt with a status line',
    source: 'CC-26b follow-up (live fix actions)',
  },
  {
    screen: 'dashboard',
    what: 'Beside the sites note, the rows the table lists that hold no slot ("1 staging copy holds no slot"), counted from the sites, shown only when one is',
    source: 'V2R dashboard fixes (e): five rows beside "4 of 5 on Pro"; F-097 and owner ruling Q10',
  },
  {
    screen: 'dashboard',
    what: 'Under "Crawler access now", the site the two crawler panels read; and a card of the AI crawlers blocked at the latest result of each other site, shown only when one is',
    source:
      'QA dashboard walk D-09 (F-272): a block on a site other than the first never reached the dashboard',
  },
  {
    screen: 'dashboard-day0',
    what: 'With no crawler panels (the first run), a card of the AI crawlers blocked at each site’s latest result, above the sites table, shown only when one is: a table the locked page does not have (tests/visual/parity.spec.ts addedOmit)',
    source:
      'QA dashboard walk D-09 (F-272) and review M2 of PR 1: a block on any site reaches the dashboard',
  },
  {
    screen: 'dashboard',
    what: 'When no site carries both grades, the health tile shows the Technical SEO mean under a label that says so ("Technical SEO, mean of 4 sites · no site has both grades")',
    source: 'QA dashboard walk D-10 (F-273): the headline tile read "—"',
  },
  {
    screen: 'dashboard',
    what: 'For a viewer with v1 audits of their own: a line in the sites card that opens each one’s site, date, earlier grade and link',
    source: 'CC-36 brief, D5',
  },
];
