import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { UrlForm } from '@/components/audit/UrlForm';
import { TrackView } from '@/components/analytics/TrackView';

export default function Home() {
  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-6 pt-24 pb-32">
        <TrackView event="landing-view" />
        <section className="text-center max-w-3xl mx-auto">
          <h1 className="font-display font-bold text-5xl sm:text-6xl tracking-tight leading-tight text-ink">
            Grade your store&rsquo;s internal linking <span className="text-peach">in under 2 minutes.</span>
          </h1>
          <p className="mt-5 text-lg text-ink/70">
            Free. No install. Works on any site &mdash; Shopify, WordPress, Webflow, Wix, Squarespace, Framer, Ghost, or custom.
          </p>
          <div className="mt-10 flex justify-center"><UrlForm /></div>
        </section>

        <section className="mt-32 grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {[
            { t: 'Live link graph', d: 'Watch your site take shape as the crawler runs. Beautiful enough to share before the grade lands.' },
            { t: 'A–F letter grade', d: 'One score, four components: orphans, depth, anchor diversity, structure quality.' },
            { t: 'Peer benchmarks', d: 'See how you compare to thousands of similar sites — sharper with every crawl.' },
          ].map((b) => (
            <div key={b.t} className="bg-white border border-oat rounded-2xl p-6">
              <h3 className="font-display font-semibold text-xl mb-2">{b.t}</h3>
              <p className="text-ink/70 text-sm leading-relaxed">{b.d}</p>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </>
  );
}
