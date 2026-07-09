import type { OwnershipProbe } from '@/lib/report-owner-probe';

export type OwnerView = 'loading' | 'claimCta' | 'finishClaim' | 'ownerControls' | 'hidden';

// SPEC 04.1 §2 — pure island view-state from the probe (R2 single source of truth) AND the report's
// PUBLIC claimed flag (identical for everyone → the SSR stays owner-agnostic, U10):
//  - verified owner → ownerControls (claimed) / finishClaim (not yet claimed)
//  - non-owner on an UNCLAIMED report → claimCta (the conversion hook); pre-hydration → loading
//  - non-owner on a CLAIMED report → hidden (it already has an owner; no claim CTA)
export function viewStateFrom(probe: OwnershipProbe | null, reportClaimed: boolean): OwnerView {
  if (probe?.owned) return probe.claimed ? 'ownerControls' : 'finishClaim';
  if (reportClaimed) return 'hidden';
  return probe === null ? 'loading' : 'claimCta';
}
