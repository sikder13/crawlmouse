/**
 * What the site effects of an entitlement transition do to an account's primary sites (ARCH-2 §3.2):
 * `pause_others`, `pause_over_limit` and `resume`. Pure, so the rule is tested before the `sites`
 * table exists. Migration 003 creates that table and applies these changes inside
 * `apply_entitlement_transition`, with a PGlite test that runs this planner's cases against it.
 */
import { GATES, type Tier } from '../entitlement-v2';

export type Schedule = 'weekly' | 'monthly';
export type PausedReason = 'trial_ended' | 'over_limit' | 'user';
export type SiteEffect = 'pause_others' | 'pause_over_limit' | 'resume';

/** A primary site that has not been removed. Competitor and staging sites are not planned here. */
export interface PlannedSite {
  id: string;
  createdAt: Date;
  schedule: Schedule | null;
  pausedReason: PausedReason | null;
}

export interface SiteChange {
  id: string;
  schedule: Schedule | null;
  pausedReason: PausedReason | null;
}

function oldestFirst(sites: readonly PlannedSite[]): PlannedSite[] {
  return [...sites].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}

function change(
  site: PlannedSite,
  schedule: Schedule | null,
  pausedReason: PausedReason | null,
): SiteChange[] {
  if (site.schedule === schedule && site.pausedReason === pausedReason) return [];
  return [{ id: site.id, schedule, pausedReason }];
}

/**
 * The changes one site effect makes. A site the user paused stays paused under every effect.
 *
 * - `pause_others`: the oldest site keeps a monthly check; every other site pauses as `trial_ended`.
 * - `pause_over_limit`: the oldest `siteLimit` sites are untouched; running sites beyond them pause
 *   as `over_limit`.
 * - `resume`: sites paused as `trial_ended` or `over_limit` among the oldest `siteLimit` run again on
 *   the tier's schedule.
 */
export function planSites(
  effect: SiteEffect,
  sites: readonly PlannedSite[],
  tier: Tier,
  siteLimit: number,
): SiteChange[] {
  if (!Number.isInteger(siteLimit) || siteLimit < 1)
    throw new RangeError('siteLimit must be a whole number ≥ 1');
  const ordered = oldestFirst(sites);
  const changes: SiteChange[] = [];
  ordered.forEach((site, index) => {
    if (site.pausedReason === 'user') return;
    switch (effect) {
      case 'pause_others':
        changes.push(
          ...(index === 0 ? change(site, 'monthly', null) : change(site, null, 'trial_ended')),
        );
        return;
      case 'pause_over_limit':
        if (index >= siteLimit && site.schedule !== null)
          changes.push(...change(site, null, 'over_limit'));
        return;
      case 'resume':
        if (
          index < siteLimit &&
          (site.pausedReason === 'trial_ended' || site.pausedReason === 'over_limit')
        ) {
          changes.push(
            ...change(site, GATES[tier].schedule === 'weekly' ? 'weekly' : 'monthly', null),
          );
        }
        return;
    }
  });
  return changes;
}
