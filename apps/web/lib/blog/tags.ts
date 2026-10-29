// Post tags. Each tag has its own static page under /blog/ that lists the posts carrying it; /blog
// itself does not filter. A tag's page segment must never equal a post slug (pinned by
// __tests__/blog-research-page.test.tsx), because /blog/<segment> would then name two pages.

export interface Tag {
  slug: string;
  label: string;
  path: string;
}

export const TAGS = {
  research: { slug: 'research', label: 'Research', path: '/blog/research' },
} as const satisfies Record<string, Tag>;

export type BlogTag = keyof typeof TAGS;

/** The tag for a slug, or null. Own keys only. */
export function getTag(slug: string): Tag | null {
  return Object.hasOwn(TAGS, slug) ? TAGS[slug as BlogTag] : null;
}
