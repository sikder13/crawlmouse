/**
 * Row 23: the daily sentinel's work, which `crawlmouse.sentinel.tick` and `crawlmouse.sentinel.watch`
 * (inngest/sentinel.ts) run in steps.
 *
 * - `dispatch(hour, day)`: sends one `sentinel.watch` per site watched this hour: kept, live,
 *   unpaused, not staging, its account not marked for deletion and on a paid tier now
 *   (`effectiveTier`), whose `sentinelHour` is `hour`.
 * - `look(site, day, n)`: the latest full check's pages, one per template (`pickPages`), as one
 *   worker access batch under the look's own id (`lookCheckId`), which no `checks` row holds: the
 *   worker keeps batches in memory and reads no database, and nothing of a look is stored.
 * - `result(baseline, batch)`: the batch's answer compared with that full check's (`movements`).
 * - `request(site, day)`: one full check, keyed on the watch's UTC day (`requestCheck`'s
 *   `sentinelDay`), within the day's ceiling on starts. Its diff and the existing alert rules raise
 *   the alert.
 *
 * `dispatch`, `look` and `request` do nothing while the sentinel is hidden
 * (`featureShown('sentinel')`) or crawling is paused; `result` only reads a look already posted.
 * `look` and `request` also apply `dispatch`'s site rule again to their one site, which may have
 * been removed, paused or downgraded since the tick picked it.
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import { IdentityRoleSchema, VerdictSchema } from '@crawlmouse/types/v2';
import { z } from 'zod';
import { effectiveTier } from '../../entitlement-v2';
import { batchIdOf, WorkerError, type WorkerClient } from '../../worker-client/types';
import { clockFromAccountRow } from '../pipeline/load-for';
import { movements, pickPages, sentinelHour, type Look, type TestedPage } from './sentinel';

/** A look's budget: a few pages as seven identities, well inside an access batch's. */
export const SENTINEL_LOOK_BUDGET = {
  max_requests: 120,
  max_bytes: 16 * 1024 * 1024,
  max_seconds: 120,
} as const;

/** Sites read per page of `watchableSites`. */
export const SENTINEL_PAGE = 200;

export interface WatchableSite {
  siteId: string;
  host: string;
  /** The account's row, as `clockFromAccountRow` reads it. */
  account: Record<string, unknown>;
}

export type BaselineTest = TestedPage & Look;

export interface SentinelStore {
  /**
   * One page of kept, live, unpaused, non-staging site rows in id order from `offset`,
   * `SENTINEL_PAGE` rows at most: `scanned` is how many rows the page read, and `sites` those of
   * them whose account is not marked for deletion. The scan ends on `scanned`, never on
   * `sites.length`, which the account filter can shorten.
   */
  watchableSites(offset: number): Promise<{ sites: WatchableSite[]; scanned: number }>;
  /** The site, when it passes the same rule as `watchableSites`; null otherwise. */
  watchableSite(siteId: string): Promise<WatchableSite | null>;
  /** The site's latest finished or partial check, its host and its access tests; null for none. */
  baseline(
    siteId: string,
  ): Promise<{ checkId: string; host: string; tests: BaselineTest[] } | null>;
  /** A check's access tests. */
  testsOf(checkId: string): Promise<BaselineTest[]>;
}

export interface SentinelDeps {
  store: SentinelStore;
  shown(): boolean;
  paused(): boolean;
  now(): number;
  /** Null when no worker is configured. */
  worker(): WorkerClient | null;
  nonce(): string;
  /** The day's ceiling on check starts; false when reached or not counted. */
  global(): Promise<boolean>;
  /** `requestCheck` with trigger `scheduled` and `sentinelDay`; answers the check id. */
  request(siteId: string, day: string): Promise<string>;
  /** `inngest.send` for a list of events. */
  send(
    events: { id: string; name: 'sentinel.watch'; data: { siteId: string; day: string } }[],
  ): Promise<unknown>;
}

/** The id a look's batch is posted under: one per site, day and attempt. */
export const lookCheckId = (siteId: string, day: string, n: number): string =>
  stableId('sentinel_look', siteId, day, String(n));

/** What a look's answer is read for; the rest of the worker's result is not kept. */
const LookResultSchema = z.object({
  kind: z.literal('access'),
  access_tests: z.array(
    z.object({
      identity_role: IdentityRoleSchema,
      ua: z.string().nullable(),
      template_key: z.string(),
      verdict: VerdictSchema,
      word_count: z.number().int().min(0).nullable(),
    }),
  ),
});

/** Events a dispatch sends per request to Inngest. */
export const SENTINEL_SEND_CHUNK = 100;

