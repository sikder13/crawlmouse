import Link from 'next/link';
import type { Route } from 'next';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { UrlForm } from '@/components/audit/UrlForm';
import { TrackView } from '@/components/analytics/TrackView';
import { ReferralCapture } from '@/components/analytics/ReferralCapture';
import { JsonLd, websiteLd, softwareApplicationLd, faqLd } from '@/lib/seo/jsonld';
import { HOMEPAGE_FAQ } from '@/lib/seo/faq';
import { FeatureCards } from '@/components/home/FeatureCards';

export default function Home() {
  return (
    <>
      <JsonLd data={[websiteLd(), softwareApplicationLd(), faqLd(HOMEPAGE_FAQ)]} />
      <Header />
      <main className="max-w-6xl mx-auto px-6 pt-16 pb-24 sm:pt-24 sm:pb-32">
        <TrackView event="landing-view" />
        <ReferralCapture />
        <section className="text-center max-w-3xl mx-auto">
          <h1 className="font-display font-bold text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-tight text-ink">
            Grade your site&rsquo;s internal linking <span className="text-accent-text">in under 2 minutes.</span>
          </h1>
          <p className="mt-4 sm:mt-5 text-lg text-ink/70">
            Free. No install. Works on any site &mdash; Shopify, WordPress, Webflow, Wix, Squarespace, Framer, Ghost, or custom.
          </p>
          <p className="mt-4 text-base text-ink/60">
            See your site the way AI crawlers do. ChatGPT, Claude, and Perplexity don&rsquo;t run JavaScript &mdash; they read the same raw HTML Crawlmouse grades, the view Google crawls first. Links that need JavaScript are invisible to them.
          </p>
          <div className="mt-8 sm:mt-10 flex justify-center"><UrlForm /></div>
        </section>

        <FeatureCards />

        <section className="mt-20 sm:mt-32 max-w-3xl mx-auto">
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight text-center text-ink">
            Learn the craft
          </h2>
          <p className="mt-4 text-center text-ink/70">
            Practical guides to internal linking, orphan pages, crawl depth, and getting your pages found.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Link href={'/blog/how-deep-is-too-deep-crawl-depth' as Route} className="rounded-card border border-oat bg-white p-4 hover:border-peach transition-colors">
              <span className="font-display font-semibold text-ink">How deep is too deep? Crawl depth explained</span>
            </Link>
            <Link href={'/blog/orphan-pages' as Route} className="rounded-card border border-oat bg-white p-4 hover:border-peach transition-colors">
              <span className="font-display font-semibold text-ink">How to find orphan pages (free)</span>
            </Link>
            <Link href={'/blog/screaming-frog-alternative' as Route} className="rounded-card border border-oat bg-white p-4 hover:border-peach transition-colors">
              <span className="font-display font-semibold text-ink">A free Screaming Frog alternative</span>
            </Link>
            <Link href={'/blog/discovered-currently-not-indexed' as Route} className="rounded-card border border-oat bg-white p-4 hover:border-peach transition-colors">
              <span className="font-display font-semibold text-ink">Fix &ldquo;Discovered &ndash; currently not indexed&rdquo;</span>
            </Link>
            <Link href={'/blog/sitebulb-alternative' as Route} className="rounded-card border border-oat bg-white p-4 hover:border-peach transition-colors">
              <span className="font-display font-semibold text-ink">A free Sitebulb alternative</span>
            </Link>
          </div>
          <div className="mt-6 text-center">
            <Link href="/guides" className="text-peach font-medium hover:underline">Browse all guides &rarr;</Link>
          </div>
        </section>

        <section className="mt-20 sm:mt-32 max-w-3xl mx-auto">
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight text-center text-ink">
            Frequently asked questions
          </h2>
          <dl className="mt-12 divide-y divide-oat">
            {HOMEPAGE_FAQ.map((f) => (
              <div key={f.question} className="py-6">
                <dt className="font-display font-semibold text-lg text-ink">{f.question}</dt>
                <dd className="mt-2 text-ink/70 leading-relaxed">{f.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <Footer />
    </>
  );
}
