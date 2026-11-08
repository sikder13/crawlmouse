/**
 * Alerts' written sentences (Final-Alerts): every number a parameter the view model counts. The lock
 * corrections for the artboard follow.
 */
import type { Change, GradeName } from '@crawlmouse/types/v2';
import type { Addition, CopyChange } from '../copy-registry';
import { railChanges } from './dashboard';
import { listOf } from '../format';
import { count, numberWord, plural } from '../words';

/**
 * The Fired list's pill for a change, by its kind and subject (FACTS l.99 keeps the artboard's
 * labels: owner ruling 4). A pair not named here takes the change's kind, as the Changes log does.
 */
export const ALERT_PILLS: Partial<
  Record<Change['kind'], Partial<Record<Change['subject'], string>>>
> = {
  opened: { crawler_access: 'crawler blocked' },
  changed: { grade: 'grade moved', deploy: 'deploy audited' },
};

/** A grade's short name, beside a move in points: "SEO +5". */
export const GRADE_SHORT: Record<GradeName, string> = {
  technical_seo: 'SEO',
  ai_readability: 'AI',
};

export const ALERTS_COPY = {
  title: 'Alerts',
  perMessage: 'one per site per check that found something',
  headline: (emails: number, since: string, last: string) =>
    `${count(emails)} ${plural(emails, 'email', 'emails')} since ${since}, ${ALERTS_COPY.perMessage} · last ${last}`,
  slackOnly: (since: string, messages: number, last: string) =>
    `No emails since ${since}; ${numberWord(messages)} Slack ${plural(messages, 'message', 'messages')}, last ${last}`,
  nothingSent: 'No alerts sent yet.',
  /** "1 open: Claude-SearchBot blocked": the sent problems whose fix is still open. */
  open: (names: readonly string[]) => `${count(names.length)} open: ${listOf(names)}`,
  blocked: (ua: string) => `${ua} blocked`,
  openFix: (name: string) => `Open the ${name} fix`,
  firedTitle: 'Fired',
  firedSub: (sender: string) =>
    `Everything that was sent, newest first. One email per site per check that found something, from ${sender}.`,
  firedEmpty: 'Nothing has been sent yet. A check that finds a change sends one email.',
  allPages: 'all pages',
  pages: (n: number) => `${count(n)} ${plural(n, 'page', 'pages')}`,
  causeChanged: (where: string, when: string) => `${where} changed ${when}`,
  noGradeChange: 'no change to either grade',
  /** "Fri 06:03 sent two, one for a carrying three rows and one for b". */
  emailsAt: (when: string, parts: readonly string[]) =>
    `${when} sent ${numberWord(parts.length)}, ${listOf(parts)}`,
  emailFor: (host: string, rows: number) =>
    rows > 1 ? `one for ${host} carrying ${numberWord(rows)} rows` : `one for ${host}`,
  slackFor: (what: string) => `The ${what} went to Slack only.`,
  stagingDeploy: 'staging deploy',
  deploy: 'deploy',
  siteAlert: (host: string) => `${host} alert`,
  firedFoot: (clauses: readonly string[], slack: readonly string[]) =>
    [
      ...(clauses.length ? [`${ALERTS_COPY.perMessageCap}: ${clauses.join('; ')}.`] : []),
      ...slack,
      'Checks that found nothing sent nothing.',
    ].join(' '),
  perMessageCap: 'One email per site per check that found something',
  openAction: 'Open',
  channelsTitle: 'Where alerts go',
  email: 'Email',
  slack: 'Slack',
  slackOnPro: 'on Pro',
  slackNotConnected: 'not connected',
  on: 'on',
  off: 'off',
  slackPerSite: 'Slack channel per site',
  slackPerSiteValue: 'set on each site page',
  openSite: 'Open a site',
  slackIsPro: 'Slack is Pro.',
  trialFoot: (days: number) =>
    `When the ${days} days end, email alerts continue on Free for the first site.`,
  freeFoot: 'On Free, email alerts cover the first site.',
  rulesTitle: 'Rules, all sites',
  rulesEmpty: 'No alert rules yet.',
  override: 'Each site can override these on its own page.',
  /** The rules that are off, named by position when it is the last one. */
  quietLast: 'Quiet by default: the last rule is off.',
  quietNamed: (labels: readonly string[]) =>
    `Quiet by default: ${listOf(labels.map((l) => `“${l}”`))} ${plural(labels.length, 'is', 'are')} off.`,
  /** What an off rule would have sent on: the changes no message carried. */
  unsent: (day: string, summary: string) => `On ${day}, ${summary} and nothing was sent.`,
};

/** The tables' names and column headers (the artboard names its tables in `aria-label`). */
export const ALERTS_TABLES = {
  fired: 'Alerts',
  when: 'When',
  site: 'Site',
  what: 'What',
  to: 'Sent to',
  open: 'Open',
  channels: 'Channels',
  channel: 'Channel',
  address: 'Address',
  state: 'State',
  rules: 'Default rules',
  rule: 'Rule',
  on: 'On',
};

