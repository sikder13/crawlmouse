const ACTIVE = new Set(['active', 'trialing', 'past_due']);

/** Map a Stripe subscription status + period-end (unix secs) to a pro_until ISO string (or null). */
export function proUntilFrom(status: string, currentPeriodEndUnix: number | null): string | null {
  if (!ACTIVE.has(status) || !currentPeriodEndUnix) return null;
  return new Date(currentPeriodEndUnix * 1000).toISOString();
}
