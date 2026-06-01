// Subscription statuses that grant Pro. Shared so the webhook handler and the
// reconciliation cron can't drift on what "active" means.
export const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** Map a Stripe subscription status + period-end (unix secs) to a pro_until ISO string (or null). */
export function proUntilFrom(status: string, currentPeriodEndUnix: number | null): string | null {
  if (!ACTIVE_STATUSES.has(status) || !currentPeriodEndUnix) return null;
  return new Date(currentPeriodEndUnix * 1000).toISOString();
}
