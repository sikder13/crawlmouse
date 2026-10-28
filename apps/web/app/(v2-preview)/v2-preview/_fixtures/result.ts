import type { ResultScreenData } from '../../../../components/v2/screens/types';

/**
 * The audit on the locked Result screen (docs/design/v2/screens/Final-Result.dc.html and its dark
 * twin), value for value. Interim: CC-11's frozen fixtures (apps/web/lib/fixtures/v2) replace this
 * once merged.
 */
export const RESULT_FIXTURE: ResultScreenData = {
  domain: 'example-outfitter.com',
  crawl: {
    pagesCrawled: 214,
    pagesTotal: 214,
    crawledAt: '25 Oct 2026, 02:34 UTC',
    keptUntil: '26 Oct, 02:34 UTC',
  },
  grades: [
    {
      label: 'Technical SEO',
      letter: 'B',
      score: 79,
      tone: 'default',
      summary:
        'Sound structure; seven pages nobody links to. Three fixes take it to A-; one of them is open now.',
    },
    {
      label: 'AI visibility',
      letter: 'D',
      score: 41,
      tone: 'bad',
      summary:
        "Two AI crawlers never get past Cloudflare's bot defences; product pages are empty to the rest.",
    },
  ],
  fixFirst: {
    title: 'Let GPTBot and PerplexityBot through Cloudflare',
    body: 'A firewall rule and one bot setting, about ten minutes. AI visibility 41 → 65, estimated. The steps and the evidence are open, free.',
    href: '#',
  },
  doors: [
    {
      title: 'Crawler access',
      pill: { state: 'bad', label: '2 of 6 blocked' },
      bar: { percent: 33, tone: 'bad' },
      body: "GPTBot is refused by a firewall rule; PerplexityBot gets a challenge page. Google, Bing, Claude and OpenAI's search bot get in.",
      footer: '6 crawlers × 214 pages · 1 fix open · 1 on Pro',
      href: '#',
    },
    {
      title: 'Readable without JavaScript',
      pill: { state: 'warn', label: '31% of text' },
      bar: { percent: 31, tone: 'warn' },
      body: "The product template renders client-side, so 158 pages are near-empty to any bot that doesn't run scripts. Homepage and blog are fine.",
      footer: 'Top 25 pages measured · 1 fix open',
      href: '#',
    },
    {
      title: 'Site structure',
      pill: { state: 'neutral', label: '74 / 100' },
      bar: { percent: 74, tone: 'neutral' },
      body: "Seven orphan pages, three pages deeper than three clicks, anchor text that repeats. Four hubs carry 61% of the site's PageRank.",
      footer: 'Link map, 214 nodes · 1 fix open · 7 on Pro',
      href: '#',
    },
    {
      title: 'Content an answer engine can quote',
      pill: { state: 'warn', label: '58 / 100' },
      bar: { percent: 58, tone: 'warn' },
      body: "Blog posts answer their titles in the first paragraph; product pages don't. Headings skip levels on 41 pages. Schema is present on products.",
      footer: 'Per-page structure score · 3 on Pro',
      href: '#',
    },
    {
      title: 'Agent-readiness signals',
      pill: { state: 'neutral', label: '2 of 7 present' },
      bar: { percent: 28, tone: 'neutral' },
      body: 'Schema and Content Signals are there. No Web Bot Auth directory, no llms.txt, no MCP server card. Weighted by what engines actually use.',
      footer: 'Checked by fetch · nothing urgent',
      href: '#',
    },
    {
      title: 'What changed since last time',
      pill: { state: 'neutral', label: 'first audit' },
      body: 'Keep this audit and we re-run it monthly and show the diff here: pages added or lost, crawlers newly blocked, templates that broke.',
      footer: 'Keeping it takes one email',
      href: '#keep',
      keep: true,
    },
  ],
  fixes: {
    total: 14,
    rows: [
      {
        title: 'Let GPTBot and PerplexityBot through Cloudflare',
        points: '+24 AI',
        open: true,
        count: 1,
        href: '#',
      },
      {
        title: 'Server-render the product template',
        scope: '158 pages',
        points: '+22 AI',
        open: true,
        count: 1,
        href: '#',
      },
      {
        title: 'Link the 7 orphan pages from their collections',
        points: '+4 SEO',
        open: true,
        count: 1,
        href: '#',
      },
      {
        title: 'Generic anchor text on 6 pages',
        points: '+2 SEO',
        open: false,
        count: 1,
        href: '#pro',
      },
      {
        title: '3 pages deeper than three clicks',
        points: '+1 SEO',
        open: false,
        count: 1,
        href: '#pro',
      },
      {
        title: 'Nine more, grouped by type',
        points: '+5 SEO',
        open: false,
        count: 9,
        href: '#pro',
      },
    ],
  },
  map: { pages: 214, links: 779, orphans: 7, href: '#' },
};
