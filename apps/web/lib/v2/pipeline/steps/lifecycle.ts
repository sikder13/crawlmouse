/**
 * The steps that start and end a check outside its batches: claim, discover and fail, and what the
 * cancel handler and the reaper run.
 */
import type {
  CancelledCheck,
  CancelledRun,
  CheckSteps,
  ClaimedSite,
  FailOutput,
} from '../../../../../../inngest/check';
import type { FailureReason } from '../../../../../../inngest/check-events';
import type { ReapedCheck } from '../../../../../../inngest/check-reaper';
import { isCrawlPaused } from '../../../crawl-pause';
import { discoverSeeds } from '../discover';
import { putJson } from '../evidence';
import { REAP_AFTER_S } from '../limits';
import { homepageOf } from '../request';
import type { PipelineStore } from '../store';
import type { StepDeps } from './deps';
import { progressOf } from './progress';
import { iso, pathOf } from './stored';

const NOTHING_YET = { pagesCrawled: 0, linksFound: 0, discovered: null, waitingSince: null };

export function lifecycleSteps(
  deps: StepDeps,
): Pick<CheckSteps, 'claim' | 'discover' | 'fail' | 'requeue'> {
  return {
    /**
     * CRAWL_PAUSED first (v1's rule, Q12), then `claim_check`. `at` is this attempt's time; the first
     * attempt's is the time plan's zero. A claimed check's site is read back from the database.
     */
    async claim(event, { runId, startedAt }) {
      const at = deps.now();
      if (isCrawlPaused(deps.env)) return { outcome: 'paused', at };
      const elapsed = startedAt === null ? 0 : at - startedAt;
      const outcome = await deps.store.claim(
        event.checkId,
        runId,
        progressOf('robots_and_sitemap', NOTHING_YET, elapsed),
      );
      if (outcome !== 'claimed') return { outcome, at };
      return { outcome, at, site: await claimedSite(deps.store, event.checkId) };
    },

    async discover(event, so) {
      const { seeds, sitemapUrls, robotsTxt } = await discoverSeeds(
        event.homepageUrl,
        deps.discover,
      );
      await putJson(deps.evidence, pathOf(event, 'seeds'), seeds);
      const at = deps.now();
      const discovered = { sitemap_urls: sitemapUrls, robots_txt: robotsTxt };
      await deps.store.progress(
        event.checkId,
        progressOf('homepage', { ...so, discovered }, at - so.startedAt),
        iso(at),
      );
      return { seeds: seeds.length, sitemap_urls: sitemapUrls, robots_txt: robotsTxt, at };
    },

    fail: (event, reason) => failCheck(deps.store, event.checkId, reason),

    /**
     * F-260: the check queued again for its one retry, by the run that claimed it; then the first
     * run's stored batch results removed, named from its batch rows as expiry and the purge name a
     * check's objects (keep.ts `objectNames`), and only then the rows deleted. Nothing is removed for a
     * check that is another run's or has ended. A retried step finds the check queued with no run and
     * the rows that are left, and removes again.
     */
    async requeue(event, runId) {
      if (!(await deps.store.requeue(event.checkId, runId, iso(deps.now())))) {
        return { requeued: false };
      }
      const rows = await deps.store.batches(event.checkId);
      if (rows.length > 0) {
        await deps.evidence.remove(rows.map((r) => pathOf(event, `batch-${r.batch}`)));
      }
      await deps.store.deleteBatches(event.checkId);
      return { requeued: true };
    },
  };
}

/** A claimed check's site as the database holds it: the row's site, its account and host. */
async function claimedSite(
  store: Pick<PipelineStore, 'siteOf' | 'requestSite'>,
  checkId: string,
): Promise<ClaimedSite> {
  const siteId = await store.siteOf(checkId);
  if (siteId === null) throw new Error(`claim: check ${checkId} has no row after its claim`);
  const site = await store.requestSite(siteId);
  return {
    siteId: site.id,
    accountId: site.account_id,
    host: site.host,
    homepageUrl: homepageOf(site.host),
  };
}

/**
 * The words migration 20261122000002 adds. The app deploys on merge and the owner applies the
 * migration after it, so for a while `fail_check` refuses them. A check thrown out of its build has
 * onFailure as its one writer: without this it would stay `running`, holding its site, until the
 * reaper. Delete this once the migration is applied in production.
 */
const AWAITING_MIGRATION: readonly FailureReason[] = ['site_unreachable', 'nothing_read'];
const WORD_REFUSED = /the reason is not one of check_failure_reasons\(\)/;

/** `fail_check` with `reason`; `internal` if the database does not list that word yet, then `as` says so. */
async function failWith(
  store: Pick<PipelineStore, 'fail'>,
  checkId: string,
  reason: FailureReason,
): Promise<{ failed: boolean; as?: FailureReason }> {
  try {
    return { failed: await store.fail(checkId, reason, null) };
  } catch (error) {
    const refused = error instanceof Error && WORD_REFUSED.test(error.message);
    if (!refused || !AWAITING_MIGRATION.includes(reason)) throw error;
    return { failed: await store.fail(checkId, 'internal', null), as: 'internal' };
  }
}

/**
 * Fails the check by its id unless it has ended; what runCheck's `fail` and onFailure run. A failed
 * check's site is read from its row, so check.failed names the site the database holds it under,
 * whatever the event said (security 6).
 */
export async function failCheck(
  store: Pick<PipelineStore, 'fail' | 'siteOf'>,
  checkId: string,
  reason: FailureReason,
): Promise<FailOutput> {
  const { failed, as } = await failWith(store, checkId, reason);
  if (!failed) return { failed: false };
  const siteId = await store.siteOf(checkId);
  if (siteId === null) throw new Error(`fail: check ${checkId} has no row after it failed`);
  return as ? { failed: true, siteId, as } : { failed: true, siteId };
}

/**
 * The cancel handler's work: the triggering event's check failed `canceled`, whether or not a run had
 * claimed it; without that id, the check the run claimed. Null when no check is failed `canceled`.
 */
export async function failCancelled(
  store: Pick<PipelineStore, 'checkOfRun' | 'fail' | 'siteOf'>,
  run: CancelledRun,
): Promise<CancelledCheck | null> {
  if (run.checkId !== null) {
    const out = await failCheck(store, run.checkId, 'canceled');
    return out.failed ? { checkId: run.checkId, siteId: out.siteId } : null;
  }
  const claimed = await store.checkOfRun(run.runId);
  if (claimed === null) return null;
  return (await store.fail(null, 'canceled', run.runId)) ? claimed : null;
}

/** The reaper's cutoff: a heartbeat before it is REAP_AFTER_S old. */
export const reapCutoff = (now: number): string => iso(now - REAP_AFTER_S * 1000);

export const reapStalled = (
  store: Pick<PipelineStore, 'reap'>,
  now: () => number,
): Promise<ReapedCheck[]> => store.reap(reapCutoff(now()));
