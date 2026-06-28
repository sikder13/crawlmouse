import type { Metadata } from 'next';
import { ResultView } from '@/components/audit/ResultView';
import { allFixtures } from '@/components/audit/__fixtures__/client-audit-v2';

// TEMPORARY result-page checkpoint surface for SPEC 03 Phase C — renders the conversion arc from
// each ClientAuditV2 fixture (the live stream delivers real V2 at integration). noindex; removed
// before the PR — do not ship to prod.
export const metadata: Metadata = {
  title: 'Result preview',
  robots: { index: false, follow: false },
};

const VARIANTS: { key: keyof typeof allFixtures; label: string }[] = [
  { key: 'free', label: 'Free viewer' },
  { key: 'proOwner', label: 'Pro owner' },
  { key: 'proNonOwner', label: 'Pro account — non-owner (renders the free view)' },
  { key: 'estimate', label: 'Estimate — low-coverage partial crawl' },
  { key: 'error', label: 'Failed audit' },
  { key: 'xss', label: 'XSS fixture — crawled strings must render escaped' },
];

export default function ResultPreviewPage() {
  return (
    <main className="min-h-screen bg-cream text-ink">
      <div className="mx-auto max-w-2xl space-y-16 px-6 py-12">
        <header className="space-y-1">
          <div className="text-overline uppercase text-ink-muted">SPEC 03 Phase C · result-page preview</div>
          <h1 className="font-display text-h1">Result page</h1>
          <p className="text-body-lg text-ink-muted">Each variant rendered from a ClientAuditV2 fixture.</p>
        </header>
        {VARIANTS.map((v) => (
          <section key={v.key} className="space-y-4">
            <h2 className="border-b border-oat pb-2 font-display text-h2">{v.label}</h2>
            <ResultView audit={allFixtures[v.key]} shareUrl="https://crawlmouse.com/r/demo" />
          </section>
        ))}
      </div>
    </main>
  );
}
