import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import type { BlogPostMeta } from '@/lib/blog/posts';
import { formatPostDate } from '@/lib/blog/format';

export function ArticleLayout({
  meta,
  related,
  children,
}: {
  meta: BlogPostMeta;
  related: readonly BlogPostMeta[];
  children: ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="max-w-2xl mx-auto px-6 pt-16 pb-24">
        <nav className="text-sm text-ink/50 mb-8" aria-label="Breadcrumb">
          <Link href={{ pathname: '/' }} className="hover:text-peach">Home</Link>
          <span className="mx-2">/</span>
          <Link href={{ pathname: '/blog' }} className="hover:text-peach">Blog</Link>
        </nav>

        <article>
          <header className="mb-10">
            <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight leading-tight text-ink">
              {meta.title}
            </h1>
            <div className="mt-4 text-sm text-ink/50">
              <time dateTime={meta.publishedAt}>{formatPostDate(meta.publishedAt)}</time>
              <span className="mx-2">·</span>
              <span>{meta.readingMinutes} min read</span>
            </div>
          </header>
          <div className="article-prose">{children}</div>
        </article>

        <aside className="mt-16 rounded-2xl border border-oat bg-white p-8 text-center">
          <h2 className="font-display font-semibold text-2xl text-ink">See how your own internal linking grades</h2>
          <p className="mt-2 text-ink/70">
            Crawlmouse crawls your site, maps every internal link, and gives you an A–F grade in under two minutes.
            Free, no install.
          </p>
          <Link
            href={{ pathname: '/' }}
            className="inline-block mt-5 rounded-xl bg-peach px-6 py-3 font-semibold text-cream hover:opacity-90"
          >
            Audit your site free
          </Link>
        </aside>

        {related.length > 0 && (
          <section className="mt-16">
            <h2 className="font-display font-semibold text-xl text-ink mb-4">Keep reading</h2>
            <ul className="space-y-4">
              {related.map((p) => (
                <li key={p.slug}>
                  <Link href={`/blog/${p.slug}` as Route} className="text-peach hover:underline font-medium">
                    {p.title}
                  </Link>
                  <p className="text-ink/60 text-sm mt-1">{p.excerpt}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
