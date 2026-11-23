/**
 * What a no-card trial's end does to an account's sites, as the reminder says it while paid plans are
 * closed. It reads the rule the database applies (`apply_entitlement_transition`, migration 003, and
 * `planSites`): primary sites oldest first; the oldest takes Free's monthly check unless its owner
 * paused it, in which case it stays paused and no site takes one; every other running site pauses,
 * and so does every running staging copy. The numbers come from `GATES.free`.
 */
import { oldestFirst } from '../../billing/state-machine-sites';
import { GATES } from '../../entitlement-v2';
import { TRIAL_END_COPY } from '../copy/trial-end';
import { FREE_SCHEDULE } from '../view/account-shell';
import { numberWord, plural } from '../words';

/** A site of the account that has not been removed. */
export interface TrialSite {
  id: string;
  host: string;
  createdAt: Date;
  pausedReason: string | null;
  stagingOfSiteId: string | null;
}

export interface AfterTrial {
  /** The oldest primary site; null with none. `paused`: its owner paused it, so it stays paused. */
  kept: { host: string; paused: boolean } | null;
  /** Primary sites running now that the move to Free pauses. */
  othersPausing: number;
  /** Staging copies running now that the move to Free pauses. */
  stagingPausing: number;
  /** Active seats other than the owner's: Free keeps one seat, so the move removes these. */
  otherSeats: number;
}

export function afterTrial(sites: readonly TrialSite[], otherSeats = 0): AfterTrial {
  const primary = oldestFirst(sites.filter((s) => s.stagingOfSiteId === null));
  const [oldest, ...others] = primary;
  return {
    kept: oldest ? { host: oldest.host, paused: oldest.pausedReason === 'user' } : null,
    othersPausing: others.filter((s) => s.pausedReason === null).length,
    stagingPausing: sites.filter((s) => s.stagingOfSiteId !== null && s.pausedReason === null)
      .length,
    otherSeats,
  };
}

/** "Your other 5 sites and 1 staging copy pause, with their history kept."; null with none. */
function pausesSentence(others: number, staging: number): string | null {
  const copies = `${staging} staging ${plural(staging, 'copy', 'copies')}`;
  if (others > 0) {
    const sites = others === 1 ? 'Your other site' : `Your other ${others} sites`;
    return staging > 0
      ? `${sites} and ${copies} pause, with their history kept.`
      : `${sites} ${plural(others, 'pauses', 'pause')}, with ${plural(others, 'its', 'their')} history kept.`;
  }
  if (staging === 0) return null;
  return staging === 1
    ? 'Your staging copy pauses, with its history kept.'
    : `Your ${copies} pause, with their history kept.`;
}

/** The reminder's paragraph on what stays, what pauses and who loses access. */
export function afterTrialSentence(after: AfterTrial): string {
  const sites = sitesSentence(after);
  return after.otherSeats > 0 ? `${sites} ${TRIAL_END_COPY.seatsLost(after.otherSeats)}` : sites;
}

function sitesSentence({ kept, othersPausing, stagingPausing }: AfterTrial): string {
  const fixes = GATES.free.fixesVisible;
  const free = `a ${FREE_SCHEDULE[GATES.free.schedule]} check and ${
    fixes === 'all' ? 'all' : numberWord(fixes)
  } fixes per audit`;
  if (kept === null) {
    const n = GATES.free.sites;
    return `This account has no sites yet. Free covers ${numberWord(n)} ${plural(n, 'site', 'sites')}, with ${free}.`;
  }
  const stays = kept.paused
    ? `${kept.host} stays paused, as you left it, so no site keeps a scheduled check.`
    : `${kept.host} stays, with ${free}.`;
  const pauses = pausesSentence(othersPausing, stagingPausing);
  return pauses ? `${stays} ${pauses}` : stays;
}
