import { LegalPage } from '@/components/legal/LegalPage';

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p><em>Last updated: 2026-05-24. Placeholder &mdash; replace with real terms before launch.</em></p>
      <h2 className="font-display font-bold text-2xl mt-6">Use of the service</h2>
      <p>You may use Crawlmouse to audit websites. Free tier has rate limits; paid Pro tier lifts most limits. We may suspend abusive accounts.</p>
      <h2 className="font-display font-bold text-2xl mt-6">No warranty</h2>
      <p>Crawlmouse is provided as-is. The grade is an opinion based on heuristics, not a guarantee of SEO outcomes.</p>
      <h2 className="font-display font-bold text-2xl mt-6">Liability</h2>
      <p>Our maximum aggregate liability is limited to the fees you paid in the prior 12 months.</p>
    </LegalPage>
  );
}
