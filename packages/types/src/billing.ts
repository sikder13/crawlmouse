// Shared billing logic so the Stripe webhook handler (apps/web) and the reconciliation
// cron (@crawlmouse/inngest) compute Pro entitlement identically and can't drift.

/** Subscription statuses that grant Pro. */
export const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * current_period_end (unix seconds) for a Stripe subscription — top-level on older API
 * versions, on the subscription item in newer ones. Returns whichever is present, else null.
 */
export function subscriptionPeriodEnd(sub: {
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> };
}): number | null {
  return sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
}

/** Map a subscription status + period-end (unix secs) to a pro_until ISO string (or null). */
export function proUntilFrom(status: string, currentPeriodEndUnix: number | null): string | null {
  if (!ACTIVE_STATUSES.has(status) || !currentPeriodEndUnix) return null;
  return new Date(currentPeriodEndUnix * 1000).toISOString();
}
