import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';

export const metadata = {
  title: 'CrawlmouseBot — about our crawler',
};

export default function BotPage() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-20 pb-32">
        <h1 className="font-display font-bold text-5xl tracking-tight">CrawlmouseBot</h1>
        <p className="mt-4 text-lg text-ink/70">
          Hi &mdash; if you&rsquo;re reading this, you probably saw <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">CrawlmouseBot/1.0</code> in your access logs.
        </p>
        <Card className="mt-10">
          <h2 className="font-display font-bold text-2xl mb-3">What is it?</h2>
          <p className="text-ink/80 leading-relaxed">
            Crawlmouse is a free internal-linking grading service. When someone enters a URL on{' '}
            <a href="/" className="text-peach underline">crawlmouse.com</a>, our bot crawls a small portion of that site (up to 500 pages on the free tier) to build a map of internal links.
          </p>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">How we crawl</h2>
          <ul className="space-y-2 text-ink/80 list-disc pl-5">
            <li>We respect <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">robots.txt</code> on every request.</li>
            <li>Max 8 concurrent requests per host with 250ms inter-request stagger.</li>
            <li>We back off immediately on 429 (rate-limited) or 503 responses.</li>
            <li>User-Agent: <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)</code></li>
            <li>HTTP only, no headless browser, no cookie persistence.</li>
          </ul>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">Block us?</h2>
          <p className="text-ink/80 leading-relaxed mb-3">Add this to your <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">robots.txt</code>:</p>
          <pre className="bg-ink text-cream font-mono text-sm p-4 rounded-lg">{`User-agent: CrawlmouseBot
Disallow: /`}</pre>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">Takedown a report about your site</h2>
          <p className="text-ink/80 leading-relaxed">
            We don&rsquo;t generate public reports without explicit domain-ownership verification. If you found one anyway, send the public URL plus a quick description to <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">takedown@crawlmouse.com</code>.
          </p>
        </Card>
      </main>
      <Footer />
    </>
  );
}
