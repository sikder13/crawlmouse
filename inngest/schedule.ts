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
 * replay returns its recorded result and does not call it again; the SQL acts once besides. Chosen
 * over one function per site fanned out by event: here no claimed site can sit between a claim and a
 * send that failed, which a fan-out would need a second release for. The cost is that one site's
 * retries delay the sites after it in the same tick (past-due-sweep.ts makes the same trade).
 *
 * A page that comes back full is followed by another claim, up to SCHEDULE_ROUNDS; a page that is not
 * full, or a release, ends the claiming, so a site released in this run is claimed by the next one.
 */
import { sized } from './check';
import { inngest } from './client';
import { planSafeLimit } from './concurrency';

export const SCHEDULE_TICK_FN_ID = 'crawlmouse.schedule.tick';

/**
 * Sites per claim, so a page's step output stays under STEP_OUTPUT_BYTES: schedule.test.ts measures
 * the longest page there can be (a uuid and a `toISOString()` have fixed lengths).
 */
export const SCHEDULE_PAGE = 40;

/** Claims per tick: 200 sites an hour, 4,800 a day, under the daily ceiling of 5,000. */
export const SCHEDULE_ROUNDS = 5;

/** Attempts a step gets after its first. */
const RETRIES = 3;

/** The `global:audits:day` row a claim counted into, which a release gives the slot back to. */
export interface GlobalSlot {
  bucket: string;
  window_start: string;
}

/** A claimed site and the time it was due (ISO, `toISOString()`), which keys its request. */
export interface ClaimedSite {
  siteId: string;
  slot: string;
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
  /** Tells Sentry a claim was released. Called with the site id and slot and nothing else. */
  report(site: ClaimedSite): void;
}

export type TickOutput =
  | { paused: true }
  | { claimed: number; requested: number; released: number };

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

      const done = { claimed: 0, requested: 0, released: 0 };
      for (let round = 0; round < SCHEDULE_ROUNDS; round += 1) {
        const id = `claim-${round}`;
        const claim = (await step.run(id, async () =>
          sized(id, await deps().claim(SCHEDULE_PAGE)),
        )) as Claim;
        done.claimed += claim.sites.length;
        let releasedThisRound = false;
        for (const site of claim.sites) {
          const at = `${site.siteId}:${site.slot}`;
          try {
            await step.run(`request:${at}`, async () => {
              await deps().request(site);
            });
            done.requested += 1;
          } catch {
            await step.run(`release:${at}`, async () => {
              const d = deps();
              const out = await d.release(site, claim.global);
              try {
                d.report({ siteId: site.siteId, slot: site.slot });
              } catch {
                // A reporter that throws must not repeat the release.
              }
              return out;
            });
            done.released += 1;
            releasedThisRound = true;
          }
        }
        if (releasedThisRound || claim.sites.length < SCHEDULE_PAGE) break;
      }
      return done;
    },
  );
}
