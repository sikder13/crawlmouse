'use client';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import type { OwnershipProbe } from '@/lib/report-owner-probe';
import { viewStateFrom } from './owner-controls-logic';
import { ClaimControl } from './ClaimControl';

interface Props {
  probe: OwnershipProbe | null;
  /** R2 — reload the probe after any successful write; the single source of truth for control state. */
  refetch: () => void;
  /** The report's PUBLIC claimed flag (from the page) — gates the claim CTA to unclaimed reports (U10). */
  reportClaimed: boolean;
  slug: string;
  domain: string;
}

// SPEC 04.1 §2 — dispatches the /r/ owner island to a view based ENTIRELY on the probe (R2). Pre-hydration
// / non-owner → the claim entry (owner-agnostic, U10). Verified-but-unclaimed → finish claiming. Verified
// owner of a claimed report → the owner controls (white-label §3 + visibility §4 mount here; each derives
// its state from `probe` and calls `refetch` after a write).
export function OwnerPanel({ probe, refetch, reportClaimed, slug, domain }: Props) {
  const view = viewStateFrom(probe, reportClaimed);

  // A claimed report shows nothing to a non-owner (it already has an owner).
  if (view === 'hidden') return null;
  if (view === 'loading' || view === 'claimCta') {
    return <ClaimControl slug={slug} domain={domain} mode="claim" onClaimed={refetch} />;
  }
  if (view === 'finishClaim') {
    return <ClaimControl slug={slug} domain={domain} mode="finish" onClaimed={refetch} />;
  }

  return (
    <Card variant="raised" className="no-print" aria-label="Report owner controls">
      <Badge tone="sage">You own this report</Badge>
      <p className="mt-2 text-caption text-ink-muted">Manage this report&rsquo;s branding and visibility below.</p>
    </Card>
  );
}
