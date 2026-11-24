import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { CRAWLER_TAG, CRAWL_USER_AGENT, FROM_ADDRESS, FROM_HEADER } from '@/lib/v2/help/pinned';

export const metadata = {
  title: 'CrawlmouseBot — about our crawler',
  description:
    'What CrawlmouseBot is, how it crawls, and how to block it or request a report takedown. We respect robots.txt and crawl gently.',
  alternates: { canonical: '/bot' },
};

export default function BotPage() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-20 pb-32">
        <h1 className="font-display font-bold text-5xl tracking-tight">CrawlmouseBot</h1>
        <p className="mt-4 text-lg text-ink/70">
          Hi &mdash; if you&rsquo;re reading this, you probably saw{' '}
          <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">Crawlmouse/2.0</code> or
          <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">CrawlmouseBot</code> in
          your access logs.
        </p>
        <Card className="mt-10">
          <h2 className="font-display font-bold text-2xl mb-3">What is it?</h2>
          <p className="text-ink/80 leading-relaxed">
            Crawlmouse is a free internal-linking grading service. When someone enters a URL on{' '}
            <a href="/" className="text-peach underline">
              crawlmouse.com
            </a>
            , our bot crawls a small portion of that site (up to 500 pages on the free tier) to
            build a map of internal links.
          </p>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">How we crawl</h2>
          <ul className="space-y-2 text-ink/80 list-disc pl-5">
            <li>
              We obey{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">robots.txt</code> for
              page requests and crawler tests. Reading robots.txt and sitemaps to find pages, and
              the domain-verification check, do not depend on it.
            </li>
            <li>
              Max 8 concurrent requests per host &mdash; we stay polite with bounded concurrency,
              not aggressive bursts.
            </li>
            <li>We back off immediately on 429 (rate-limited) or 503 responses.</li>
            <li>
              To find pages, we first read robots.txt and sitemap files with the User-Agent below
              and no{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">{FROM_HEADER}</code>{' '}
              header.
            </li>
            <li>
              Our page requests send the User-Agent{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded break-all">
                {CRAWL_USER_AGENT}
              </code>{' '}
              and the header{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">
                {FROM_HEADER}: {FROM_ADDRESS}
              </code>
              .
            </li>
            <li>
              To test what an AI crawler is served, we request a sample of pages with that
              crawler&rsquo;s published user agent, or just its name where its operator publishes
              none, followed by{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded break-all">
                {CRAWLER_TAG}
              </code>
              , and the same{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">{FROM_HEADER}</code>{' '}
              header. These requests come from Crawlmouse&rsquo;s own address, not the
              crawler&rsquo;s.
            </li>
            <li>
              When a crawler test is refused, we may send one more tagged request (plus any
              redirects it follows) with Googlebot&rsquo;s user agent, to see whether the site
              checks crawler addresses. It never produces a Googlebot result.
            </li>
            <li>
              For each sampled page robots.txt lets us request, we first send one comparison request
              (plus any redirects it follows) with an ordinary browser user agent, with no
              Crawlmouse tag and no{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">{FROM_HEADER}</code>{' '}
              header, to tell a rule about one crawler from a site that refuses all automation.
            </li>
            <li>
              When someone verifies ownership of a domain with a meta tag, we request its homepage
              under our earlier name,{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">CrawlmouseBot</code>,
              with no{' '}
              <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">{FROM_HEADER}</code>{' '}
              header.
            </li>
            <li>HTTP only, no headless browser, no cookie persistence.</li>
          </ul>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">Block us?</h2>
          <p className="text-ink/80 leading-relaxed mb-3">
            Add this to your{' '}
            <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">robots.txt</code>:
          </p>
          <pre className="bg-ink text-cream font-mono text-sm p-4 rounded-lg">{`User-agent: CrawlmouseBot
Disallow: /`}</pre>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">
            Takedown a report about your site
          </h2>
          <p className="text-ink/80 leading-relaxed">
            We don&rsquo;t generate public reports without explicit domain-ownership verification.
            If you found one anyway, send the public URL plus a quick description to{' '}
            <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">
              takedown@crawlmouse.com
            </code>
            .
          </p>
        </Card>
      </main>
      <Footer />
    </>
  );
}
