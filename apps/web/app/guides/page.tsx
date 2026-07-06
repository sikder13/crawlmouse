import Link from 'next/link';
import type { Route } from 'next';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { POSTS_BY_SLUG } from '@/lib/blog/posts';

export const metadata = {
  title: 'Guides — Internal Linking, Crawl Depth & Getting Found',
  description:
    'Practical guides to internal linking, orphan pages, crawl depth, and getting your pages crawled and indexed — free tools and honest, no-hype advice.',
  alternates: { canonical: '/guides' },
};

// Curated topic clusters. Each post appears once, in its primary cluster.
// When a new post ships, add its slug to the relevant cluster here.
const CLUSTERS: ReadonlyArray<{ title: string; blurb: string; slugs: readonly string[] }> = [
  {
    title: 'Internal linking, start here',
    blurb: 'What internal linking is, how to audit it, and the orphan pages that quietly waste your work.',
    slugs: ['free-internal-link-audit', 'orphan-pages'],
  },
  {
    title: 'Crawl depth & site architecture',
    blurb: 'How far your pages sit from the homepage, why it matters, and how to pull the important ones up.',
    slugs: ['crawl-depth-site-architecture', 'how-deep-is-too-deep-crawl-depth'],
  },
  {
    title: 'Orphan pages by platform',
    blurb: 'The platform-specific traps that strand pages — and how to find every orphan on WordPress, Shopify, and Webflow.',
    slugs: ['find-orphan-pages-wordpress', 'find-orphan-pages-shopify', 'find-orphan-pages-webflow'],
  },
  {
    title: 'Free tool alternatives',
    blurb: 'When a paid desktop crawler is more than you need for an internal-linking read — and what to use instead.',
    slugs: ['screaming-frog-alternative', 'sitebulb-alternative', 'sitebulb-vs-screaming-frog'],
  },
  {
    title: 'Indexing & getting found',
    blurb: 'Why Google skips your pages, and the internal-linking fixes that get them crawled and indexed.',
    slugs: ['discovered-currently-not-indexed', 'can-ai-crawlers-see-javascript'],
  },
];

/** /guides — the pillar hub. Links from the homepage + header nav; links down to every guide. */
export default function GuidesPage() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-16 pb-32 sm:pt-20">
        <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-ink">Guides</h1>
        <p className="mt-4 text-lg text-ink/70 leading-relaxed">
          Everything we&rsquo;ve written about internal linking, orphan pages, crawl depth, and getting your
          pages found &mdash; grouped by what you&rsquo;re trying to do. Plain, honest, and free. When
          you&rsquo;re ready, <Link href={{ pathname: '/' }} className="text-peach underline">grade your own
          site</Link>.
        </p>

        {CLUSTERS.map((cluster) => {
          const posts = cluster.slugs
            .map((slug) => POSTS_BY_SLUG.get(slug))
            .filter((p): p is NonNullable<typeof p> => Boolean(p));
          if (posts.length === 0) return null;
          return (
            <section key={cluster.title} className="mt-14">
              <h2 className="font-display font-semibold text-2xl text-ink">{cluster.title}</h2>
              <p className="mt-2 text-ink/60 leading-relaxed">{cluster.blurb}</p>
              <div className="mt-5 space-y-3">
                {posts.map((post) => (
                  <Link key={post.slug} href={`/blog/${post.slug}` as Route} className="block">
                    <Card interactive>
                      <div className="font-display font-semibold text-lg text-ink">{post.title}</div>
                      <div className="mt-1 text-ink/60 leading-relaxed">{post.description}</div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        <div className="mt-16 border-t border-oat pt-10 text-center">
          <p className="font-display font-semibold text-xl text-ink">See where your own site stands</p>
          <p className="mt-2 text-ink/60">A free grade in under two minutes &mdash; no account, no install.</p>
          <div className="mt-5">
            <Link
              href={{ pathname: '/' }}
              className="inline-block rounded-full bg-peach px-6 py-3 font-medium text-white transition-colors hover:bg-peach/90"
            >
              Grade my site
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
