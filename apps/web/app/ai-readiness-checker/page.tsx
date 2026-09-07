import Link from 'next/link';
import type { Route } from 'next';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { UrlForm } from '@/components/audit/UrlForm';
import { TrackView } from '@/components/analytics/TrackView';
import { ReferralCapture } from '@/components/analytics/ReferralCapture';
import { JsonLd, webPageLd, faqLd } from '@/lib/seo/jsonld';
import type { FaqItem } from '@/lib/seo/faq';

const TITLE = 'Free AI Readiness Checker — Whole-Site Test';
const DESCRIPTION =
  'Check whether ChatGPT, Claude, and Perplexity can find and read your website. A free, whole-site ' +
  'AI readiness score with the exact reasons and fixes.';

// Rendered BOTH as visible content and as the FAQPage JSON-LD below, from this one source — Google
// requires the structured data to match what is on the page.
const FAQ: readonly FaqItem[] = [
  {
    question: 'What is an AI readiness check?',
    answer:
      'It’s a test of whether AI systems — ChatGPT, Claude, Perplexity, and the crawlers behind them — can find, access, and read your website’s content. It covers crawler permissions, whether your content exists without JavaScript, machine-readable structure, and whether readable pages are linked so they can be reached.',
  },
  {
    question: 'What does my AI readiness score mean?',
    answer:
      'The 0–100 score measures discoverability: how much of your site AI crawlers are allowed to reach, can read without JavaScript, can parse for meaning, and can arrive at through links. The four components are weighted by impact, with content-without-JavaScript the heaviest at 40% — because a page AI can’t read fails regardless of everything else.',
  },
  {
    question: 'Does a good score mean AI will recommend my business?',
    answer:
      'No, and be wary of any tool that says otherwise. A good score means AI systems can read your site — which is the necessary first step. What they do with readable content depends on factors no auditor controls. A bad score, though, reliably means you’re invisible.',
  },
  {
    question: 'Which AI crawlers does it check?',
    answer:
      'The access matrix covers the major AI crawler tokens, including OpenAI’s, Anthropic’s, Perplexity’s, Google-Extended, Applebot-Extended, Meta’s, Amazon’s, and Common Crawl’s — and distinguishes retrieval crawlers (fetching pages to answer a live question) from training crawlers.',
  },
  {
    question: 'Is it really free?',
    answer:
      'Yes — the whole-site check, the score, and one complete fix, free forever, no signup. Paid plans exist for people who want every fix and client-ready reports; the check itself isn’t a teaser.',
  },
];

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/ai-readiness-checker' },
  robots: { index: true, follow: true },
};

