import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { authorPath, getAuthor, personLd, publishedAuthors, type Author } from '@/lib/blog/authors';
import { postsByAuthor } from '@/lib/blog/posts';
import { PostCard } from '@/lib/blog/post-card';
import { JsonLd } from '@/lib/seo/jsonld';
import { siteUrl } from '@/lib/site-url';

// /authors/<slug>: one page per author that at least one post names. An author with no posts yet
// has no page (404), so no empty profile is indexed; the page appears with their first post.

export const dynamicParams = false;

export function generateStaticParams() {
  return publishedAuthors().map((a) => ({ slug: a.slug }));
}

/** The author for a page, only when they have a post. */
function pageAuthor(slug: string): Author | null {
  const author = getAuthor(slug);
  return author && postsByAuthor(author.slug).length > 0 ? author : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const author = pageAuthor(slug);
  if (!author) return {};
  const path = authorPath(author.slug);
  const description = `Posts by ${author.name}, ${author.role}, on the Crawlmouse blog.`;
  return {
    title: author.name,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'profile', title: author.name, description, url: siteUrl(path) },
  };
}

export default async function AuthorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const author = pageAuthor(slug);
  if (!author) notFound();
  const posts = postsByAuthor(author.slug);

  return (
    <>
      <JsonLd data={{ '@context': 'https://schema.org', ...personLd(author) }} />
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-16 pb-24">
        <header className="text-center mb-14">
          <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-ink">
            {author.name}
          </h1>
          <p className="mt-4 text-lg text-ink/70">{author.role}</p>
          <p className="mt-2 text-sm">
            <a
              href={author.linkedin}
              rel="me noopener"
              className="font-medium text-ink/60 hover:text-peach"
            >
              LinkedIn
            </a>
          </p>
        </header>

        <ul className="space-y-10">
          {posts.map((p) => (
            <PostCard key={p.slug} post={p} />
          ))}
        </ul>
      </main>
      <Footer />
    </>
  );
}
