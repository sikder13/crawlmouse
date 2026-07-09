'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchOwnership, type OwnershipProbe } from '@/lib/report-owner-probe';
import { OwnerPanel } from './OwnerPanel';

// SPEC 04.1 §2 (§0 constraint) — the owner control island for the ISR /r/ page. The page is
// `revalidate = 300` and session-unaware; this island renders OWNER-AGNOSTIC HTML on the server (probe
// null → the claim entry, keyed only on public props), then after hydration asks the read-only /mine
// probe and renders the owner's controls. No session data is ever baked into the cached HTML (U10 /
// V-cache). `refetch` is the R2 single source of truth, wired into every control's successful write so
// control state is never stale after acting.
export function ReportOwnerIsland({
  slug,
  domain,
  reportClaimed,
}: {
  slug: string;
  domain: string;
  /** The report's PUBLIC claimed flag from the ISR page — a public fact, never session data (U10). */
  reportClaimed: boolean;
}) {
  const [probe, setProbe] = useState<OwnershipProbe | null>(null);

  const refetch = useCallback(() => {
    fetchOwnership(slug, fetch).then(setProbe);
  }, [slug]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return <OwnerPanel probe={probe} refetch={refetch} reportClaimed={reportClaimed} slug={slug} domain={domain} />;
}
