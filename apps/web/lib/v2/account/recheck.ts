/**
 * The re-check request a route makes for a site (D4, D5): workstream A implements it over migration
 * 20261112000001's capped insert and `requestCheck`; the mark-done route (B) calls it with
 * `fix_recheck`. The caller has already established membership and read the site's entitlement.
 */
export type RecheckTrigger = 'manual' | 'fix_recheck';

export type RecheckOutcome =
  /** A check was queued now, or this 2-minute bucket's check is still queued. */
  | { queued: true; checkId: string; created: boolean }
  /** The site's re-checks in the last 24 hours are at the cap; the next is allowed then. */
  | { queued: false; reason: 'capped'; nextAllowedAt: string }
  /** This bucket's check has already started, so it cannot take this request (plan revision R6). */
  | { queued: false; reason: 'check_running'; checkId: string }
  /** The day's `global:audits:day` ceiling is reached (owner ruling: the global ceiling). */
  | { queued: false; reason: 'capacity' }
  | { queued: false; reason: 'removed' | 'paused' };

export interface RecheckRequest {
  siteId: string;
  trigger: RecheckTrigger;
  /** `GATES[tier].manualChecksPerSiteDay` of the site's own account. */
  cap: number;
  requestedByUserId: string;
}

export type RequestRecheck = (req: RecheckRequest) => Promise<RecheckOutcome>;
