import { LegalPage } from '@/components/legal/LegalPage';

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p><em>Last updated: 2026-05-24. This is a placeholder. Replace with a real privacy policy before public launch.</em></p>
      <h2 className="font-display font-bold text-2xl mt-6">What we collect</h2>
      <p>Email (for magic-link auth), URLs you submit for audit, the resulting audit data (pages, links, anchor text — public structural data only), basic usage analytics (no third-party trackers).</p>
      <h2 className="font-display font-bold text-2xl mt-6">Aggregate data</h2>
      <p>We aggregate audit data anonymously to produce peer benchmarks. Aggregated cohorts are only published when at least 25 sites are in the cohort (k-anonymity). We never expose another user&rsquo;s specific URLs in benchmarks.</p>
      <h2 className="font-display font-bold text-2xl mt-6">Your rights</h2>
      <p>Delete your account anytime via the dashboard. We honor GDPR / CCPA right-to-be-forgotten requests within 30 days.</p>
    </LegalPage>
  );
}
