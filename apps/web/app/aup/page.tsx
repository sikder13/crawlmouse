import { LegalPage } from '@/components/legal/LegalPage';

export const metadata = {
  title: 'Acceptable Use — Crawlmouse',
};

export default function AupPage() {
  return (
    <LegalPage title="Acceptable Use">
      <p className="text-ink/60">Last updated: 2026-06-07 &middot; Version 1.0</p>

      <p>
        Crawlmouse crawls real websites on your instruction, so we hold everyone to a few clear rules.
        This Acceptable Use Policy is part of our{' '}
        <a className="text-peach underline" href="/terms">Terms of Service</a>; breaking it is a breach of
        those Terms.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Crawl only what you&rsquo;re allowed to</h2>
      <p>
        You may only submit a site for auditing if you <strong className="font-semibold">own it or are
        otherwise authorized</strong> to direct a crawl of it, and doing so does not violate the
        site&rsquo;s terms, any law, or anyone&rsquo;s rights.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Prohibited uses</h2>
      <p>You may not use Crawlmouse to:</p>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          Crawl <strong className="font-semibold">non-public, password-protected, login-gated, paywalled,
          or otherwise access-restricted content</strong>, or submit anyone&rsquo;s credentials.
        </li>
        <li>
          Bypass or <strong className="font-semibold">circumvent</strong> our rate limits, Turnstile
          challenges, or other protections &mdash; or a target site&rsquo;s technical access controls,
          IP blocks, or CAPTCHAs.
        </li>
        <li>
          Submit non-HTTP targets, or internal, private, or loopback addresses (we block these to prevent
          server-side request forgery).
        </li>
        <li>Audit sites in order to attack, overload, harass, surveil, or otherwise harm them or their owners.</li>
        <li>Scrape, resell, sublicense, or repackage the service or its output as your own product.</li>
        <li>
          Publish a public report for a domain you have not verified you own, or spoof or tamper with
          domain verification.
        </li>
        <li>Collect or process personal data unlawfully, or violate anyone&rsquo;s privacy rights.</li>
        <li>Harass others or abuse the takedown form (for example, filing false takedown requests).</li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Crawler etiquette we follow</h2>
      <p>
        We hold ourselves to the same standard. Our crawler requests only public pages while logged out,
        respects <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">robots.txt</code>, caps
        concurrency per host, backs off on 429/503 responses, identifies itself with a clear User-Agent,
        and stores derived structural data rather than copies of page content. We honor site-owner
        opt-out requests. The full details are on our{' '}
        <a className="text-peach underline" href="/bot">crawler page</a>.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Enforcement</h2>
      <p>
        If we believe you&rsquo;ve violated this policy we may throttle your requests, suspend or
        terminate your account, block specific domains, and remove any public reports involved &mdash;
        with or without notice, depending on the severity and the risk to others.
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
