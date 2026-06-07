import { LegalPage } from '@/components/legal/LegalPage';
import { Card } from '@/components/ui/Card';

export const metadata = {
  title: 'Subprocessors — Crawlmouse',
};

interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  region: string;
}

// The vetted vendors that help run Crawlmouse. Each entry maps to a real data flow in the product.
const SUBPROCESSORS: Subprocessor[] = [
  { name: 'Supabase', purpose: 'Database & authentication', data: 'Account and audit data', region: 'United States' },
  { name: 'Stripe', purpose: 'Payments & subscriptions', data: 'Billing identifiers (no card numbers)', region: 'United States / global' },
  { name: 'Resend', purpose: 'Transactional email', data: 'Email address', region: 'United States' },
  { name: 'Cloudflare', purpose: 'Turnstile anti-abuse, DNS & CDN', data: 'IP address and challenge token', region: 'Global edge' },
  { name: 'Vercel', purpose: 'Application hosting', data: 'Request metadata', region: 'United States / global edge' },
  { name: 'PostHog', purpose: 'Product analytics', data: 'Usage events and masked session replay', region: 'United States' },
  { name: 'Sentry', purpose: 'Error telemetry', data: 'Error context (e.g. request path, stack trace)', region: 'United States' },
  { name: 'Inngest', purpose: 'Background jobs', data: 'Audit job metadata', region: 'United States' },
];

export default function SubprocessorsPage() {
  return (
    <LegalPage title="Subprocessors">
      <p className="text-ink/60">Last updated: 2026-06-07 &middot; Version 1.0</p>

      <p>
        To run Crawlmouse we rely on the vetted third-party vendors below. Each one processes only the
        data it needs for the purpose shown, under a data-processing agreement. We announce changes to
        this list at least 30 days in advance on this page.
      </p>
      <p>
        Where these vendors process EU/UK personal data in the United States, most are certified under the
        EU-US Data Privacy Framework; Supabase and Inngest are not, so transfers to them rely on Standard
        Contractual Clauses. See our{' '}
        <a className="text-peach underline" href="/privacy">Privacy Policy</a> for details.
      </p>

      {/* Table on md+ screens. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-oat text-left">
              <th className="py-3 pr-4 font-display font-bold text-base">Subprocessor</th>
              <th className="py-3 pr-4 font-display font-bold text-base">Purpose</th>
              <th className="py-3 pr-4 font-display font-bold text-base">Data</th>
              <th className="py-3 font-display font-bold text-base">Region</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name} className="border-b border-oat align-top">
                <td className="py-3 pr-4 font-semibold text-ink">{s.name}</td>
                <td className="py-3 pr-4 text-ink/80">{s.purpose}</td>
                <td className="py-3 pr-4 text-ink/80">{s.data}</td>
                <td className="py-3 text-ink/80">{s.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked, labelled cards on small screens. */}
      <div className="space-y-4 md:hidden">
        {SUBPROCESSORS.map((s) => (
          <Card key={s.name}>
            <div className="font-display font-bold text-lg text-ink">{s.name}</div>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Purpose</dt>
                <dd className="text-ink/80">{s.purpose}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Data</dt>
                <dd className="text-ink/80">{s.data}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Region</dt>
                <dd className="text-ink/80">{s.region}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      <p className="text-ink/60 text-sm mt-2">
        Questions about a vendor on this list? Email{' '}
        <a className="text-peach underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
      </p>
    </LegalPage>
  );
}
