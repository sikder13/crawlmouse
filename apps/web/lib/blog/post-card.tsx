import Link from 'next/link';
import type { Route } from 'next';
import type { BlogPostMeta } from './posts';
import { formatPostDate } from './format';
import { getTag, type Tag } from './tags';

// One post in a list: /blog, a tag page, an author page. The card link's markup is the one /blog has
// always rendered: its static markup is pinned by __tests__/blog-existing-posts-unchanged.test.tsx, and
// the date line keeps the base's text nodes so the served HTML keeps the same hydration markers. A post
// with tags also gets plain links to its tag pages, placed after the card link rather than inside
// it, because an <a> inside an <a> is invalid HTML.

export function PostCard({ post, hideTag }: { post: BlogPostMeta; hideTag?: string }) {
  const tags = (post.tags ?? [])
    .filter((t) => t !== hideTag)
    .map((t) => getTag(t))
    .filter((t): t is Tag => t !== null);
  return (
    <li className="border-b border-oat pb-10 last:border-b-0">
      <Link href={`/blog/${post.slug}` as Route} className="group block">
        <h2 className="font-display font-semibold text-2xl text-ink transition-colors group-hover:text-peach">
          {post.title}
        </h2>
        <div className="mt-2 text-sm text-ink/50">
          <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>
          {' · '}
          {post.readingMinutes} min read
        </div>
        <p className="mt-3 text-ink/70 leading-relaxed">{post.excerpt}</p>
        <span className="mt-3 inline-block font-medium text-peach">Read more →</span>
      </Link>
      {tags.length > 0 && (
        <p className="mt-3 flex gap-3 text-sm">
          {tags.map((t) => (
            <Link
              key={t.slug}
              href={t.path as Route}
              className="font-medium text-ink/60 hover:text-peach"
            >
              {t.label}
            </Link>
          ))}
        </p>
      )}
    </li>
  );
}
