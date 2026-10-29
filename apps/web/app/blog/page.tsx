import type { Metadata } from 'next';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { postsNewestFirst } from '@/lib/blog/posts';
import { PostCard } from '@/lib/blog/post-card';
import { siteUrl } from '@/lib/site-url';

const DESCRIPTION =
  'Practical, no-fluff guides to internal linking, orphan pages, crawl depth, and the site structure ' +
  'that actually ranks — from the team behind Crawlmouse.';

export const metadata: Metadata = {
  title: { absolute: 'Internal Linking & Site Structure — The Crawlmouse Blog' },
  description: DESCRIPTION,
  alternates: { canonical: '/blog' },
  openGraph: {
    type: 'website',
    title: 'The Crawlmouse blog',
    description: DESCRIPTION,
    url: siteUrl('/blog'),
  },
};

export default function BlogIndex() {
  const posts = postsNewestFirst();
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-16 pb-24">
        <header className="text-center mb-14">
          <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-ink">
            The Crawlmouse blog
          </h1>
          <p className="mt-4 text-lg text-ink/70">
            Practical guides to internal linking, site structure, and the technical SEO that decides
            whether your pages get found.
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
