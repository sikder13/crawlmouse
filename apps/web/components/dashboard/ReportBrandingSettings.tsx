'use client';

import type { SiteReportSettings } from '@/lib/dashboard-report-settings';
import type { OwnershipProbe } from '@/lib/report-owner-probe';
import { OwnerControls } from '@/components/report/owner/OwnerControls';

// SPEC 04.1 §3 (dashboard) — the per-site "Report settings" area. It REUSES the exact same OwnerControls
// (white-label + visibility + the private/public prompt) as the /r/ owner island by synthesizing an
// ownership probe from the server-loaded settings, so the two surfaces can never drift. After a write,
// OwnerControls calls router.refresh() internally, which re-runs the dashboard's server loader → fresh
// settings; `refetch` is a no-op here (the server render is the source of truth — there is no probe to
// reload). The server routes remain the only gate; canWhiteLabel just drives the locked/enabled UI.
export function ReportBrandingSettings({ slug, settings }: { slug: string; settings: SiteReportSettings }) {
  const probe: OwnershipProbe = {
    owned: true,
    claimed: true,
    canWhiteLabel: settings.canWhiteLabel,
    listed: settings.listed,
    indexable: settings.indexable,
    whiteLabel: settings.whiteLabel,
  };
  return (
    <div className="mt-4 w-full border-t border-oat pt-4">
      <div className="text-overline uppercase text-ink-muted">Report settings</div>
      <div className="mt-2">
        <OwnerControls probe={probe} slug={slug} refetch={() => {}} />
      </div>
    </div>
  );
}
