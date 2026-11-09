/**
 * A running check's `progress` (the contract's ProgressSchema; the `checks_progress` constraint ties
 * it to `status = 'running'`): the crawl screen's steps and counts. Parsed before it is written.
 */
import { CheckPhaseSchema, ProgressSchema, type Check } from '@crawlmouse/types/v2';
import type { BatchAt, RunSoFar } from '../../../../../../inngest/check';

export type Progress = NonNullable<Check['progress']>;
export type Phase = Progress['steps'][number]['phase'];

const PHASES = CheckPhaseSchema.options;

/** The screen step a batch belongs to: the first crawl batch fetches the homepage. */
export const phaseOf = (at: BatchAt): Phase =>
  at.kind === 'access' ? 'crawler_tests' : at.batch === 1 ? 'homepage' : 'crawl';

export function progressOf(
  phase: Phase,
  so: Pick<RunSoFar, 'pagesCrawled' | 'linksFound'>,
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
  });
}
