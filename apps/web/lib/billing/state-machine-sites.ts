/**
 * What an entitlement transition does to an account's sites. `planSites` plans the site effects on
 * primary sites (ARCH-2 §3.2): `pause_others`, `pause_over_limit` and `resume`. `planStagingSites`
 * plans staging sites, from the new tier's gates alone (owner ruling, 2026-11-02). Pure, so the rules
 * are tested without a database. Migration 003 applies both inside `apply_entitlement_transition`,
 * and apps/web/__tests__/v2-003-site-effects.test.ts runs both planners against it.
 */
import { GATES, type Tier } from '../entitlement-v2';

export type Schedule = 'weekly' | 'monthly';
export type PausedReason = 'trial_ended' | 'over_limit' | 'staging_not_in_plan' | 'user';
export type SiteEffect = 'pause_others' | 'pause_over_limit' | 'resume';

/** A primary site that has not been removed. Staging sites are planned by `planStagingSites`. */
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
 * - `resume`: the oldest `siteLimit` sites run on the tier's schedule: paused ones (`trial_ended`,
 *   `over_limit`) start again, and the first site leaves Free's monthly check.
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
        if (index < siteLimit) {
          changes.push(
            ...change(site, GATES[tier].schedule === 'weekly' ? 'weekly' : 'monthly', null),
          );
        }
        return;
    }
  });
  return changes;
}

/** A staging site (one with `staging_of_site_id`) that has not been removed. */
export interface PlannedStagingSite {
  id: string;
  pausedReason: PausedReason | null;
}

export interface StagingChange {
  id: string;
  pausedReason: PausedReason | null;
}

/**
 * The changes a transition to `tier` makes to the account's staging sites. They depend on the tier
 * alone, not on the site effect, so they apply on every transition.
 *
 * - A tier without staging (`GATES[tier].stagingAndDeployHooks` false) pauses a running staging site
 *   as `staging_not_in_plan`.
 * - A tier with staging runs again a staging site paused as `staging_not_in_plan`.
 *
 * A staging site paused for another reason, the user's included, is not changed. The schedule is not
 * planned: a paused site keeps it.
 */
export function planStagingSites(
  sites: readonly PlannedStagingSite[],
  tier: Tier,
): StagingChange[] {
  const allowed = GATES[tier].stagingAndDeployHooks;
  const changes: StagingChange[] = [];
  for (const site of sites) {
    if (!allowed && site.pausedReason === null)
      changes.push({ id: site.id, pausedReason: 'staging_not_in_plan' });
    else if (allowed && site.pausedReason === 'staging_not_in_plan')
      changes.push({ id: site.id, pausedReason: null });
  }
  return changes;
}