export default function AiReadinessCheckerPage() {
  return (
    <>
      {/* WebPage + FAQPage only. SoftwareApplication is emitted once, on the homepage; a second copy
          here would claim the same product twice. */}
      <JsonLd
        data={[
          webPageLd({ name: TITLE, description: DESCRIPTION, path: '/ai-readiness-checker' }),
          faqLd(FAQ),
        ]}
      />
      <Header />
      <main className="max-w-6xl mx-auto px-6 pt-16 pb-24 sm:pt-24 sm:pb-32">
        <TrackView event="landing-view" />
        <ReferralCapture />

        <section className="text-center max-w-3xl mx-auto">
          <h1 className="font-display font-bold text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-tight text-ink">
            AI Readiness Checker
          </h1>
          <p className="mt-4 sm:mt-5 text-lg text-ink/70">
            Test whether AI can actually see your website. Paste your URL and Crawlmouse crawls your whole
            site the way AI crawlers do &mdash; no JavaScript, no mercy &mdash; then returns a 0&ndash;100
            AI-Readiness score with the exact reasons behind it and what to fix. Free, no signup, and the
            same site gets the same score every time.
          </p>
          {/* The homepage's audit input, imported unchanged: submitting here behaves exactly as it
              does on the homepage. */}
          <div className="mt-8 sm:mt-10 flex justify-center"><UrlForm /></div>
        </section>

        <section className="mt-20 sm:mt-28 max-w-3xl mx-auto">
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight text-ink">How it works</h2>
          <ol className="mt-6 space-y-4 list-decimal pl-6 text-ink/70 leading-relaxed">
            <li>
              <strong className="text-ink">Enter your URL.</strong> No account, no email. The check starts
              immediately.
            </li>
            <li>
              <strong className="text-ink">We crawl your whole site &mdash; not one page.</strong> The crawler
              reads your site the way the bots behind ChatGPT, Claude, and Perplexity do: raw pages, no
              JavaScript, following your internal links to see what&rsquo;s actually reachable.
            </li>
            <li>
              <strong className="text-ink">You get a score with reasons, not just a number.</strong> The
              0&ndash;100 AI readiness score, what&rsquo;s holding it down, page by page, and a complete fix
              in plain language.
            </li>
          </ol>
          <p className="mt-6 text-ink/70 leading-relaxed">
            Most AI readiness tests scan a single URL against a checklist. A single page can pass every check
            while half the site sits unreachable or unreadable behind it &mdash; whole-site is the difference
            between a spot check and an answer.
          </p>
        </section>

        <section className="mt-20 sm:mt-28 max-w-3xl mx-auto">
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight text-ink">
            What the check measures
          </h2>
          <p className="mt-6 text-ink/70 leading-relaxed">
            Your score is built from four measured components, each weighted by how much it actually affects
            whether AI systems can use your site:
          </p>
          <p className="mt-6 text-ink/70 leading-relaxed">
            <strong className="text-ink">Can AI read your content without JavaScript? (40% of the score.)</strong>{' '}
            The crawlers behind ChatGPT, Claude, and Perplexity don&rsquo;t run JavaScript &mdash; a
            Vercel/MERJ study of more than 500 million crawler visits found zero cases of it. If your pages
            only fill in after the browser does its work, AI sees a blank shell. This is the single biggest
            reason sites that rank fine on Google are{' '}
            <Link href={'/blog/can-ai-crawlers-see-javascript' as Route} className="text-peach underline">
              invisible to AI
            </Link>
            , and it&rsquo;s why it carries the most weight.
          </p>
          <p className="mt-6 text-ink/70 leading-relaxed">
            <strong className="text-ink">Are AI crawlers allowed in? (25%.)</strong> We read your served
            robots.txt and build a per-crawler access matrix across the AI bots that matter &mdash; GPTBot,
            ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended, Meta&rsquo;s, Amazon&rsquo;s, and
            Common Crawl&rsquo;s &mdash; separating the crawlers that fetch pages to answer live questions
            from the ones that collect training data. We also tell you when an edge or CDN layer is detected
            that could override whatever robots.txt says: across the sites audited on Crawlmouse, roughly one
            in three has one. That layer became a lot more important when{' '}
            <Link
              href={'/blog/cloudflare-ai-crawler-defaults-september-15' as Route}
              className="text-peach underline"
            >
              Cloudflare changed its default AI-crawler settings on September 15
            </Link>
            .
          </p>
          <p className="mt-6 text-ink/70 leading-relaxed">
            <strong className="text-ink">Is your content structured for machines? (20%.)</strong> Titles,
            headings, metadata, structured data &mdash; whether a machine reading the raw page can tell what
            it&rsquo;s about.
          </p>
          <p className="mt-6 text-ink/70 leading-relaxed">
            <strong className="text-ink">Can readable pages actually be reached? (15%.)</strong> A readable
            page that nothing links to might as well not exist. The checker follows your internal links the
            way a crawler does and scores whether your content is reachable, not just present.
          </p>
          <p className="mt-6 text-ink/70 leading-relaxed">
            On top of the score, the report checks whether you serve an llms.txt file and shows you{' '}
            <strong className="text-ink">What AI Sees</strong> &mdash; your page stripped to the raw text an
            AI crawler actually gets. That view tends to end arguments quickly.
          </p>
        </section>

        <section className="mt-20 sm:mt-28 max-w-3xl mx-auto">
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight text-ink">
            What makes this checker different
          </h2>
          <p className="mt-6 text-ink/70 leading-relaxed">
            Every other AI readiness test we&rsquo;ve found scans one page at a time, or asks chatbots
            &ldquo;was this brand mentioned?&rdquo; over and over. Page checkers are fast but can&rsquo;t see
            your site&rsquo;s structure &mdash; and structure is where content goes missing. Mention trackers
            measure the outcome, give a different answer every run, and can&rsquo;t tell you <em>why</em>
            {' '}you&rsquo;re not being read.
          </p>
          <p className="mt-6 text-ink/70 leading-relaxed">
            Crawlmouse checks the whole site, returns the same score for the same site every time, and tells
            you the specific reason a page can&rsquo;t be found or read &mdash; then points at the fix. It
            measures discoverability honestly: no tool can promise you AI &ldquo;rankings,&rdquo; and this one
            doesn&rsquo;t pretend to.
          </p>
        </section>

        <section className="mt-20 sm:mt-28 max-w-3xl mx-auto">
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight text-ink">
            What you get, free
          </h2>
          <p className="mt-6 text-ink/70 leading-relaxed">
            The full crawl, the AI-Readiness score with all four components, the per-crawler access matrix,
            What AI Sees for your homepage, and one complete fix written in plain language.{' '}
            <Link href={'/pricing' as Route} className="text-peach underline">
              Pro
            </Link>{' '}
            adds every fix, the whole-site What AI Sees simulator, copy-paste fix packets, the llms.txt
            generator, CSV export, and reports you can put your own brand on &mdash; most useful if
            you&rsquo;re checking client sites.
          </p>
        </section>

        <section className="mt-20 sm:mt-28 max-w-3xl mx-auto">
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight text-ink">
            Frequently asked questions
          </h2>
          <dl className="mt-8 divide-y divide-oat">
            {FAQ.map((f) => (
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
