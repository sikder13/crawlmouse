import { LegalPage } from '@/components/legal/LegalPage';

export default function AupPage() {
  return (
    <LegalPage title="Acceptable Use">
      <p><em>Last updated: 2026-05-24. Placeholder &mdash; replace before launch.</em></p>
      <p>Do not use Crawlmouse to:</p>
      <ul className="list-disc pl-6">
        <li>Audit sites you do not own with the intent to publish a damaging public report (see Takedown).</li>
        <li>Submit URLs to internal IPs or non-public infrastructure.</li>
        <li>Automate audits against our service without permission (use our v1.2 CLI when available).</li>
        <li>Resell or sublicense Crawlmouse output as your own product.</li>
      </ul>
    </LegalPage>
  );
}
