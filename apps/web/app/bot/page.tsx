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

/**
 * Each kind of request a check can send today. Rendering is absent because `NO_DAILY_BUDGET` refuses
 * it; the change that enables it adds its row here. `page.test.tsx` pins the strings and the crawl
 * and control From headers to the worker's identities; `discover.test.ts` and
 * `verification.test.ts` pin those fetchers' headers. `obeysRobots` is checked by review.
 */
const REQUESTS: readonly {
  what: string;
  /** Words before `code`; empty when the user agent is `code` alone. */
  agent: string;
  code: string | null;
  from: boolean;
  obeysRobots: boolean;
}[] = [
  {
    what: 'Finding pages: our audit service reads robots.txt and your sitemap files, at the addresses robots.txt or a sitemap names or at common sitemap paths, plus any redirects they follow, which can be on another host.',
    agent: '',
    code: CRAWL_USER_AGENT,
    from: false,
    obeysRobots: false,
  },
  {
    what: 'Reading robots.txt: the crawler reads it itself, plus any redirects it follows, which can be on another host, unless it holds a recent copy.',
    agent: '',
    code: CRAWL_USER_AGENT,
    from: true,
    obeysRobots: false,
  },
  {
    what: 'Page requests, and checks for site files such as /llms.txt, /.well-known/mcp and /sitemap.xml.',
    agent: '',
    code: CRAWL_USER_AGENT,
    from: true,
    obeysRobots: true,
  },
  {
    what: 'AI crawler tests, on a sample of pages, from Crawlmouse’s own address and not the crawler’s.',
    agent:
      'the crawler’s published user agent, or just its name where its operator publishes none, followed by',
    code: CRAWLER_TAG,
    from: true,
    obeysRobots: true,
  },
  {
    what: 'A comparison request for each sampled page robots.txt lets us request, plus any redirects it follows, to tell a rule about one crawler from a site that refuses all automation.',
    agent: 'an ordinary browser user agent, with no Crawlmouse tag',
    code: null,
    from: false,
    obeysRobots: true,
  },
  {
    what: 'When a crawler test is refused, possibly one more request, plus any redirects it follows, to see whether the site checks crawler addresses. It never produces a Googlebot result.',
    agent: 'Googlebot’s user agent, followed by',
    code: CRAWLER_TAG,
    from: true,
    obeysRobots: true,
  },
  {
    what: 'When someone verifies ownership of a domain with a meta tag, a request for its homepage, plus any redirects it follows.',
    agent: 'CrawlmouseBot, our earlier name',
    code: null,
    from: false,
    obeysRobots: false,
  },
];

export default function BotPage() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-20 pb-32">
        <h1 className="font-display font-bold text-5xl tracking-tight">CrawlmouseBot</h1>
        <p className="mt-4 text-lg text-ink/70">
          Hi &mdash; if you&rsquo;re reading this, you probably saw{' '}
          <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">Crawlmouse/2.0</code> or{' '}
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
              page requests, site-file checks and crawler tests. The list below says which requests
              do not depend on it.
            </li>
            <li>
              Max 8 concurrent requests per host &mdash; we stay polite with bounded concurrency,
              not aggressive bursts.
            </li>
            <li>We back off immediately on 429 (rate-limited) or 503 responses.</li>
            <li>HTTP only, no headless browser, no cookie persistence.</li>
          </ul>
          <h3 className="font-display font-bold text-xl mt-6 mb-3">The requests we send</h3>
          <ul className="space-y-4 text-ink/80 list-disc pl-5">
            {REQUESTS.map((r) => (
              <li key={r.what}>
                <div>{r.what}</div>
                <div>
                  User-Agent: {r.agent}
                  {r.agent && r.code ? ' ' : null}
                  {r.code ? (
                    <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded break-all">
                      {r.code}
                    </code>
                  ) : null}
                </div>
                <div>
                  {r.from ? (
                    <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">
                      {FROM_HEADER}: {FROM_ADDRESS}
                    </code>
                  ) : (
                    `No ${FROM_HEADER} header.`
                  )}
                </div>
                <div>{r.obeysRobots ? 'Obeys robots.txt.' : 'Does not depend on robots.txt.'}</div>
              </li>
            ))}
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
