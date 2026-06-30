'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { installDashboardRefresh } from './dashboard-refresh-logic';

/**
 * FIX 2: the dashboard is a dynamic Server Component (loadDashboardSites), but Next's client Router
 * Cache can serve a stale copy when you navigate back after running a new audit — so a fresh audit
 * doesn't show until a manual reload. installDashboardRefresh refreshes the RSC on mount (covers the
 * re-audit → /audit → back-to-dashboard path) and whenever the tab becomes visible. Renders nothing.
 * The trade is one extra fetch per visit on a low-traffic, authenticated page — acceptable for
 * always-fresh deltas; high-traffic pages (homepage, reports) are untouched.
 */
export function DashboardAutoRefresh() {
  const router = useRouter();
  useEffect(() => installDashboardRefresh(() => router.refresh(), document), [router]);
  return null;
}
