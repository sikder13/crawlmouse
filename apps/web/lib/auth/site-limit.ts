/**
 * How many sites an account may keep now: its stored `site_limit`, but never more than its tier at
 * this moment allows. A no-card trial past `trial_ends_at` keeps `pro_trial` and a limit of 5 until
 * `trial_expired` is applied, and a `past_due` account keeps its paid limit past the grace period;
 * `effectiveTier` reads both clocks, so either counts as Free here.
 */
import { effectiveTier, GATES, type EntitlementClock } from '../entitlement-v2';

export function siteLimitAt(account: EntitlementClock & { siteLimit: number }, now: Date): number {
  return Math.min(account.siteLimit, GATES[effectiveTier(account, now)].maxSites);
}
