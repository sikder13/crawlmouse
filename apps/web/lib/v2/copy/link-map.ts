/**
 * Final-LinkMap (the link-map explorer): where the rebuilt page's text differs from the locked
 * HTML, and why. Applied in order by the lock comparison (__tests__/v2/link-map.test.tsx).
 */
import type { Addition, CopyChange } from '../copy-registry';

export const LINK_MAP_CHANGES: CopyChange[] = [
  {
    screen: 'link-map',
    kind: 'a11y',
    locked: '+ − Fit',
    rendered: '+ Fit',
    source:
      'axe color-contrast, undecided ("Element content contains only non-text characters", nonBmp) on the U+2212 minus: the zoom-out button draws its minus as a bar and is named "Zoom out" by its label.',
  },
  {
    screen: 'link-map',
    kind: 'fixture',
    locked:
      'Zoomed to the hubs and their neighbours, 66 of 214; zoom in for the rest. Select a page to see what links to it, what it links to, and which crawlers reach it. Orphans sit at the edge with no line in.',
    rendered:
      'Zoomed to the hubs and their neighbours, 8 of 214. The audit’s record holds 16 of its 214 pages and 11 of its 779 links, so the hubs are found among those. Select a page to see what links to it, what it links to, and which crawlers reach it.',
    source:
      'The fixture’s record of this audit (`withheld`): 16 of its 214 pages and 11 of its 779 links. The engine’s hubsAndNeighbours finds 8 pages among them; no orphan is among those 8, so the sentence about orphans is left out. "Explore all 214" draws every page.',
  },
  {
    screen: 'link-map',
    kind: 'fixture',
    locked: 'Crawlers that read its text 2 of 6',
    rendered: 'Crawlers that read its text 0 of 6',
    source:
      'The fixture’s page record: of the six AI crawlers tested, none reads this page’s text (FACTS I6 counts AI crawlers only).',
  },
  {
    screen: 'link-map',
    kind: 'fixture',
    locked:
      '7 more Not linked: /products/ridge-footprint and /products/ridge-3p, its own accessories, both orphans',
    rendered: '7 more, not in this record',
    source:
      'The fixture’s record holds 5 of the page’s 12 links, so the rest are counted, not listed. The contract has no field relating an orphan to the page it belongs beside, so "Not linked" is not shown (a contract follow-up).',
  },
  {
    screen: 'link-map',
    kind: 'fixture',
    locked:
      'Googlebot, Bingbot ● 200, 1,120 words OAI-SearchBot, ClaudeBot ▲ 200, 134 words GPTBot ■ 403 PerplexityBot ■ challenge',
    rendered:
      'OAI-SearchBot allowed, thin 134 words Claude-SearchBot allowed, thin 134 words 2 of the 6 AI crawlers’ requests for this page are in the record.',
    source:
      'The fixture’s access tests for this page: two crawler requests, each with its verdict (FACTS I2: verdicts, not status codes) and word count; the page says how many of the six the record holds.',
  },
];

export const LINK_MAP_ADDITIONS: Addition[] = [
  {
    screen: 'link-map',
    what: '"Explore all 214": every page crawled, on its own page',
    source: 'CC-24 brief, scope 2',
  },
  {
    screen: 'link-map',
    what: 'The evidence class beside each crawler verdict in the selected page’s panel',
    source: 'CC-22 brief, scope 1 (as on every crawler verdict)',
  },
  {
    screen: 'link-map',
    what: 'The page list the keyboard walks (shown by "List view"), and a status line naming the selected page',
    source: 'CC-24 brief, scope 2 (keyboard model, announced details)',
  },
  {
    screen: 'link-map',
    what: 'What a pressed filter says: how many pages it counts, and how many of them are drawn',
    source: 'OPERATING-RULES §10 (no silent truncation)',
  },
];
