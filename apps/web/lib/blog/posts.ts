// Single source of truth for blog post METADATA (slug, SEO fields, dates). The post BODIES live in
// `lib/blog/content/<slug>.tsx` and are wired to slugs in `lib/blog/registry.tsx`. Keeping metadata
// separate (no React/JSX import) lets the sitemap + index read it cheaply, server or edge.

export interface BlogPostMeta {
  /** URL slug: /blog/<slug> */
  slug: string;
  /** H1 + <title> (before the "· Crawlmouse" suffix). */
  title: string;
  /** Meta description (~150–160 chars). */
  description: string;
  /** Short blurb for the index card. */
  excerpt: string;
  /** Target keywords (also surfaced as the OG description context). */
  keywords: string[];
  /** ISO date first published. */
  publishedAt: string;
  /** ISO date last meaningfully updated. */
  updatedAt: string;
  /** Estimated reading time in minutes. */
  readingMinutes: number;
}

export const POSTS: readonly BlogPostMeta[] = [
  {
    slug: 'screaming-frog-vs-lumar-deepcrawl',
    title: 'Screaming Frog vs Lumar (DeepCrawl): Desktop Tool vs Enterprise Platform',
    description:
      'Screaming Frog and Lumar (formerly DeepCrawl) solve different problems at very different prices. An honest August 2026 comparison — and when you need neither.',
    excerpt:
      'People still search "Screaming Frog vs DeepCrawl" — but DeepCrawl became Lumar, and the comparison changed. Desktop audits vs enterprise platform: an honest August 2026 breakdown of pricing, monitoring, CI/CD, and fit.',
    keywords: [
      'screaming frog vs deepcrawl',
      'deepcrawl vs screaming frog',
      'screaming frog vs lumar',
      'lumar deepcrawl',
      'deepcrawl alternative',
      'lumar alternative',
    ],
    publishedAt: '2026-08-18',
    updatedAt: '2026-08-18',
    readingMinutes: 9,
  },
  {
    slug: 'find-orphan-pages-squarespace',
    title: 'How to Find Orphan Pages on Squarespace (Free, Nothing to Install)',
    description:
      "Squarespace's Not Linked section quietly creates orphan pages. Here is how to find every orphan on your Squarespace site for free — and fix the ones that matter.",
    excerpt:
      'Squarespace ships with a built-in orphan-page factory: the Not Linked section. Pages there stay public and indexable with zero internal links. Here is how to find every orphan on your site for free, and fix the ones that matter.',
    keywords: [
      'squarespace orphan pages',
      'find orphan pages squarespace',
      'squarespace not linked pages seo',
      'squarespace internal linking',
      'squarespace seo audit',
    ],
    publishedAt: '2026-08-18',
    updatedAt: '2026-08-18',
    readingMinutes: 8,
  },
  {
    slug: 'block-ai-crawlers-robots-txt',
    title: 'Should You Block AI Crawlers? A robots.txt Guide for GPTBot, ClaudeBot & Co.',
    description:
      'Should you block GPTBot, ClaudeBot, and other AI crawlers? A practical 2026 robots.txt guide — what each bot does, what blocking costs, and copy-paste rules.',
    excerpt:
      'A quarter of top sites now block GPTBot, and Cloudflare blocks AI crawlers by default. Before you follow: training bots and AI search bots are different switches. A practical robots.txt guide with copy-paste rules for each stance.',
    keywords: [
      'block ai crawlers robots.txt',
      'block gptbot',
      'should i block ai crawlers',
      'oai-searchbot robots.txt',
      'gptbot vs oai-searchbot',
      'claudebot robots.txt',
    ],
    publishedAt: '2026-08-18',
    updatedAt: '2026-08-18',
    readingMinutes: 9,
  },
  {
    slug: 'sitebulb-vs-jetoctopus-vs-oncrawl',
    title: 'Sitebulb vs JetOctopus vs Oncrawl: Cloud SEO Crawlers Compared',
    description:
      "Sitebulb Cloud, JetOctopus, and Oncrawl are the main cloud SEO crawlers. An honest July 2026 comparison of pricing, log analysis, and which one fits your site.",
    excerpt:
      'Once your site outgrows a desktop crawler, you end up comparing Sitebulb Cloud, JetOctopus, and Oncrawl. Here is an honest July 2026 comparison — pricing, log analysis, JavaScript crawling, and when none of the three is the right spend.',
    keywords: [
      'sitebulb vs jetoctopus',
      'jetoctopus vs oncrawl',
      'sitebulb vs oncrawl',
      'jetoctopus vs sitebulb',
      'cloud seo crawler comparison',
      'oncrawl alternative',
    ],
    publishedAt: '2026-07-22',
    updatedAt: '2026-08-18',
    readingMinutes: 10,
  },
  {
    slug: 'can-ai-crawlers-see-javascript',
    title: 'Can AI Crawlers See Your JavaScript Site? (How to Check)',
    description:
      "AI crawlers like GPTBot and ClaudeBot don't run JavaScript, so a JS site can rank on Google yet be invisible to ChatGPT. Here's how to check what yours shows them.",
    excerpt:
      "Googlebot renders JavaScript; the AI crawlers behind ChatGPT, Claude, and Perplexity don't. Here is why a JS site can rank on Google yet be blank to AI search, and how to check yours.",
    keywords: [
      'can ai crawlers see javascript',
      'do ai crawlers render javascript',
      'javascript seo ai',
      'gptbot javascript',
      'is my site visible to chatgpt',
      'ai crawler javascript rendering',
      'can ai crawlers execute javascript',
      'oai-searchbot vs gptbot',
    ],
    publishedAt: '2026-07-06',
    updatedAt: '2026-08-18',
    readingMinutes: 11,
  },
  {
    slug: 'sitebulb-vs-screaming-frog',
    title: 'Sitebulb vs Screaming Frog: Which SEO Crawler Should You Use?',
    description:
      "Sitebulb and Screaming Frog are the two big SEO crawlers. Here's an honest comparison of features, pricing, and which to pick — plus a free no-install option.",
    excerpt:
      'Screaming Frog and Sitebulb are the two big technical-SEO crawlers, and they overlap heavily. Here is an honest comparison of features, pricing, and learning curve — and when you need neither.',
    keywords: [
      'sitebulb vs screaming frog',
      'screaming frog vs sitebulb',
      'sitebulb or screaming frog',
      'best seo crawler',
      'sitebulb comparison',
      'screaming frog comparison',
      'screaming frog mcp server',
      'sitebulb pricing',
    ],
    publishedAt: '2026-07-06',
    updatedAt: '2026-07-22',
    readingMinutes: 10,
  },
  {
    slug: 'find-orphan-pages-webflow',
    title: 'How to Find Orphan Pages on Webflow (Free, No App)',
    description:
      "Webflow orphans pages when you limit CMS Collection Lists or skip navigation links. Here's how to find every orphan page on your Webflow site for free.",
    excerpt:
      'Webflow orphans pages in one sneaky way most people miss: limiting a CMS Collection List. Here is how to find every orphan on your Webflow site for free, and how to fix them.',
    keywords: [
      'webflow orphan pages',
      'find orphan pages webflow',
      'webflow internal linking',
      'webflow cms collection orphan',
      'webflow seo orphan pages',
      'orphan pages webflow',
    ],
    publishedAt: '2026-07-06',
    updatedAt: '2026-07-06',
    readingMinutes: 8,
  },
  {
    slug: 'sitebulb-alternative',
    title: 'A Free Sitebulb Alternative for Internal Linking (No Install)',
    description:
      "Sitebulb is a paid desktop and cloud crawler with no free tier. If you just need to grade your internal linking, here's a free, no-install browser alternative.",
    excerpt:
      'Sitebulb is a superb technical crawler — and a paid, mostly-desktop one. Here is an honest look at ' +
      'a free, browser-based alternative for the internal-linking slice.',
    keywords: [
      'sitebulb alternative',
      'free sitebulb alternative',
      'sitebulb alternative free',
      'no install seo crawler',
      'browser based seo crawler',
      'internal linking tool',
    ],
    publishedAt: '2026-07-04',
    updatedAt: '2026-07-04',
    readingMinutes: 8,
  },
  {
    slug: 'discovered-currently-not-indexed',
    title: 'Discovered – Currently Not Indexed: Why It Happens and How to Fix It',
    description:
      "Discovered - currently not indexed means Google found your page but hasn't crawled it yet. Here's why it happens, and how stronger internal linking fixes it.",
    excerpt:
      'A page that returns 200 and sits in your sitemap can still refuse to index. Here is what the ' +
      'not-indexed statuses mean, and the internal-linking fix that actually moves them.',
    keywords: [
      'discovered currently not indexed',
      'crawled currently not indexed',
      'pages not indexed google',
      'why is my page not indexed',
      'fix not indexed',
      'google not indexing pages',
    ],
    publishedAt: '2026-07-04',
    updatedAt: '2026-07-04',
    readingMinutes: 9,
  },
  {
    slug: 'find-orphan-pages-shopify',
    title: 'How to Find Orphan Pages on Shopify (Free, No App Needed)',
    description:
      "Shopify orphans your canonical product URLs by default, so they rarely get crawled or indexed. Here's how to find every orphan page on your store for free.",
    excerpt:
      'Shopify orphans pages faster than almost any platform — flat URLs, collection templates, thin ' +
      'collections. Here is how to find them all for free, and fix the ones worth keeping.',
    keywords: [
      'shopify orphan pages',
      'find orphan pages shopify',
      'shopify internal linking',
      'shopify orphaned products',
      'shopify canonical url no internal links',
      'shopify seo internal links',
    ],
    publishedAt: '2026-07-04',
    updatedAt: '2026-07-04',
    readingMinutes: 8,
  },
  {
    slug: 'find-orphan-pages-wordpress',
    title: 'How to Find Orphan Pages in WordPress (Free, No Plugin Needed)',
    description:
      "Orphan pages pile up fast in WordPress. Here's how to find every orphaned post and page for free — no extra plugin needed — and fix the ones worth keeping.",
    excerpt:
      'WordPress orphans pages faster than almost any platform — tag archives, page-builder pages, ' +
      'theme swaps. Here is how to find them all for free, with or without a plugin, and fix them.',
    keywords: [
      'wordpress orphaned pages',
      'orphan pages wordpress',
      'find orphan pages wordpress',
      'wordpress orphaned content',
      'how to find orphan pages in wordpress',
    ],
    publishedAt: '2026-07-02',
    updatedAt: '2026-07-02',
    readingMinutes: 8,
  },
  {
    slug: 'screaming-frog-alternative',
    title: 'A Free Screaming Frog Alternative for Internal Linking (No Install)',
    description:
      "Screaming Frog is a desktop app capped at 500 URLs free. If you just need to audit and grade internal linking, here's a free, no-install browser alternative.",
    excerpt:
      'Screaming Frog is a brilliant desktop crawler — and overkill if all you want is your internal-linking ' +
      'grade. Here is an honest look at a free, browser-based alternative and when to use which.',
    keywords: [
      'screaming frog alternative',
      'free screaming frog alternative',
      'screaming frog alternative free',
      'no install seo crawler',
      'browser based seo crawler',
      'internal linking tool',
    ],
    publishedAt: '2026-07-02',
    updatedAt: '2026-07-02',
    readingMinutes: 8,
  },
  {
    slug: 'how-deep-is-too-deep-crawl-depth',
    title: 'How Deep Is Too Deep? Crawl Depth Limits and How to Fix Buried Pages',
    description:
      "How many clicks from your homepage is too many? A practical, site-size-aware guide to crawl depth limits — and exactly how to pull buried pages back up.",
    excerpt:
      'There is no single magic number, but there is a clear answer for your site. Here is how deep is too deep by site size, why it matters, and how to fix the pages that slipped too far.',
    keywords: [
      'crawl depth',
      'what is a good crawl depth',
      'crawl depth seo',
      'how many clicks from homepage',
      'pages more than 3 clicks',
      'click depth',
    ],
    publishedAt: '2026-06-30',
    updatedAt: '2026-06-30',
    readingMinutes: 8,
  },
  {
    slug: 'free-internal-link-audit',
    title: "Internal Link Checker: How to Audit Your Site's Internal Links Free",
    description:
      "Check your internal links without installing software. Here's how to run a free internal-link audit — orphan pages, weak hubs, and buried pages — in your browser.",
    excerpt:
      'You do not need a paid crawler or a desktop install to check your internal links. Here is how to ' +
      'audit them free, what a good checker measures, and how to read the result.',
    keywords: [
      'internal link checker',
      'internal link audit',
      'free internal link audit',
      'check internal links',
      'internal linking audit',
      'internal link analysis',
    ],
    publishedAt: '2026-06-12',
    updatedAt: '2026-07-02',
    readingMinutes: 8,
  },
  {
    slug: 'orphan-pages',
    title: 'How to Find Orphan Pages on Your Website (Free, No Install)',
    description:
      "Orphan pages have no internal links, so search engines rarely rank them. Here's how to find every orphan page free — no Screaming Frog or Semrush install.",
    excerpt:
      'An orphan page is one nothing links to — so crawlers rarely find it and the work that went in is wasted. ' +
      'Here is how to find every orphan on your site, free, and fix the ones worth keeping.',
    keywords: [
      'how to find orphan pages',
      'orphan pages',
      'find orphan pages',
      'orphan pages seo',
      'how to find orphan pages on a website',
      'semrush orphaned pages',
      'wordpress orphaned pages',
    ],
    publishedAt: '2026-06-12',
    updatedAt: '2026-07-02',
    readingMinutes: 9,
  },
  {
    slug: 'crawl-depth-site-architecture',
    title: 'Crawl Depth & Site Architecture: Why Click-Depth Affects Rankings',
    description:
      "Click depth — how far a page sits from your homepage — shapes how often search engines crawl it and how much authority it gets. Here's how to fix it.",
    excerpt:
      'A page buried eight clicks deep gets crawled less, earns less internal authority, and ranks worse than the same content three clicks from home. Here is why, and what to do.',
    keywords: ['crawl depth', 'click depth seo', 'site architecture seo', 'page depth seo'],
    publishedAt: '2026-06-12',
    updatedAt: '2026-06-12',
    readingMinutes: 9,
  },
] as const;

export const POSTS_BY_SLUG: ReadonlyMap<string, BlogPostMeta> = new Map(POSTS.map((p) => [p.slug, p]));

export function allPostSlugs(): string[] {
  return POSTS.map((p) => p.slug);
}

/** Newest first, for the index. */
export function postsNewestFirst(): BlogPostMeta[] {
  return [...POSTS].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}