export function sentinelWork(deps: SentinelDeps) {
  /** No look and no full check while the sentinel is hidden or crawling is paused. */
  const stopped = (): string | null =>
    !deps.shown() ? 'hidden' : deps.paused() ? 'crawl_paused' : null;
  /** A paid site the sentinel may watch at `now`: the rule `dispatch` applies to each site. */
  const watched = (s: WatchableSite, now: Date): boolean =>
    effectiveTier(clockFromAccountRow(s.account), now) !== 'free';
  /**
   * Whether a site picked by the tick may still be watched: a watch runs up to an hour after, and
   * the site may have been removed or paused, or its account downgraded or marked for deletion.
   */
  const stillWatched = async (siteId: string): Promise<boolean> => {
    const s = await deps.store.watchableSite(siteId);
    return s !== null && watched(s, new Date(deps.now()));
  };

  return {
    /**
     * Sends one `sentinel.watch` per paid site due at `hour` on `day`, SENTINEL_SEND_CHUNK at a time,
     * each with the event id `sentinel-watch:{site}:{day}`, so a retry sends nothing twice. Answers
     * a count only: the list stays out of the step's output, however many sites are due.
     */
    async dispatch(hour: number, day: string): Promise<{ skip: string } | { watched: number }> {
      const stop = stopped();
      if (stop) return { skip: stop };
      const now = new Date(deps.now());
      const siteIds: string[] = [];
      for (let offset = 0; ; offset += SENTINEL_PAGE) {
        const page = await deps.store.watchableSites(offset);
        for (const s of page.sites) {
          if (sentinelHour(s.siteId) === hour && watched(s, now)) siteIds.push(s.siteId);
        }
        if (page.scanned < SENTINEL_PAGE) break;
      }
      for (let i = 0; i < siteIds.length; i += SENTINEL_SEND_CHUNK) {
        await deps.send(
          siteIds.slice(i, i + SENTINEL_SEND_CHUNK).map((siteId) => ({
            id: `sentinel-watch:${siteId}:${day}`,
            name: 'sentinel.watch' as const,
            data: { siteId, day },
          })),
        );
      }
      return { watched: siteIds.length };
    },

    /**
     * Look `n` on `day`: the latest full check's pages, one per template, posted to the worker as
     * one access batch. A worker that is busy or paused gives no evidence, and the look is skipped. A batch
     * the worker already holds under this look's id (a retry after a lost answer) is read, not
     * posted again.
     */
    async look(
      siteId: string,
      day: string,
      n: number,
    ): Promise<{ skip: string } | { batchId: string; baseline: string }> {
      const stop = stopped();
      if (stop) return { skip: stop };
      if (!(await stillWatched(siteId))) return { skip: 'not_watched' };
      const base = await deps.store.baseline(siteId);
      if (base === null) return { skip: 'no_baseline' };
      const pages = pickPages(base.tests);
      if (pages.length === 0) return { skip: 'no_pages' };
      const worker = deps.worker();
      if (worker === null) return { skip: 'no_worker' };
      const checkId = lookCheckId(siteId, day, n);
      try {
        const posted = await worker.postBatch({
          kind: 'access',
          check_id: checkId,
          site_id: siteId,
          site_host: base.host,
          batch: 0,
          nonce: deps.nonce(),
          budget: SENTINEL_LOOK_BUDGET,
          pages,
        });
        return { batchId: posted.batch_id, baseline: base.checkId };
      } catch (e) {
        if (e instanceof WorkerError && e.kind === 'batch_exists') {
          return { batchId: batchIdOf(checkId, 0), baseline: base.checkId };
        }
        if (e instanceof WorkerError && e.kind === 'busy') return { skip: 'worker_busy' };
        if (e instanceof WorkerError && e.kind === 'paused') return { skip: 'worker_paused' };
        throw e;
      }
    },

    /** The look's answer compared with `baseline`, the full check its look was made from. */
    async result(
      baseline: string,
      batchId: string,
    ): Promise<{ status: 'running' | 'failed' } | { status: 'done'; moved: number }> {
      const worker = deps.worker();
      if (worker === null) return { status: 'failed' };
      const poll = await worker.pollBatch(batchId);
      if (poll.status === 'running') return { status: 'running' };
      if (poll.status !== 'done') return { status: 'failed' };
      const parsed = LookResultSchema.safeParse(poll.result);
      if (!parsed.success) return { status: 'failed' };
      const tests = await deps.store.testsOf(baseline);
      return { status: 'done', moved: movements(tests, parsed.data.access_tests).length };
    },

    /** One full check of the site on `day`, the watch event's day. */
    async request(siteId: string, day: string): Promise<{ skip: string } | { checkId: string }> {
      const stop = stopped();
      if (stop) return { skip: stop };
      if (!(await stillWatched(siteId))) return { skip: 'not_watched' };
      if (!(await deps.global())) return { skip: 'capacity' };
      return { checkId: await deps.request(siteId, day) };
    },
  };
}

export type SentinelWork = ReturnType<typeof sentinelWork>;
