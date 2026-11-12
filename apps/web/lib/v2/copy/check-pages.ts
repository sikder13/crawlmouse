/**
 * The words of the three `/check` pages (CC-29 D8, DECISION A10): one search question each, answered
 * by the home's audit. Every paragraph and table names what it rests on (`sources`): files in this
 * repository, by path from its root, or a vendor's documentation page from `VENDOR_DOCS`.
 * `check-pages.test.ts` fails on a file that does not exist, on a link outside `VENDOR_DOCS`, and on
 * a crawler named in a block that no cited file names. The vendor pages were read on
 * 2026-11-12. A sentence that states what the sample audit measured is built from the fixture in
 * `lib/v2/view/check-pages.ts`, not written here.
 *
 * The titles and descriptions keep "AI visibility" as the search term (FACTS K7); the pages
 * themselves say "AI readability", the grade's name (FACTS A1).
 *
 * This module imports nothing, so `app/sitemap.ts` can read the paths without loading a view.
 */

export const CHECK_QUESTIONS = ['gptbot', 'javascript', 'robots-ai'] as const;
export type CheckQuestion = (typeof CHECK_QUESTIONS)[number];

export const isCheckQuestion = (value: string): value is CheckQuestion =>
  (CHECK_QUESTIONS as readonly string[]).includes(value);

/** The page's address, which is also its canonical. */
export const checkPath = (question: CheckQuestion) => `/check/${question}`;

/** Where a sentence comes from: files in this repository, by path from its root. */
export const SOURCE = {
  facts: 'docs/design/v2/FACTS-proposed.md',
  home: 'apps/web/components/v2/screens/home/HomeScreen.tsx',
  registry: 'packages/engine/src/v2/crawler-registry.ts',
  aiBots: 'packages/engine/src/analysis/ai-readiness/constants.ts',
  robotsGuide: 'apps/web/lib/blog/content/block-ai-crawlers-robots-txt.tsx',
  jsGuide: 'apps/web/lib/blog/content/can-ai-crawlers-see-javascript.tsx',
  operatingRules: 'docs/OPERATING-RULES.md',
} as const;

/** The vendors' own crawler documentation, cited where a sentence reports what a vendor says. */
export const VENDOR_DOCS = {
  openAi: 'https://developers.openai.com/api/docs/bots',
  anthropic:
    'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
  perplexity: 'https://docs.perplexity.ai/guides/bots',
} as const;

/**
 * The crawlers the JavaScript guide's quick answer names as reading only the raw HTML, in its order.
 * The guide rests that on the Vercel and MERJ study; `check-pages.test.ts` reads the guide for both.
 */
export const JS_GUIDE_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot'] as const;

export interface Paragraph {
  text: string;
  sources: readonly string[];
}

export interface CheckPageCopy {
  title: string;
  description: string;
  /** The one question the page answers. */
  h1: string;
  sub: string;
  /** The explanation's heading: the reader's problem, not a label (DESIGN-LOCK rule 11). */
  heading: string;
  paragraphs: readonly Paragraph[];
}

/** Shared with the home, whose hero note and closing heading these pages repeat. */
export const FUNNEL = {
  /** `pages` is Free's page cap, from GATES. */
  heroNote: (pages: string) =>
    `Free · up to ${pages} pages · about two minutes · nothing to install · the result is kept 24 hours; one email keeps it longer`,
  closing: 'Two minutes from now you’ll know what each crawler sees.',
  /** The form's name as a landmark. */
  formLabel: 'Start an audit',
} as const;

