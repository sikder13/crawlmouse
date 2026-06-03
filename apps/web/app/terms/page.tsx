import { LegalPage } from '@/components/legal/LegalPage';
import { DraftBanner } from '@/components/legal/DraftBanner';

export const metadata = {
  title: 'Terms of Service — Crawlmouse',
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <DraftBanner />

      <p className="text-ink/60">Last updated: 2026-06-03</p>

      <p>
        These terms are a contract between you and Nahl Technologies Inc (operator of Crawlmouse,
        &ldquo;we,&rdquo; &ldquo;us&rdquo;). By using Crawlmouse you agree to them.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">1. Acceptance</h2>
      <p>
        By creating an account or running an audit, you agree to these terms and to our{' '}
        <a className="text-peach underline" href="/privacy">Privacy Policy</a> and{' '}
        <a className="text-peach underline" href="/aup">Acceptable Use Policy</a>. If you don&rsquo;t
        agree, don&rsquo;t use the service.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">2. The service</h2>
      <p>
        Crawlmouse crawls the public pages of a website and grades its internal-linking structure. A
        free tier is available with rate limits. Pro lifts most limits and costs{' '}
        <strong className="font-semibold">$19/month</strong> or{' '}
        <strong className="font-semibold">$190/year</strong>.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">3. Accounts</h2>
      <p>
        We sign you in with a magic link sent to your email, so there is no password. You are
        responsible for keeping access to your inbox secure; anyone who can read your email can sign
        in to your account.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">4. Acceptable use</h2>
      <p>
        Your use of Crawlmouse is governed by our{' '}
        <a className="text-peach underline" href="/aup">Acceptable Use Policy</a>. In particular,{' '}
        <strong className="font-semibold">you may only publish public reports for domains you have
        verified you own.</strong>
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">5. Billing</h2>
      <p>
        Pro is billed through Stripe and renews automatically until you cancel. You can cancel anytime
        from the billing portal; your Pro access continues until the end of the period you&rsquo;ve
        already paid for. We don&rsquo;t refund partial periods except where the law requires it.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">6. Intellectual property</h2>
      <p>
        You keep ownership of the data you submit and the audit results tied to your account. We own
        Crawlmouse itself &mdash; the software, brand, and grading methodology. We grant you a limited,
        non-exclusive right to use the service while these terms are in effect.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">7. Disclaimers</h2>
      <p>
        Crawlmouse is provided &ldquo;as is.&rdquo; The grade is an informational opinion based on
        heuristics &mdash; it is not advice and is not a guarantee of any search-ranking or SEO
        outcome. We don&rsquo;t warrant that the service will be uninterrupted or error-free.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, our total aggregate liability arising out of or
        relating to the service is limited to the fees you paid us in the 12 months before the event
        giving rise to the claim. We are not liable for indirect, incidental, or consequential damages.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">9. Indemnity</h2>
      <p>
        You agree to indemnify and hold us harmless from claims arising out of your misuse of the
        service or your violation of these terms or the Acceptable Use Policy &mdash; including
        publishing a report for a domain you don&rsquo;t own.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">10. Termination</h2>
      <p>
        You may stop using Crawlmouse at any time, and you can have your account erased by emailing{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>{' '}
        (see our <a className="text-peach underline" href="/privacy">Privacy Policy</a>). We may suspend
        or terminate accounts that violate these terms or the Acceptable Use Policy, or where required
        to protect the service or others.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">11. Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Delaware, United States, without regard
        to its conflict-of-laws rules.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">12. Changes</h2>
      <p>
        We may update these terms. We&rsquo;ll change the &ldquo;last updated&rdquo; date above and,
        for material changes, give reasonable notice. Continued use after a change means you accept the
        updated terms.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">13. Contact</h2>
      <p>
        Questions about these terms? Email{' '}
        <a className="text-peach underline" href="mailto:support@crawlmouse.com">support@crawlmouse.com</a>.
      </p>
    </LegalPage>
  );
}
