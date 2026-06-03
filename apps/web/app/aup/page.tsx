import { LegalPage } from '@/components/legal/LegalPage';
import { DraftBanner } from '@/components/legal/DraftBanner';

export const metadata = {
  title: 'Acceptable Use — Crawlmouse',
};

export default function AupPage() {
  return (
    <LegalPage title="Acceptable Use">
      <DraftBanner />

      <p className="text-ink/60">Last updated: 2026-06-03</p>

      <p>
        Crawlmouse crawls real websites, so we hold everyone to a few clear rules. This policy is part
        of our <a className="text-peach underline" href="/terms">Terms of Service</a>.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Prohibited uses</h2>
      <p>You may not use Crawlmouse to:</p>
      <ul className="list-disc pl-6 space-y-2">
        <li>Audit sites you don&rsquo;t own in order to attack, overload, or harm them.</li>
        <li>Bypass or attempt to bypass our rate limits, Turnstile challenges, or other protections.</li>
        <li>
          Submit non-HTTP targets, or internal, private, or loopback addresses (we block these to
          prevent server-side request forgery).
        </li>
        <li>Scrape, resell, sublicense, or repackage the service or its output as your own product.</li>
        <li>Publish a public report for a domain you have not verified you own.</li>
        <li>Harass others or abuse the takedown form (for example, filing false takedown requests).</li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Crawler etiquette we follow</h2>
      <p>
        We hold ourselves to the same standard. Our crawler respects <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">robots.txt</code>,
        caps concurrency per host, backs off on 429/503 responses, and identifies itself with a clear
        User-Agent. The full details are on our{' '}
        <a className="text-peach underline" href="/bot">crawler page</a>.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Enforcement</h2>
      <p>
        If we believe you&rsquo;ve violated this policy we may throttle your requests, suspend or
        terminate your account, and remove any public reports involved &mdash; with or without notice,
        depending on the severity and the risk to others.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Reporting abuse</h2>
      <p>
        If you see Crawlmouse being misused, or a public report about a domain you own that
        shouldn&rsquo;t exist, tell us. Email{' '}
        <a className="text-peach underline" href="mailto:abuse@crawlmouse.com">abuse@crawlmouse.com</a>{' '}
        or use the <a className="text-peach underline" href="/takedown">takedown form</a>.
      </p>
    </LegalPage>
  );
}
