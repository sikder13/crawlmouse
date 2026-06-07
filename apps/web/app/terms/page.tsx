import { LegalPage } from '@/components/legal/LegalPage';

export const metadata = {
  title: 'Terms of Service — Crawlmouse',
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p className="text-ink/60">Last updated: 2026-06-07 &middot; Version 1.0</p>

      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) are a contract between you and{' '}
        <strong className="font-semibold">Nahl Technologies Inc</strong>, a Delaware C-Corporation and
        operator of Crawlmouse (&ldquo;Crawlmouse,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). By using
        Crawlmouse you agree to them.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">1. The agreement</h2>
      <p>
        These Terms, together with our{' '}
        <a className="text-peach underline" href="/privacy">Privacy Policy</a> and{' '}
        <a className="text-peach underline" href="/aup">Acceptable Use Policy</a> (each incorporated by
        reference), form a single agreement between you and us (the &ldquo;Agreement&rdquo;). If a
        conflict arises, these Terms control, then the Acceptable Use Policy, then the Privacy Policy. By
        creating an account or running an audit, you accept the Agreement. If you don&rsquo;t agree,
        don&rsquo;t use the service.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">2. Eligibility</h2>
      <p>
        You must be at least <strong className="font-semibold">18</strong> years old and able to form a
        binding contract to create an account or purchase Pro. The service is not directed to children;
        see our <a className="text-peach underline" href="/privacy">Privacy Policy</a>.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">3. The service</h2>
      <p>
        Crawlmouse crawls the public pages of a website and grades its internal-linking structure. A
        free tier is available with rate limits. Pro lifts most limits and costs{' '}
        <strong className="font-semibold">$19/month</strong> or{' '}
        <strong className="font-semibold">$190/year</strong>.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">4. Accounts</h2>
      <p>
        We sign you in with a magic link sent to your email, so there is no password. You are
        responsible for keeping access to your inbox secure; anyone who can read your email can sign in
        to your account. You are responsible for activity under your account and must tell us promptly of
        any unauthorized use.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">5. License and restrictions</h2>
      <p>
        We grant you a limited, revocable, non-exclusive, non-transferable, non-sublicensable right to
        use the service for its intended purpose while the Agreement is in effect. You may not: (a)
        reverse engineer, decompile, or attempt to extract our source code; (b) resell, sublicense, or
        provide the service to third parties; (c) scrape or use automated means to extract the service or
        its outputs at scale, or evade free-tier rate limits; (d) use the service, its outputs, or its
        grading methodology to build or train a competing product; or (e) remove proprietary notices or
        circumvent our security.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">6. Acceptable use</h2>
      <p>
        Your use of Crawlmouse is governed by our{' '}
        <a className="text-peach underline" href="/aup">Acceptable Use Policy</a>, which is incorporated
        into these Terms; a breach of it is a breach of these Terms. In particular,{' '}
        <strong className="font-semibold">you may only publish public reports for domains you have
        verified you own.</strong>
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">7. Your content and the crawls you direct</h2>
      <p>
        You keep ownership of the data you submit and the audit results tied to your account. You grant
        us a license to access, crawl, fetch, process, cache, and store the content of the URLs you
        submit, solely to provide the service (including to host any public report you choose to
        publish). Crawlmouse acts only as an automated tool that runs crawls at your direction; you
        decide which sites are crawled and for what purpose.
      </p>
      <p>
        For each URL or domain you submit, <strong className="font-semibold">you represent and
        warrant</strong> that: (a) you own the target site or are otherwise authorized and have all
        rights and consents necessary to direct us to crawl and analyze it; (b) your instruction does
        not violate the target site&rsquo;s terms, any law, or any third party&rsquo;s rights; (c) you
        are not directing us to access any non-public, password-protected, login-gated, or otherwise
        access-restricted content, nor to circumvent any technical access control; and (d) you will not
        use the service to overload, harass, or surveil any third party.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">8. Billing</h2>
      <p>
        Pro is billed through Stripe and renews automatically each term until you cancel. Before you
        subscribe, the checkout shows the price, billing frequency, and that the plan auto-renews; you
        cancel anytime from the billing portal using the same online method you signed up with. Fees are
        in US dollars and exclusive of taxes, which you are responsible for. We may change prices on
        notice before your next renewal; the new price applies to the next term. Your Pro access
        continues until the end of the period you&rsquo;ve already paid for. We don&rsquo;t refund
        partial periods except where the law requires it. If a payment fails we may retry and may
        downgrade or suspend Pro. Please contact{' '}
        <a className="text-peach underline" href="mailto:support@crawlmouse.com">support@crawlmouse.com</a>{' '}
        before initiating a chargeback so we can resolve the issue; we reserve the right to dispute
        illegitimate chargebacks.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">9. Feedback</h2>
      <p>
        If you send us feedback or suggestions, you grant us a perpetual, irrevocable, worldwide,
        royalty-free license to use it for any purpose without obligation or attribution. Feedback is not
        confidential.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">10. Intellectual property</h2>
      <p>
        We own Crawlmouse itself &mdash; the software, brand, and grading methodology. Subject to the
        Agreement, we grant you the limited right to use the service described above. Nothing transfers
        our intellectual property to you.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">11. Third-party services</h2>
      <p>
        Crawlmouse relies on third parties &mdash; for example Stripe for payments and an email provider
        for magic links. Your use of those is also governed by their terms (Stripe&rsquo;s terms govern
        payments), and we are not responsible for their acts, outages, or failures, nor for the content
        or availability of third-party sites you choose to crawl.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">12. Changes to the service; beta features</h2>
      <p>
        We may modify, suspend, or discontinue features, giving reasonable notice of material adverse
        changes to paid features. Beta or experimental features are provided &ldquo;as is,&rdquo; may
        change or be withdrawn, and are excluded from any warranty or service commitment.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">13. Disclaimers</h2>
      <div className="my-4 rounded-xl border border-oat bg-oat/40 px-4 py-3">
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES
          OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL IMPLIED WARRANTIES,
          INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT
          WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE, OR THAT ANY GRADE IS ACCURATE OR
          COMPLETE.
        </p>
      </div>
      <p>
        The grade is an informational opinion based on a published, deterministic methodology applied to
        publicly available pages &mdash; it is an estimate, not a statement of fact, not advice, and not
        a guarantee of any search-ranking or SEO outcome.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">14. Limitation of liability</h2>
      <div className="my-4 rounded-xl border border-oat bg-oat/40 px-4 py-3">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR
          RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF (i) THE FEES YOU PAID US IN THE 12 MONTHS
          BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (ii) USD $100. WE ARE NOT LIABLE FOR INDIRECT,
          INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS OR DATA.
        </p>
      </div>
      <p>
        These limits do not apply to liability that cannot be limited by law &mdash; including our own
        gross negligence, willful misconduct, or fraud.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">15. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold us harmless from any claims, damages, liabilities,
        losses, costs, and reasonable attorneys&rsquo; fees arising out of: (a) any URL or domain you
        submit or instruct us to crawl; (b) your breach of the Agreement; (c) your violation of any law
        or any third party&rsquo;s rights; or (d) any content you publish through the service &mdash;
        including publishing a report for a domain you don&rsquo;t own. We will notify you of the claim
        and may participate in the defense with our own counsel.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">16. Copyright and DMCA</h2>
      <p>
        We respect intellectual-property rights. If you believe content stored or displayed by Crawlmouse
        infringes your copyright, send a notice under the Digital Millennium Copyright Act (DMCA)
        containing the elements required by 17 U.S.C. &sect; 512(c)(3) to our designated agent at{' '}
        <a className="text-peach underline" href="mailto:takedown@crawlmouse.com">takedown@crawlmouse.com</a>.
        (Our <a className="text-peach underline" href="/takedown">takedown form</a> is for domain owners
        reporting an unauthorized report; send formal DMCA notices to the email above so they can include
        the required statutory elements.) We will remove or disable access to infringing material, forward
        valid notices, accept counter-notices, and terminate the accounts of repeat infringers in
        appropriate cases.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">17. Dispute resolution, governing law, and venue</h2>
      <p>
        Before starting any formal proceeding, you agree to first contact us at{' '}
        <a className="text-peach underline" href="mailto:support@crawlmouse.com">support@crawlmouse.com</a>{' '}
        and try in good faith to resolve the dispute through informal resolution for at least 30 days.
        These Terms are governed by the laws of the State of Delaware, United States, without regard to
        its conflict-of-laws rules. You and we submit to the exclusive jurisdiction and{' '}
        <strong className="font-semibold">venue</strong> of the state and federal courts located in
        Delaware. We do not require you to arbitrate disputes. To the extent permitted by law, you and we
        each waive any right to a <strong className="font-semibold">jury</strong> trial and agree not to
        participate in a <strong className="font-semibold">class action</strong>. Any claim must be
        brought within <strong className="font-semibold">one year</strong> after it arises, or it is
        permanently barred.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">18. Termination</h2>
      <p>
        You may stop using Crawlmouse at any time and can have your account erased by emailing{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>{' '}
        (see our <a className="text-peach underline" href="/privacy">Privacy Policy</a>). We may suspend
        or terminate accounts that violate the Agreement or where required to protect the service or
        others, with notice where practicable. On termination your license ends and access ceases; you
        have 30 days to export your reports before they are deleted in line with our retention policy.
        Sections that by their nature should survive (intellectual property, disclaimers, limitation of
        liability, indemnity, dispute resolution, and fees owed) survive termination.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">19. General</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li><strong className="font-semibold">Severability.</strong> If a provision is unenforceable, the rest stays in effect.</li>
        <li><strong className="font-semibold">Entire agreement.</strong> The Agreement is the entire agreement between us and supersedes prior understandings on its subject.</li>
        <li><strong className="font-semibold">No waiver.</strong> Our failure to enforce a provision is not a waiver of it.</li>
        <li><strong className="font-semibold">Assignment.</strong> You may not assign the Agreement without our consent; we may assign it, including in a merger, acquisition, or sale of assets.</li>
        <li><strong className="font-semibold">Force majeure.</strong> Neither party is liable for delays or failures caused by events beyond its reasonable control.</li>
        <li><strong className="font-semibold">Notices.</strong> We may give notice by email to your account address or by posting in the product; you give notice to us at the contact below.</li>
        <li><strong className="font-semibold">Electronic communications.</strong> You consent to receive notices and disclosures electronically, and agree that electronic acceptance forms a valid, binding agreement.</li>
        <li><strong className="font-semibold">Export and sanctions.</strong> You represent that you are not located in an embargoed region or on a US sanctions list, and you will comply with applicable export-control laws.</li>
        <li><strong className="font-semibold">Independent parties.</strong> The parties are independent contractors; the Agreement creates no agency or partnership.</li>
      </ul>

      <h2 className="font-display font-bold text-2xl mt-8">20. Changes</h2>
      <p>
        We may update these Terms. We&rsquo;ll change the &ldquo;last updated&rdquo; date and version
        above and, for material changes, give reasonable notice. Continued use after a change means you
        accept the updated Terms.
      </p>

      <h2 className="font-display font-bold text-2xl mt-8">21. Contact</h2>
      <p>
        Questions about these Terms? Email{' '}
        <a className="text-peach underline" href="mailto:support@crawlmouse.com">support@crawlmouse.com</a>.
      </p>
    </LegalPage>
  );
}
