import { LegalPage } from '@/components/legal/LegalPage';
import { DraftBanner } from '@/components/legal/DraftBanner';

export const metadata = {
  title: 'Privacy Policy — Crawlmouse',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <DraftBanner />

      <p className="text-ink/60">Last updated: 2026-06-03</p>

      <p>
        Crawlmouse grades the internal-linking structure of websites. This policy explains what
        personal data we collect, why, and the choices you have. We&rsquo;ve written it in plain
        language; if anything is unclear, email{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Data we collect</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          <strong className="font-semibold">Account email.</strong> We sign you in with a magic link,
          so we store your email address to send that link and to identify your account. We do not
          store passwords because there are none.
        </li>
        <li>
          <strong className="font-semibold">URLs you submit and audit results.</strong> When you run
          an audit we crawl the public pages of the site you submitted and store the resulting
          structural data &mdash; the pages we found, their internal links, anchor text, and the
          computed grade. This is public structural data, not your private content.
        </li>
        <li>
          <strong className="font-semibold">Billing data (held by Stripe).</strong> Pro subscriptions
          are processed by Stripe. We never see or store your full card number &mdash; Stripe handles
          card data directly. We keep only billing identifiers (a Stripe customer ID and subscription
          status) so we can tell whether your account is on Pro.
        </li>
        <li>
          <strong className="font-semibold">Product analytics.</strong> We use PostHog to understand
          how the product is used (for example, which steps of the audit flow people complete).
        </li>
        <li>
          <strong className="font-semibold">Error telemetry.</strong> We use Sentry to capture errors
          so we can fix them. Error reports can include technical context such as the request path and
          a stack trace.
        </li>
        <li>
          <strong className="font-semibold">Anti-abuse signals.</strong> To stop bots and abuse we use
          Cloudflare Turnstile and basic rate limiting, which process your IP address and a challenge
          token.
        </li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Legal bases (GDPR Article 6)</h2>
      <p>If you are in the EU/UK, we rely on the following lawful bases:</p>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          <strong className="font-semibold">Contract (Art. 6(1)(b)).</strong> To create your account,
          run the audits you request, and provide the paid Pro service.
        </li>
        <li>
          <strong className="font-semibold">Legitimate interests (Art. 6(1)(f)).</strong> To keep the
          service secure and prevent abuse (Turnstile, rate limiting), to fix errors, and to improve
          the product. We balance these against your rights.
        </li>
        <li>
          <strong className="font-semibold">Consent (Art. 6(1)(a)).</strong> Where required for
          non-essential analytics or similar technologies. You can withdraw consent at any time.
        </li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Sub-processors</h2>
      <p>
        We use a small set of vetted vendors to run Crawlmouse. The current list &mdash; each
        vendor&rsquo;s purpose, the data it handles, and its region &mdash; is published at{' '}
        <a className="text-peach underline" href="/subprocessors">/subprocessors</a>. We give 30
        days&rsquo; notice on that page before adding a new sub-processor.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Cookies and similar technologies</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          <strong className="font-semibold">Authentication.</strong> A first-party session cookie keeps
          you signed in after you click a magic link. This is essential to the service.
        </li>
        <li>
          <strong className="font-semibold">Analytics.</strong> PostHog sets identifiers to measure
          product usage.
        </li>
        <li>
          <strong className="font-semibold">Session replay.</strong> We capture replay only when an
          error occurs, and we mask text inputs so we don&rsquo;t record what you type.
        </li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Data retention</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>Free-tier audits are deleted automatically 30 days after they are created.</li>
        <li>Account data (your email and billing status) is kept until you request deletion.</li>
        <li>Error and analytics data is retained for a limited window in line with each vendor&rsquo;s defaults.</li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">International transfers</h2>
      <p>
        Crawlmouse and several of our sub-processors are based in the United States, so your data may
        be processed in the US. Where we transfer personal data out of the EU/UK, we rely on the
        European Commission&rsquo;s Standard Contractual Clauses (and the UK addendum) with the
        relevant vendor.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, export, correct, or delete your
        personal data, and to object to or restrict certain processing.
      </p>
      <p>
        <strong className="font-semibold">We do not sell your personal data.</strong> Under the
        California Consumer Privacy Act (CCPA/CPRA) we do not sell or share your personal information for
        cross-context behavioral advertising, and we honor &ldquo;do not sell or share&rdquo; rights. We
        respond to verified requests within 30 days (sooner where the law requires).
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">How to exercise your rights</h2>
      <p>
        To delete your account, or to make an access, export, or any other request, email{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
        We verify the request and respond within 30 days, erasing your account data on request.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Children</h2>
      <p>
        Crawlmouse is not directed to children. We do not knowingly collect personal data from anyone
        under 16. If you believe a child has used the service, contact us and we&rsquo;ll delete the
        data.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Changes</h2>
      <p>
        If we make material changes to this policy we&rsquo;ll update the &ldquo;last updated&rdquo;
        date above and, where appropriate, notify you. Continued use after a change means you accept
        the updated policy.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Contact</h2>
      <p>
        Questions about privacy? Email{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
      </p>
    </LegalPage>
  );
}
