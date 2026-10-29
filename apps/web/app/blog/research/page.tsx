import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { postsWithTag } from '@/lib/blog/posts';
import { PostCard } from '@/lib/blog/post-card';
import { TAGS } from '@/lib/blog/tags';
import { JsonLd, breadcrumbLd } from '@/lib/seo/jsonld';
import { siteUrl } from '@/lib/site-url';

// The research tag's page: a static, indexable list of research-tagged posts. It reads no request
// data, so Next prerenders it like /blog.

const TAG = TAGS.research;
const DESCRIPTION =
  'Research from the Crawlmouse team: live tests of how real websites answer AI crawlers, with the source data behind the numbers.';

export const metadata: Metadata = {
  title: TAG.label,
  description: DESCRIPTION,
  alternates: { canonical: TAG.path },
  openGraph: {
    type: 'website',
    title: 'Crawlmouse research',
    description: DESCRIPTION,
    url: siteUrl(TAG.path),
  },
};

export default function ResearchIndex() {
  const posts = postsWithTag(TAG.slug);
  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Blog', path: '/blog' },
          { name: TAG.label, path: TAG.path },
        ])}
      />
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-16 pb-24">
        <nav className="text-sm text-ink/50 mb-8" aria-label="Breadcrumb">
          <Link href={{ pathname: '/' }} className="hover:text-peach">
            Home
          </Link>
          <span className="mx-2">/</span>
          <Link href={{ pathname: '/blog' }} className="hover:text-peach">
            Blog
          </Link>
        </nav>
        <header className="text-center mb-14">
          <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-ink">
            {TAG.label}
          </h1>
          <p className="mt-4 text-lg text-ink/70">
            Live tests of how real websites answer AI crawlers, with the source files behind the
            numbers and what the tests did not measure.
          </p>
        </header>

        <ul className="space-y-10">
          {posts.map((p) => (
            <PostCard key={p.slug} post={p} hideTag={TAG.slug} />
          ))}
        </ul>
      </main>
      <Footer />
    </>
  );
}
