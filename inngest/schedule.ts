/**
 * `crawlmouse.schedule.tick` (CC-28 D4): at the top of every hour, claims the sites whose scheduled
 * check is due and requests a check for each. Registered only with V2_PIPELINE=1 and
 * V2_CHECKS_PUBLIC=1 (apps/web/lib/v2/pipeline/functions.ts); its ports are
 * apps/web/lib/v2/monitor/schedule.ts's.
 *
 * Steps. `pause-gate` reads CRAWL_PAUSED once, as a step, so a pause set while a run is part-way
 * through cannot make a replay return after a claim and strand what it claimed. `claim-<n>` is
 * `claim_due_sites`: it takes a `global:audits:day` slot per site and moves each site's due time on,
 * and returns each site with the time it was due. `request:<site>:<slot>` is `requestCheck` with
 * trigger `scheduled`, keyed on that slot, so a retried step makes the same check and event id.
 *
 * Owner ruling Q9. A request step that has failed every retry is caught here, per site, and
 * `release:<site>:<slot>` gives back what the claim took (`release_scheduled_claim`: the due time,
 * and the slot while its day is open) and reports the site id and slot. The release is a step, so a
 * replay returns its recorded result and does not call it again; the SQL acts once besides. A release
 * step that has failed every retry too is caught as well: `release-failed:<site>:<slot>` reports it,
 * and the tick goes on to the next site. That site stays claimed: its due time stays moved on and its
 * slot spent until its next due time, and Sentry has its id and slot. Chosen over one function per
 * site fanned out by event, which would need a second release for a claim whose event never sent. The
 * cost is that one site's retries delay the sites after it in the same tick (past-due-sweep.ts makes
 * the same trade).
 *
 * A page that comes back full is followed by another claim, up to SCHEDULE_ROUNDS; a page that is not
 * full, or a request that failed every retry, ends the claiming, so a site released in this run is
 * claimed by the next one.
 */
import { sized } from './check';
import { inngest } from './client';
import { planSafeLimit } from './concurrency';

export const SCHEDULE_TICK_FN_ID = 'crawlmouse.schedule.tick';

/**
 * Sites per claim, so a page's step output stays under STEP_OUTPUT_BYTES: schedule.test.ts measures
 * the longest page there can be (a uuid and a `toISOString()` have fixed lengths).
 */
export const SCHEDULE_PAGE = 30;

/** Claims per tick: SCHEDULE_PAGE × SCHEDULE_ROUNDS = 180 sites an hour, 4,320 a day. */
export const SCHEDULE_ROUNDS = 6;

/** Attempts a step gets after its first. */
const RETRIES = 3;

/** The `global:audits:day` row a claim counted into, which a release gives the slot back to. */
export interface GlobalSlot {
  bucket: string;
  window_start: string;
}

/**
 * A claimed site, the time it was due (ISO, `toISOString()`), which keys its request, and the
 * next_check_at the claim set (`next`), which a release compares against.
 */
export interface ClaimedSite {
  siteId: string;
  slot: string;
  next: string;
}

export interface Claim {
  global: GlobalSlot;
  sites: ClaimedSite[];
}

export interface Released {
  restored: boolean;
  slot_released: boolean;
}

export interface ScheduleDeps {
  /** CRAWL_PAUSED (apps/web/lib/crawl-pause.ts). */
  paused(): boolean;
  /** `claim_due_sites` at the time now, for at most `limit` sites. */
  claim(limit: number): Promise<Claim>;
  /** `requestCheck` with trigger `scheduled`, keyed on `site.slot`. */
  request(site: ClaimedSite): Promise<{ checkId: string; created: boolean }>;
  /** `release_scheduled_claim` at the time now, against the row the claim counted into. */
  release(site: ClaimedSite, global: GlobalSlot): Promise<Released>;
  /** Tells Sentry a claim was released, or that its release failed, with the site id and slot only. */
  report(site: Pick<ClaimedSite, 'siteId' | 'slot'>, outcome: 'released' | 'release_failed'): void;
}

export type TickOutput =
  | { paused: true }
  | { claimed: number; requested: number; released: number; unreleased: number };

export function createScheduleTickFn(deps: () => ScheduleDeps) {
  return inngest.createFunction(
    {
      id: SCHEDULE_TICK_FN_ID,
      concurrency: { limit: planSafeLimit('1', 1) },
      retries: RETRIES,
    },
    { cron: '0 * * * *' },
    async ({ step }): Promise<TickOutput> => {
      const paused = await step.run('pause-gate', async () => deps().paused());
      if (paused) return { paused: true };

      const done = { claimed: 0, requested: 0, released: 0, unreleased: 0 };
      for (let round = 0; round < SCHEDULE_ROUNDS; round += 1) {
        const id = `claim-${round}`;
        const claim = (await step.run(id, async () =>
          sized(id, await deps().claim(SCHEDULE_PAGE)),
        )) as Claim;
        done.claimed += claim.sites.length;
        let failedThisRound = false;
        for (const site of claim.sites) {
          const at = `${site.siteId}:${site.slot}`;
          const ids = { siteId: site.siteId, slot: site.slot };
          try {
            await step.run(`request:${at}`, async () => {
              await deps().request(site);
            });
            done.requested += 1;
            continue;
          } catch {
            failedThisRound = true;
          }
          try {
            await step.run(`release:${at}`, async () => {
              const d = deps();
              const out = await d.release(site, claim.global);
              try {
                d.report(ids, 'released');
              } catch {
                // A reporter that throws must not repeat the release.
              }
              return out;
            });
            done.released += 1;
          } catch {
            await step.run(`release-failed:${at}`, async () => {
              try {
                deps().report(ids, 'release_failed');
              } catch {
                // Nothing is left to undo; a reporter that throws must not end the tick.
              }
            });
            done.unreleased += 1;
          }
        }
        if (failedThisRound || claim.sites.length < SCHEDULE_PAGE) break;
      }
      return done;
    },
  );
}
