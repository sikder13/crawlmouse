import type { Tier, Entitlement } from '@crawlmouse/types';
import { isProActive } from './pro';

/**
 * The subset of a `users` row needed to derive a viewer's tier. The `tier` column lands in Step E's
 * migration; until then it is simply absent (never 'agency') — which is precisely the seam: the value
 * type + entitlement map support agency, but no code path SETS it in this phase.
 */
export interface TierUserRow {
  pro_until?: string | null;
  tier?: string | null;
}

/**
 * Derive a viewer's tier SERVER-SIDE. Never trust a client-asserted tier. An explicit `tier='agency'`
 * wins (the seam); otherwise an active `pro_until` ⇒ 'pro', else 'free'.
 */
export function deriveTier(user: TierUserRow | null | undefined, now: Date = new Date()): Tier {
  if (user?.tier === 'agency') return 'agency';
  if (isProActive(user?.pro_until ?? null, now)) return 'pro';
  return 'free';
}

/**
 * Map a tier to its capability gates. Recomputed server-side on every request — the client can never
 * assert these. `agency` is the only tier with white-label, and no code path produces 'agency' yet, so
 * `canWhiteLabel` is effectively false for everyone this phase.
 */
export function entitlementFor(tier: Tier, proUntil: string | null): Entitlement {
  const paid = tier === 'pro' || tier === 'agency';
  return {
    tier,
    proUntil,
    canSeeAllPrescriptions: paid,
    canUseActionPackets: paid,
    canMonitor: paid,
    canSeeFullSiteGrade: paid,
    canWhiteLabel: tier === 'agency',
  };
}
