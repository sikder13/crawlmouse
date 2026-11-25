import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { buttonClasses } from '@/components/ui/Button';
import { PlanStatusCard } from '@/components/billing/PlanStatusCard';
import { ActivatingPro } from '@/components/billing/ActivatingPro';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { DashboardAutoRefresh } from '@/components/dashboard/DashboardAutoRefresh';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadDashboardSites } from '@/lib/dashboard';
import { loadReportSettingsForSites } from '@/lib/dashboard-report-settings';
import { isProActive } from '@/lib/pro';

// Signed-in application surface — never a search result. `follow` keeps outbound links live.
export const metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: '/dashboard' },
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ upgraded?: string }> }) {
  const { upgraded } = await searchParams;
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: planRow } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle();
  const proUntil = planRow?.pro_until ?? null;
  const isPro = isProActive(proUntil);
  // Just paid but the entitlement webhook hasn't landed yet → show an activating state that polls,
  // instead of flashing the "Free" card to someone who just upgraded.
  const activating = upgraded === '1' && !isPro;

  // The "what changed since last visit" per-site view (SPEC 02's query). delta/history are FREE; the
  // fix checklist is gated to Pro inside loadDashboardSites (null otherwise → the SiteCard upsell).
  const admin = supabaseAdmin();
  const sites = await loadDashboardSites(sb, admin, isPro);
  // §3 dashboard — per-site report-branding + visibility settings for the owner's claimed reports
  // (fail-soft: an empty map on any error, so the dashboard never breaks).
  const reportSettingsByUrl = await loadReportSettingsForSites(admin, user.id, sites.map((s) => s.siteUrl), isPro);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-12 pb-32">
        <DashboardAutoRefresh />
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display font-bold text-4xl tracking-tight">Your audits</h1>
          <Link href={{ pathname: '/' }} className={buttonClasses()}>
            + New audit
          </Link>
        </div>

        <div className="mb-8">{activating ? <ActivatingPro /> : <PlanStatusCard proUntil={proUntil} />}</div>

        <DashboardView sites={sites} reportSettingsByUrl={reportSettingsByUrl} />
      </main>
      <Footer />
    </>
  );
}
