import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import type { BlogPostMeta } from '@/lib/blog/posts';
import { formatPostDate } from '@/lib/blog/format';
import { authorPath, getAuthor } from '@/lib/blog/authors';
import { addedQuestions, addedSummary } from '@/lib/blog/answers';
import { JsonLd, faqLd } from '@/lib/seo/jsonld';

export function ArticleLayout({
  meta,
  related,
  children,
}: {
  meta: BlogPostMeta;
  related: readonly BlogPostMeta[];
  children: ReactNode;
}) {
  // A post that names no author, or a slug not in the map, renders exactly as before: no byline.
  const author = meta.author ? getAuthor(meta.author) : null;
  // The answer layer (lib/blog/answers.ts). Each piece renders in its own named container, which
  // __tests__/blog-existing-posts-unchanged.test.tsx sets aside before comparing with the baseline.
  const summary = addedSummary(meta.slug);
  const questions = addedQuestions(meta.slug);
  return (
    <>
      <Header />
      <main className="max-w-2xl mx-auto px-6 pt-16 pb-24">
        <nav className="text-sm text-ink/50 mb-8" aria-label="Breadcrumb">
          <Link href={{ pathname: '/' }} className="hover:text-peach">
            Home
          </Link>
          <span className="mx-2">/</span>
          <Link href={{ pathname: '/blog' }} className="hover:text-peach">
            Blog
          </Link>
        </nav>

        <article>
          <header className="mb-10">
            <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight leading-tight text-ink">
              {meta.title}
            </h1>
            <div className="mt-4 text-sm text-ink/50">
              {author && (
                <>
                  <span>
                    By{' '}
                    <Link
                      href={authorPath(author.slug) as Route}
                      rel="author"
                      className="text-ink/70 hover:text-peach"
                    >
                      {author.name}
                    </Link>
                    <span className="post-author-role">
                      , {author.role} (
                      <a href={author.linkedin} className="hover:text-peach">
                        LinkedIn
                      </a>
                      )
                    </span>
                  </span>
                  <span className="mx-2">·</span>
                </>
              )}
              <time dateTime={meta.publishedAt}>{formatPostDate(meta.publishedAt)}</time>
              {meta.updatedAt && meta.updatedAt !== meta.publishedAt && (
                <>
                  <span className="mx-2">·</span>
                  <time dateTime={meta.updatedAt}>
                    Last updated {formatPostDate(meta.updatedAt)}
                  </time>
                </>
              )}
              <span className="mx-2">·</span>
              <span>{meta.readingMinutes} min read</span>
            </div>
            {summary && (
              <p className="post-summary mt-6 text-lg text-ink/80 leading-relaxed">{summary}</p>
            )}
          </header>
          <div className="article-prose">{children}</div>
          {questions.length > 0 && (
            <section className="post-questions mt-16" aria-labelledby="questions-this-answers">
              <h2
                id="questions-this-answers"
                className="font-display font-semibold text-2xl text-ink"
              >
                Questions this answers
              </h2>
              {questions.map((q) => (
                <div key={q.question} className="mt-6">
                  <h3 className="font-display font-semibold text-lg text-ink">{q.question}</h3>
                  <p className="mt-2 text-ink/70 leading-relaxed">{q.text}</p>
                </div>
              ))}
              <JsonLd
                data={faqLd(questions.map((q) => ({ question: q.question, answer: q.text })))}
              />
            </section>
          )}
        </article>

        <aside className="mt-16 rounded-2xl border border-oat bg-white p-8 text-center">
          <h2 className="font-display font-semibold text-2xl text-ink">
            See how your own internal linking grades
          </h2>
          <p className="mt-2 text-ink/70">
            Crawlmouse crawls your site, maps every internal link, and gives you an A–F grade in
            under two minutes. Free, no install.
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
                  <Link
                    href={`/blog/${p.slug}` as Route}
                    className="text-peach hover:underline font-medium"
                  >
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
