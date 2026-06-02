import { isProActive } from '../pro';

export type PlanVariant = 'pro' | 'free';

export interface PlanCardModel {
  variant: PlanVariant;
  statusLabel: string;        // 'Pro' | 'Free plan'
  ctaLabel: string;           // 'Manage subscription' | 'Upgrade'
  ctaHref: '/billing' | '/pricing';
  /** ISO date to render (via LocalTime) when Pro & active; null otherwise. Kept raw so the
   *  view formats it in the viewer's locale — a pre-formatted string here would be both
   *  non-deterministic to unit-test and timezone-leaking on the server render. */
  proUntilIso: string | null;
}

/**
 * Pure model for the dashboard plan-status card. All branching lives here so it is
 * unit-testable without rendering. Pro-ness is derived from `proUntil` via the single
 * shared `isProActive` predicate (no second source of truth).
 */
export function planCardModel(
  { proUntil }: { proUntil: string | null | undefined },
  now: Date = new Date(),
): PlanCardModel {
  if (isProActive(proUntil, now)) {
    return {
      variant: 'pro',
      statusLabel: 'Pro',
      ctaLabel: 'Manage subscription',
      ctaHref: '/billing',
      proUntilIso: proUntil ?? null, // isProActive true ⇒ proUntil is a valid future ISO
    };
  }
  return {
    variant: 'free',
    statusLabel: 'Free plan',
    ctaLabel: 'Upgrade',
    ctaHref: '/pricing',
    proUntilIso: null,
  };
}