// ── Where Alerts differs from its locked HTML ────────────────────────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/alerts.test.tsx).

const ZONE =
  'FACTS D4 and Q4 (owner ruling): dates and times in the account’s zone, America/Indiana/Indianapolis; the locked page wrote them in UTC';

const H4 =
  'Owner ruling 3, a FACTS correction to H4 (“around 06:00”): the fixture’s notifications were sent at 10:03Z, 06:03 in the account’s zone, as CC-26’s Site page shows them';

export const ALERTS_CHANGES: CopyChange[] = [
  ...railChanges('alerts'),
  {
    screen: 'alerts',
    kind: 'facts',
    locked: 'since 25 Oct',
    rendered: 'since 24 Oct',
    source: `${ZONE}: the account began 25 Oct 02:41Z, Sat 24 Oct 22:41 there`,
  },
  {
    screen: 'alerts',
    kind: 'ruling',
    locked: 'last Fri 30 Oct 06:00',
    rendered: 'last Fri 30 Oct 06:03',
    source: H4,
  },
  {
    screen: 'alerts',
    kind: 'fixture',
    locked: '1 open: ClaudeBot blocked',
    rendered: '1 open: Claude-SearchBot blocked',
    source:
      'The fixture’s open fix 0 removes the Claude-SearchBot block (FACTS I6 scores Claude-SearchBot); ClaudeBot, also blocked, has no fix of its own',
  },
  {
    screen: 'alerts',
    kind: 'ruling',
    locked: 'Send a test',
    rendered: '',
    source: 'Owner ruling 6: ARCH-2 §5 has no test-send route; a CC-27b candidate',
  },
  {
    screen: 'alerts',
    kind: 'fixture',
    locked: 'Open the ClaudeBot fix',
    rendered: 'Open the Claude-SearchBot fix',
    source: 'The fixture’s fix 0 is “Remove the Claude-SearchBot block from robots.txt”',
  },
  {
    screen: 'alerts',
    kind: 'ruling',
    locked: 'Fri 30 Oct 06:00',
    rendered: 'Fri 30 Oct 06:03',
    source: H4,
    all: true,
  },
  {
    screen: 'alerts',
    kind: 'fixture',
    locked: 'crawler blocked ClaudeBot, all pages · robots.txt changed Thu 19:40',
    rendered:
      'crawler blocked Claude-SearchBot, all pages · robots.txt changed Thu 19:40 email, #seo Open Fri 30 Oct 06:03 example-outfitter.com crawler blocked ClaudeBot, all pages · robots.txt changed Thu 19:40',
    source:
      'The fixture’s weekly check found two blocks, Claude-SearchBot (scored, change 1) and ClaudeBot (unscored, change 2), each notified: one row each (D4)',
  },
  {
    screen: 'alerts',
    kind: 'facts',
    locked: 'AI visibility',
    rendered: 'AI readability',
    source: 'FACTS A1',
  },
  {
    screen: 'alerts',
    kind: 'fixture',
    locked: 'SEO +3',
    rendered: 'SEO +5',
    source: 'The fixture’s nahltech.com change moves Technical SEO from 79 to 84',
  },
  {
    screen: 'alerts',
    kind: 'fixture',
    locked: 'Tue 27 Oct 14:12',
    rendered: 'Tue 27 Oct 14:13',
    source: 'The fixture’s staging notification was sent at 18:13:20Z, 14:13 in the account’s zone',
  },
  {
    screen: 'alerts',
    kind: 'fixture',
    locked: 'Slack only',
    rendered: '#seo',
    source: 'The fixture’s staging notification names its Slack channel, #seo',
  },
  {
    screen: 'alerts',
    kind: 'ruling',
    locked: 'Fri 06:00 sent two, one for example-outfitter.com carrying two rows',
    rendered: 'Fri 06:03 sent two, one for example-outfitter.com carrying three rows',
    source: `${H4}; the example-outfitter.com message carries changes 1, 2 and 3`,
  },
  {
    screen: 'alerts',
    kind: 'fixture',
    locked: 'Nahl workspace · #seo',
    rendered: 'Nahl · #seo',
    source: 'The fixture’s Slack integration is labelled “Nahl · #seo”',
  },
  {
    screen: 'alerts',
    kind: 'fixture',
    locked: 'the last rule is off because 17 content changes a week is noise for most people.',
    rendered: 'the last rule is off. On Fri, 17 pages changed content and nothing was sent.',
    source:
      'The fixture holds one content change, 17 pages at Friday’s check (change 4), not notified; it records no weekly rate',
  },
];

export const ALERTS_ADDITIONS: Addition[] = [];