export const CHECK_COPY: Readonly<Record<CheckQuestion, CheckPageCopy>> = {
  gptbot: {
    title: 'Is GPTBot blocked? A free AI visibility check',
    description:
      'Find out whether GPTBot, OAI-SearchBot and ChatGPT-User can reach your site, and which of them your AI visibility depends on. Free, about two minutes, nothing to install.',
    h1: 'Is GPTBot blocked on your site?',
    sub: 'Crawlmouse requests pages from your site as GPTBot and the other AI crawlers, and shows you what each one got back.',
    heading: 'GPTBot is one of OpenAI’s crawlers, and blocking it is your choice.',
    paragraphs: [
      {
        text: 'GPTBot collects pages for OpenAI’s model training. Disallowing it tells OpenAI your pages should not be used in that training, and OpenAI’s documentation says each of its crawler settings is independent: blocking GPTBot does not take you out of ChatGPT search, which is OAI-SearchBot’s job.',
        sources: [SOURCE.aiBots, SOURCE.robotsGuide, VENDOR_DOCS.openAi],
      },
      {
        text: 'A block is not always written in robots.txt. A firewall rule can answer GPTBot with a 403 (on Cloudflare, error 1020) while robots.txt allows it. So the audit reads robots.txt and also requests pages as each crawler, and keeps the answer: status, headers, first bytes.',
        sources: [SOURCE.facts, SOURCE.home],
      },
      {
        text: 'Each request carries the crawler’s user agent, tagged "Crawlmouse/2.0 (+https://crawlmouse.com/bot)". A rule that matches the whole string exactly will not fire on the tagged version, so a block can be under-reported.',
        sources: [SOURCE.facts],
      },
    ],
  },
  javascript: {
    title: 'Can AI crawlers read your JavaScript? A free AI visibility check',
    description:
      'Most AI crawlers read only the HTML your server sends. See how much of each page is left without JavaScript, page by page. Free, about two minutes, nothing to install.',
    h1: 'Can AI crawlers read your site without JavaScript?',
    sub: 'Crawlmouse compares what a browser renders with the raw response a crawler receives, page by page, and gives you the number.',
    heading: 'Most AI crawlers never run your JavaScript.',
    paragraphs: [
      {
        text: 'Googlebot and Bingbot render JavaScript, so a page can rank on Google and still be close to empty for ChatGPT, Claude and Perplexity.',
        sources: [SOURCE.jsGuide, SOURCE.facts],
      },
      {
        text: 'Text that appears only after a script runs is missing for them, and a link that exists only after a script runs is not followed, so the pages behind it can go unfound.',
        sources: [SOURCE.jsGuide, SOURCE.robotsGuide],
      },
      {
        text: 'The fix is to put the content and the links in the HTML the server sends, with server-side rendering or pre-rendering.',
        sources: [SOURCE.jsGuide],
      },
    ],
  },
  'robots-ai': {
    title: 'robots.txt for AI crawlers: a free AI visibility check',
    description:
      'What your robots.txt tells GPTBot, OAI-SearchBot, ClaudeBot and PerplexityBot, and what it cannot stop. Free, about two minutes, nothing to install.',
    h1: 'What does your robots.txt tell AI crawlers?',
    sub: 'Crawlmouse reads your robots.txt for each crawler, then requests pages as each AI crawler, so you see what you asked for next to what happened.',
    heading: 'robots.txt is a request, not a wall.',
    paragraphs: [
      {
        text: 'A crawler follows the group of rules that names its token, such as "User-agent: GPTBot", and a group that names a crawler does not inherit the rules written under "User-agent: *".',
        sources: [SOURCE.operatingRules],
      },
      {
        text: 'The large operators, OpenAI, Anthropic, Google and Microsoft among them, document that their crawlers follow it. It asks; it does not refuse a request, and it does not remove what earlier crawls collected.',
        sources: [SOURCE.robotsGuide],
      },
      {
        text: 'Training and answers are separate switches. Disallowing GPTBot or ClaudeBot asks them to leave your pages out of future training. Disallowing OAI-SearchBot, Claude-SearchBot or PerplexityBot concerns their search answers, and it is not a clean exit: OpenAI says a site that blocks OAI-SearchBot is not shown in ChatGPT search answers but can still appear as a navigational link, Anthropic says blocking Claude-SearchBot may reduce your visibility in its search results, and Perplexity recommends allowing PerplexityBot for your site to appear in its results.',
        sources: [
          SOURCE.robotsGuide,
          SOURCE.aiBots,
          VENDOR_DOCS.openAi,
          VENDOR_DOCS.anthropic,
          VENDOR_DOCS.perplexity,
        ],
      },
      {
        text: 'Some fetches sit outside it: OpenAI says robots.txt rules may not apply to ChatGPT-User, which fetches a page when a person asks about it, and Perplexity says Perplexity-User generally ignores them. A change is not instant either: OpenAI says about 24 hours for its search crawler, and Perplexity up to 24 hours.',
        sources: [SOURCE.registry, SOURCE.aiBots, VENDOR_DOCS.openAi, VENDOR_DOCS.perplexity],
      },
      {
        text: 'What robots.txt cannot show is a firewall, a bot manager or a CDN default refusing a crawler it allows. Cloudflare has blocked AI crawlers by default on newly onboarded domains since 1 July 2025. That is why the audit also requests pages as each AI crawler; Googlebot and Bingbot are shown by robots.txt only.',
        sources: [SOURCE.robotsGuide, SOURCE.facts, SOURCE.home],
      },
    ],
  },
};

/** Sentences built from data in the view; each names its sources the same way. */
export const CHECK_DATA_COPY = {
  /** gptbot: `names` lists the crawlers the grade counts, from the fixture's check. */
  scored: (names: string) =>
    `Because blocking GPTBot is a choice, Crawlmouse shows it and does not count it towards your AI readability grade. The grade counts ${names}.`,
  scoredSources: [SOURCE.facts],
  /** gptbot: the OpenAI crawlers the audit tests (OpenAI documents more; the label says which these are). */
  openAiTable: {
    label: 'The OpenAI crawlers the audit tests',
    crawler: 'Crawler',
    does: 'What it does',
    grade: 'In the AI readability grade',
    counted: 'counted',
    notCounted: 'shown, not counted',
  },
  openAiSources: [SOURCE.aiBots, SOURCE.facts],
  /** javascript: `names` lists `JS_GUIDE_CRAWLERS`. */
  noJs: (names: string) =>
    `As of July 2026, ${names} read only the HTML your server returns and do not run JavaScript. Our guide reports this from Vercel and MERJ’s study of AI crawler fetches, which found none of them running it.`,
  noJsSources: [SOURCE.jsGuide],
  /** javascript: what the sample audit, of the made-up site the home replays, measured on one page. */
  example: (p: {
    path: string;
    browser: string;
    bot: string;
    botWords: string;
    share: number;
    pages: string;
    noun: string;
  }) =>
    `In a sample audit of a made-up site, ${p.path} shows ${p.browser} words in a browser and ${p.botWords} to ${p.bot}, ${p.share}%. ${p.pages} ${p.noun} pages share its template.`,
  exampleSources: [SOURCE.facts],
} as const;
