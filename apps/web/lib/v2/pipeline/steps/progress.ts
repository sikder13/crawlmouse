/**
 * A running check's `progress` (the contract's ProgressSchema; the `checks_progress` constraint ties
 * it to `status = 'running'`): the crawl screen's steps and counts. Parsed before it is written.
 */
import { CheckPhaseSchema, ProgressSchema, type Check } from '@crawlmouse/types/v2';
import type { BatchAt, RunSoFar } from '../../../../../../inngest/check';

export type Progress = NonNullable<Check['progress']>;
export type Phase = Progress['steps'][number]['phase'];

const PHASES = CheckPhaseSchema.options;

/**
 * The screen step a batch belongs to: the first crawl batch fetches the homepage. That is batch 1, or
 * `firstBatch` on a check's retry run (F-260), which numbers its batches past the first run's.
 */
export const phaseOf = (at: BatchAt, firstBatch = 1): Phase =>
  at.kind === 'access' ? 'crawler_tests' : at.batch === firstBatch ? 'homepage' : 'crawl';

/**
 * `so.waitingSince` is written as `waiting_since`: the post step passes its own when the worker has
 * just answered busy, and null once a batch is taken. `so.discovered` is what discovery found.
 */
export function progressOf(
  phase: Phase,
  so: Pick<RunSoFar, 'pagesCrawled' | 'linksFound' | 'discovered' | 'waitingSince'>,
  elapsedMs: number,
): Progress {
  const now = PHASES.indexOf(phase);
  return ProgressSchema.parse({
    steps: PHASES.map((p, i) => ({
      phase: p,
      state: i < now ? 'done' : i === now ? 'now' : 'next',
    })),
    pages_crawled: so.pagesCrawled,
    pages_estimated: null,
    links_found: so.linksFound,
    elapsed_ms: Math.max(0, Math.round(elapsedMs)),
    // The URLs fetched are in the stored batch results, not in step outputs.
    recent_fetches: [],
    waiting_since: so.waitingSince === null ? null : new Date(so.waitingSince).toISOString(),
    sitemap_urls: so.discovered?.sitemap_urls ?? null,
    robots_txt: so.discovered?.robots_txt ?? null,
  });
}
