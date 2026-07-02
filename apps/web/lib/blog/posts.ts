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
