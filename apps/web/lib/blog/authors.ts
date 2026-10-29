import { siteUrl } from '../site-url';
import { POSTS, type BlogPostMeta } from './posts';

// The people who write for the blog. A post names one by slug (`BlogPostMeta.author`); a post that
// names nobody keeps the Organization author it has always had. An author gets a page at
// /authors/<slug> once at least one post names them (`publishedAuthors`), so no empty profile page
// is published.

export interface Author {
  slug: string;
  name: string;
  /** Shown under the name and emitted as the Person's jobTitle. */
  role: string;
  /** Emitted as the Person's sameAs. */
  linkedin: string;
}

export const AUTHORS = {
  'udaay-sikder': {
    slug: 'udaay-sikder',
    name: 'Udaay Sikder',
    role: 'Co-founder, Nahl Technologies',
    linkedin: 'https://www.linkedin.com/in/udaaysikder/',
  },
  'samia-zaman': {
    slug: 'samia-zaman',
    name: 'Samia Zaman',
    role: 'Growth, Nahl Technologies',
    linkedin: 'https://www.linkedin.com/in/samiazaman/',
  },
} as const satisfies Record<string, Author>;

export type AuthorSlug = keyof typeof AUTHORS;

/** The author for a slug, or null. Own keys only: `__proto__` or `toString` is not an author. */
export function getAuthor(slug: string): Author | null {
  return Object.hasOwn(AUTHORS, slug) ? AUTHORS[slug as AuthorSlug] : null;
}

export function authorPath(slug: string): string {
  return `/authors/${slug}`;
}

/** schema.org Person, for an Article's `author` and for the author page. */
export function personLd(author: Author) {
  return {
    '@type': 'Person' as const,
    name: author.name,
    url: siteUrl(authorPath(author.slug)),
    sameAs: [author.linkedin],
    jobTitle: author.role,
  };
}

/** Authors named by at least one post, in the map's order. These are the ones with a page. */
export function publishedAuthors(posts: readonly BlogPostMeta[] = POSTS): Author[] {
  const named = new Set(posts.map((p) => p.author));
  return Object.values(AUTHORS).filter((a) => named.has(a.slug));
}
