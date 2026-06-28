import type { Metadata } from 'next';
import { PlanStatusCard } from '@/components/billing/PlanStatusCard';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { dashboardSites } from '@/components/dashboard/__fixtures__/dashboard';

// TEMPORARY dashboard checkpoint surface for SPEC 03 Phase D — renders the "what-changed" view from
// fixtures (real per-site data comes from SPEC 02 at integration). noindex; removed before the PR.
export const metadata: Metadata = {
  title: 'Dashboard preview',
  robots: { index: false, follow: false },
};

export default function DashboardPreviewPage() {
  return (
    <main className="min-h-screen bg-cream text-ink">
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-12">
        <header className="space-y-1">
          <div className="text-overline uppercase text-ink-muted">SPEC 03 Phase D · dashboard preview</div>
          <h1 className="font-display text-h1">What changed since you last visited</h1>
          <p className="text-body-lg text-ink-muted">Per-site deltas, grade-over-time, open-loop fixes, one-tap re-audit.</p>
        </header>

        <PlanStatusCard proUntil="2026-12-31T00:00:00.000Z" />
        <DashboardView sites={dashboardSites} />

        <section className="space-y-3 pt-8">
          <h2 className="border-b border-oat pb-2 font-display text-h2">Empty state</h2>
          <DashboardView sites={[]} />
        </section>
      </div>
    </main>
  );
}
