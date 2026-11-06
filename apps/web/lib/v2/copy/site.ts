/**
 * The site page's written sentences: the parts no record holds, every number a parameter. The lock
 * corrections for Final-Site follow.
 */
import type { AlertRule } from '@crawlmouse/types/v2';
import type { Addition, CopyChange } from '../copy-registry';
import { RECHECK_MINUTES } from '../recheck';
import { railChanges } from './dashboard';

/** FACTS D1: one line under every crawler table. */
export const TAGGED_UA_LINE =
  'Tested with tagged user agents from published IPs — crawlmouse.com/bot.';

export const SITE_COPY = {
  fixesSub: `Mark one done and it is re-checked in about ${RECHECK_MINUTES} minutes; it closes only when the next crawl agrees.`,
  copyAll: 'Copy all as one prompt',
  removeNote: 'Its history stays in your account in case you add it back',
  noFixes: 'No fixes are open at the latest check.',
  noAlerts: 'No alert rules yet.',
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

// ── Where the site page differs from its locked HTML ───────────────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/site.test.tsx).

const ZONE =
  'FACTS D4 and Q4 (owner ruling): dates and times in the account’s zone, America/Indiana/Indianapolis; the locked page wrote them in UTC';

export const SITE_CHANGES: CopyChange[] = [
  ...railChanges('site'),
  {
    screen: 'site',
    kind: 'fixture',
    locked:
      'last check today 06:00 · next Fri 6 Nov 06:00 · 214 pages · 15 fixes: the 14 from the audit plus the new ClaudeBot block',
    rendered:
      "last check today 06:02 · next Fri 6 Nov around 06:00 · 214 pages · 16 fixes: the 13 from the audit plus 3 new at Friday's check",
    source:
      'The fixture’s check finished 06:02 in the account’s zone, and fixesAsOf it holds 16 fixes: 13 first seen at the first audit, three (0, 14, 15) at Friday’s; "around" is FACTS H4',
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: 'Open the ClaudeBot packet',
    rendered: 'Open the Claude-SearchBot packet',
    source:
      'The fixture’s fix 0 removes the Claude-SearchBot block (its crawler_uas); the highest-ranked new fix',
  },
  {
    screen: 'site',
    kind: 'facts',
    locked: '25 Oct the first audit',
    rendered: '24 Oct the first audit',
    source: `${ZONE}: the first audit finished 25 Oct 02:34Z`,
  },
  {
    screen: 'site',
    kind: 'facts',
    locked: 'weekly from Fri 30 Oct 06:00',
    rendered: 'weekly from Fri 30 Oct around 06:00',
    source: 'FACTS H4',
  },
  {
    screen: 'site',
    kind: 'facts',
    locked: 'AI visibility',
    rendered: 'AI readability',
    source: 'FACTS A1',
    all: true,
  },
  {
    screen: 'site',
    kind: 'facts',
    locked: 'Crawler 25 Oct',
    rendered: 'Crawler 24 Oct',
    source: ZONE,
  },
  {
    screen: 'site',
    kind: 'facts',
    locked:
      'Googlebot ● ● ● ● ● ● — Bingbot ● ● ● ● ● ● — GPTBot ■ ■ ■ ■ ■ ■ Cloudflare firewall rule (1020) OAI-SearchBot ▲ ▲ ▲ ▲ ▲ ▲ client-rendered template, 31% ClaudeBot ▲ ▲ ▲ ▲ ▲ ■ robots.txt changed Thu 19:40: ClaudeBot disallowed PerplexityBot ■ ■ ■ ■ ■ ■ Bot Fight Mode challenge',
    rendered: `Googlebot ${SITE_COPY.searchEngineCause} Bingbot ${SITE_COPY.searchEngineCause} OAI-SearchBot client-rendered template, 31% ChatGPT-User client-rendered template, 31% PerplexityBot Bot Fight Mode challenge Claude-SearchBot robots.txt changed Thu 19:40: Claude-SearchBot disallowed GPTBot Cloudflare firewall rule (error 1020) ClaudeBot robots.txt changed Thu 19:40: ClaudeBot disallowed ${TAGGED_UA_LINE}`,
    source:
      'FACTS B2 (row 223: Google and Bing by robots.txt), I6 (eight crawlers, in the check’s order), I2 (PerplexityBot challenged, ○, not blocked) and D1; the cause text is the access segment’s',
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: 'Fixes · 15, counting the new one',
    rendered: 'Fixes · 16, counting the 3 new',
    source: 'The fixture holds 16 open fixes at Friday’s check, three of them first seen there',
  },
  {
    screen: 'site',
    kind: 'facts',
    locked: 'Effect Status',
    rendered: 'Effect, estimated Status',
    source: 'FACTS A5 (Site page: column header "Effect, estimated")',
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: 'Remove the ClaudeBot block from robots.txt',
    rendered: 'Remove the Claude-SearchBot block from robots.txt',
    source: 'The fixture’s fix 0 title',
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: '+ User-agent: ClaudeBot · + Disallow: / · two lines to delete',
    rendered:
      '+ User-agent: ClaudeBot · + User-agent: Claude-SearchBot · + Disallow: / · three lines to delete',
    source: 'The fixture’s change records three added lines in robots.txt (cause.diff.added)',
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: 'the re-check found 12%, so it stays open',
    // The locked page hides this note on a phone, and so does ours.
    hiddenOnPhone: true,
    rendered: 'the re-check that day did not agree, so it stays open',
    source:
      'The fixture records the re-check’s verdict (reopened, Wed 28 Oct, at check 4) and no text share for it; 12% is the template’s share at the latest check, not the re-check’s',
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: 'Structure +4 SEO open Packet',
    rendered: 'Structure +4 SEO open · Pro Packet',
    source:
      'The fixture’s Free three at Friday’s check are fixes 1, 2 and 0 (isFreeFix, by rank), so fix 3 is a Pro fix',
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: 'Content +1 SEO open · Pro',
    rendered: 'Content AI after fixes 1 and 2 open · Pro',
    source:
      'The fixture’s fix 4 effect, as points() words it (FACTS I11: its AI effect waits on fixes 1 and 2)',
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked:
      '5–14 Ten more: anchors, depth, spec images, authors, Web Bot Auth, canonicals, pagination, redirect chain, hreflang, JS navigation — +7 SEO',
    rendered:
      '5–15 Eleven more: 7 in Structure and 4 in Content — +7 Technical SEO together; AI effect not yet estimated for 4',
    source:
      'The fixture’s fixes 5 to 15, counted by section; the topic list is in no record, and the grouped effect is the fixes’ own (groupPoints)',
  },
  {
    screen: 'site',
    kind: 'facts',
    locked: 'weekly, Fri 06:00 UTC',
    rendered: 'weekly, Fri around 06:00, Indianapolis time',
    source: `${ZONE}; "around" is FACTS H4`,
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: 'fired Fri 06:00',
    rendered: 'fired Fri 06:03',
    source: 'The fixture’s alert rules fired at 10:03Z, 06:03 in the account’s zone',
    all: true,
  },
  {
    screen: 'site',
    kind: 'fixture',
    locked: '17 content changes Thu',
    rendered: '17 pages changed content, Fri',
    source: 'The fixture’s content change, as its summary words it, detected at Friday’s check',
  },
];

export const SITE_ADDITIONS: Addition[] = [
  {
    screen: 'site',
    what: 'A crawler row read aloud in full ("Googlebot: allowed by robots.txt at all six checks"), and each glyph cell’s verdict in words, for screen readers',
    source: 'CC-26 brief, scope 6 (accessibility); FACTS row 223',
  },
];
