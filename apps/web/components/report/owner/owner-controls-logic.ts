import type { OwnershipProbe } from '@/lib/report-owner-probe';

export type OwnerView = 'loading' | 'claimCta' | 'finishClaim' | 'ownerControls';

// SPEC 04.1 §2 — pure island view-state. The probe (R2 single source of truth) decides everything:
//  - not resolved yet (null) → loading (rendered as the claim CTA — owner-agnostic, U10)
//  - not owned (anon / non-owner) → claimCta
//  - owned but the report isn't claimed yet → finishClaim (one-tap POST /claim on return from verify)
//  - owned + claimed → ownerControls (white-label + visibility)
export function viewStateFrom(probe: OwnershipProbe | null): OwnerView {
  if (probe === null) return 'loading';
  if (!probe.owned) return 'claimCta';
  return probe.claimed ? 'ownerControls' : 'finishClaim';
}
