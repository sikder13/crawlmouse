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
    slug: 'free-internal-link-audit',
    title: 'How to Run a Free Internal-Link Audit (No Software to Install)',
    description:
      "A step-by-step guide to auditing your site's internal links for free — find orphan pages, weak hubs, and pages buried too deep, with nothing to install.",
    excerpt:
      'You do not need a paid crawler or a desktop install to find the internal-linking problems that quietly suppress your rankings. Here is the whole process, end to end.',
    keywords: ['internal link audit', 'internal link checker', 'free internal link audit', 'internal linking audit'],
    publishedAt: '2026-06-12',
    updatedAt: '2026-06-12',
    readingMinutes: 8,
  },
  {
    slug: 'orphan-pages',
    title: 'Orphan Pages: What They Are, Why They Hurt SEO, and How to Find Them',
    description:
      "Orphan pages have no internal links pointing to them, so search engines rarely crawl or rank them. Here's what causes them and how to find and fix them.",
    excerpt:
      'An orphan page is a page no other page links to. Search engines struggle to find it, users never reach it, and the work that went into it is wasted. Here is how to catch them.',
    keywords: ['orphan pages', 'orphan pages seo', 'find orphan pages', 'what are orphan pages'],
    publishedAt: '2026-06-12',
    updatedAt: '2026-06-12',
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
