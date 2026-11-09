/**
 * The steps that start and end a check outside its batches: claim, discover and fail, and what the
 * cancel handler and the reaper run.
 */
import type { CancelledCheck, CheckSteps } from '../../../../../../inngest/check';
import type { ReapedCheck } from '../../../../../../inngest/check-reaper';
import { isCrawlPaused } from '../../../crawl-pause';
import { discoverSeeds } from '../discover';
import { putJson } from '../evidence';
import { REAP_AFTER_S } from '../limits';
import type { PipelineStore } from '../store';
import type { StepDeps } from './deps';
import { progressOf } from './progress';
import { iso, pathOf } from './stored';

const NOTHING_YET = { pagesCrawled: 0, linksFound: 0 };

export function lifecycleSteps(deps: StepDeps): Pick<CheckSteps, 'claim' | 'discover' | 'fail'> {
  return {
    /**
     * CRAWL_PAUSED first (v1's rule, Q12), then `claim_check`. `at` is this attempt's time; the first
     * attempt's is the time plan's zero.
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
      return { outcome, at };
    },

    async discover(event, so) {
      const { seeds, sitemapUrls } = await discoverSeeds(event.homepageUrl, deps.discover);
      await putJson(deps.evidence, pathOf(event, 'seeds'), seeds);
      const at = deps.now();
      await deps.store.progress(
        event.checkId,
        progressOf('homepage', so, at - so.startedAt),
        iso(at),
      );
      return { seeds: seeds.length, sitemap_urls: sitemapUrls, at };
    },

    async fail(event, reason) {
      return { failed: await deps.store.fail(event.checkId, reason, null) };
    },
  };
}

/** The cancel handler's work: the check the run claimed, failed `canceled`; null when none moved. */
export async function failCancelled(
  store: Pick<PipelineStore, 'checkOfRun' | 'fail'>,
  runId: string,
): Promise<CancelledCheck | null> {
  const claimed = await store.checkOfRun(runId);
  if (claimed === null) return null;
  return (await store.fail(null, 'canceled', runId)) ? claimed : null;
}

/** The reaper's cutoff: a heartbeat before it is REAP_AFTER_S old. */
export const reapCutoff = (now: number): string => iso(now - REAP_AFTER_S * 1000);

export const reapStalled = (
  store: Pick<PipelineStore, 'reap'>,
  now: () => number,
): Promise<ReapedCheck[]> => store.reap(reapCutoff(now()));
