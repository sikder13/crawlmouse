import { LegalPage } from '@/components/legal/LegalPage';

export const metadata = {
  title: 'Privacy Policy — Crawlmouse',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p className="text-ink/60">Last updated: 2026-06-07 &middot; Version 1.0</p>

      <p>
        Crawlmouse grades the internal-linking structure of websites. This policy explains what
        personal data we collect, why, the lawful bases we rely on, and the choices and rights you
        have. We&rsquo;ve written it in plain language; if anything is unclear, email{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Who we are (data controller)</h2>
      <p>
        Crawlmouse is operated by <strong className="font-semibold">Nahl Technologies Inc</strong>, a
        Delaware C-Corporation with its principal office in Indiana, United States
        (&ldquo;Crawlmouse,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). For the purposes of the EU and
        UK GDPR, we are the data controller of the personal data described here. We are not required to
        appoint a Data Protection Officer; privacy questions go to{' '}
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
          computed grade. This is public structural data, not your private content. Because you choose
          which site to audit, a URL or its results <strong className="font-semibold">may contain
          personal data</strong> (for example if you audit your own profile or contact page); see your
          rights below.
        </li>
        <li>
          <strong className="font-semibold">Billing data (held by Stripe).</strong> Pro subscriptions
          are processed by Stripe. We never see or store your full card number &mdash; Stripe handles
          card data directly. We keep only billing identifiers (a Stripe customer ID and subscription
          status) so we can tell whether your account is on Pro.
        </li>
        <li>
          <strong className="font-semibold">IP address and anti-abuse signals.</strong> To stop bots
          and abuse we use Cloudflare Turnstile and basic rate limiting, which process your{' '}
          <strong className="font-semibold">IP address</strong> and a challenge token. We may derive a
          coarse, city-level location from the IP address; we do not collect precise geolocation.
        </li>
        <li>
          <strong className="font-semibold">Product analytics.</strong> We use PostHog to understand
          how the product is used (for example, which steps of the audit flow people complete),
          including event data, page paths, device/browser type, and a pseudonymous identifier.
        </li>
        <li>
          <strong className="font-semibold">Error telemetry.</strong> We use Sentry to capture errors
          so we can fix them. Error reports can include technical context such as the request path, a
          stack trace, and an IP address.
        </li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Why we use it, and our legal bases (GDPR Article 6)</h2>
      <p>If you are in the EU/UK, we rely on the following lawful bases, by purpose:</p>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          <strong className="font-semibold">Provide the service (Art. 6(1)(b) &mdash; contract).</strong>{' '}
          To create and run your account, perform the audits you request, and provide the paid Pro
          service.
        </li>
        <li>
          <strong className="font-semibold">Keep the service secure (Art. 6(1)(f) &mdash; legitimate
          interests).</strong> Our legitimate interest is preventing abuse, fraud, and overload
          (Turnstile, rate limiting), fixing errors (Sentry), and understanding and improving the
          product (analytics). We balance these interests against your rights.
        </li>
        <li>
          <strong className="font-semibold">Comply with law (Art. 6(1)(c) &mdash; legal
          obligation).</strong> To keep billing and tax records for the periods the law requires.
        </li>
        <li>
          <strong className="font-semibold">Consent (Art. 6(1)(a)).</strong> Where required for
          non-essential analytics or similar technologies. You can withdraw consent at any time using
          the &ldquo;Cookie settings&rdquo; link in our footer.
        </li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Cookies and similar technologies</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          <strong className="font-semibold">Authentication.</strong> A first-party session cookie keeps
          you signed in after you click a magic link. This is essential to the service.
        </li>
        <li>
          <strong className="font-semibold">Security.</strong> Cloudflare Turnstile and rate limiting
          use short-lived tokens to tell humans from bots. This is essential to the service.
        </li>
        <li>
          <strong className="font-semibold">Analytics.</strong> PostHog sets identifiers to measure
          product usage. These are non-essential: for visitors in the EU/EEA and UK we ask for your
          consent (via a banner) before loading them and keep them off until you agree, and you can
          change or withdraw consent at any time using the &ldquo;Cookie settings&rdquo; link in our
          footer; elsewhere they load by default and you can opt out the same way (or by emailing{' '}
          <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>).
        </li>
        <li>
          <strong className="font-semibold">Session replay.</strong> We capture replay only when an
          error occurs, and we mask text inputs so we don&rsquo;t record what you type.
        </li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Sub-processors</h2>
      <p>
        We use a small set of vetted vendors to run Crawlmouse. The current list &mdash; each
        vendor&rsquo;s purpose, the data it handles, and its region &mdash; is published at{' '}
        <a className="text-peach underline" href="/subprocessors">/subprocessors</a>. Each is bound by a
        data-processing agreement. We give 30 days&rsquo; notice on that page before adding a new
        sub-processor. We do not sell your personal data to anyone.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">International transfers</h2>
      <p>
        Crawlmouse and most of our sub-processors are based in the United States, so your data may be
        processed in the US. Where we transfer personal data out of the EU/UK, we rely on a valid
        transfer mechanism for each vendor:
      </p>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          For vendors certified under the <strong className="font-semibold">EU-US Data Privacy
          Framework</strong> (and its UK extension) &mdash; Stripe, Resend, Cloudflare, Vercel, Sentry,
          and PostHog &mdash; we rely on that certification.
        </li>
        <li>
          For vendors not certified under the Framework &mdash;{' '}
          <strong className="font-semibold">Supabase</strong> and{' '}
          <strong className="font-semibold">Inngest</strong> &mdash; we rely on the European
          Commission&rsquo;s <strong className="font-semibold">Standard Contractual Clauses</strong>{' '}
          together with the UK International Data Transfer Addendum.
        </li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Data retention</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>Free-tier audits are deleted automatically 30 days after they are created.</li>
        <li>Account data (your email and billing status) is kept until you request deletion.</li>
        <li>
          Billing and tax records are kept for as long as applicable law requires, which is generally up
          to seven (7) years.
        </li>
        <li>
          Analytics and error-telemetry data is retained for a limited window in line with each
          vendor&rsquo;s defaults; rate-limit and anti-abuse records are short-lived.
        </li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">Data security</h2>
      <p>
        We use appropriate technical and organizational measures to protect personal data
        (GDPR Article 32), including encryption in transit, passwordless magic-link authentication,
        access controls and row-level security on our database, anti-abuse protections, and a small,
        vetted set of sub-processors. No method of transmission or storage is 100% secure, so we
        cannot guarantee absolute security.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Automated decision-making</h2>
      <p>
        Crawlmouse generates an automated grade for a website you submit. That grade is a technical
        heuristic about the site&rsquo;s internal-linking structure. It does not produce legal effects
        concerning you or similarly significantly affect you, so the rules on solely-automated decisions
        in <strong className="font-semibold">GDPR Article 22</strong> do not apply. We&rsquo;re happy to
        explain the methodology &mdash; just ask.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, export (port), correct, or
        delete your personal data, to object to or restrict certain processing, and to withdraw consent.
        To exercise any of these, email{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
      </p>
      <p>
        <strong className="font-semibold">California (CCPA/CPRA).</strong> In the past 12 months we have
        collected the following statutory categories of personal information, used as described above and
        disclosed only to the sub-processors at{' '}
        <a className="text-peach underline" href="/subprocessors">/subprocessors</a>:
      </p>
      <ul className="list-disc pl-6 space-y-2">
        <li><strong className="font-semibold">Identifiers</strong> &mdash; email address, IP address, account and customer IDs.</li>
        <li><strong className="font-semibold">Internet/network activity</strong> &mdash; usage events, error logs, masked error-only replay.</li>
        <li><strong className="font-semibold">Commercial information</strong> &mdash; subscription and billing status.</li>
        <li><strong className="font-semibold">Geolocation</strong> &mdash; coarse, city-level, derived from IP address.</li>
      </ul>
      <p>
        <strong className="font-semibold">We do not sell or share your personal information</strong> for
        money or for cross-context behavioral advertising, and we do not use or disclose sensitive
        personal information beyond the purposes allowed by law (so there is nothing to &ldquo;limit&rdquo;).
        California residents have the rights to know, delete, correct, and opt out of sale/share, and the
        right to <strong className="font-semibold">non-discrimination</strong> for exercising them. You may
        use an <strong className="font-semibold">authorized agent</strong> to submit a request with proof
        of authorization; we will verify your identity using information we already hold. If you are a
        resident of another US state with privacy rights (for example Virginia, Colorado, Connecticut,
        Utah, or Texas), we extend the same access, correction, deletion, and portability rights to you.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">How to exercise your rights, and our timelines</h2>
      <p>
        Email{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
        We verify the request (usually by confirming control of the account email) and respond within{' '}
        <strong className="font-semibold">one month</strong> under the GDPR (extendable by two further
        months for complex requests) and within <strong className="font-semibold">45 days</strong> under
        the CCPA (extendable by a further 45 days), erasing your account data on a valid request.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Complaints to a supervisory authority</h2>
      <p>
        We&rsquo;d like the chance to resolve any concern first, so please contact us. You also have the
        right (GDPR Article 77) to lodge a complaint with a data-protection supervisory authority &mdash;
        in the EU/EEA, your local authority; in the UK, the Information Commissioner&rsquo;s Office
        (<a className="text-peach underline" href="https://ico.org.uk">ico.org.uk</a>).
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Data breaches</h2>
      <p>
        If a personal-data breach is likely to result in a risk to your rights, we will notify the
        relevant supervisory authority without undue delay and, where the law requires, notify you, in
        accordance with applicable law.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Children</h2>
      <p>
        Crawlmouse is not directed to children. We do not knowingly collect personal data from anyone
        under 16 (the GDPR default age of digital consent), and in the United States we do not knowingly
        collect personal data from children under 13 (the Children&rsquo;s Online Privacy Protection Act,
        COPPA). If you believe a child has used the service, contact us and we&rsquo;ll delete the data.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Changes</h2>
      <p>
        If we make material changes to this policy we&rsquo;ll update the &ldquo;last updated&rdquo; date
        and version above and, where appropriate, notify you. Continued use after a change means you
        accept the updated policy.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">Contact</h2>
      <p>
        Questions about privacy? Email{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
      </p>
    </LegalPage>
  );
}
