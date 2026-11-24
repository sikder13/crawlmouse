/**
 * The time plan (plan §4, finding 8; CC-42A): how long a batch posted now may run. Its zero is the
 * first claim attempt (`RunSoFar.startedAt`). The fetching phases end by `fetchEndsAt`, the finish
 * timeout less RESERVE_S; the finish timeout holds the whole wait budget, so that end needs no time
 * added back. The crawl's end comes earlier: CRAWL_CEILING_S after the worker accepted the first
 * crawl batch, plus the busy time added back since (`addBackMs`), or ACCESS_SLICE_S before
 * `fetchEndsAt`. Before the first batch is accepted the crawl clock has not started, and the window
 * is measured from the post's own time, so that batch gets its full budget however long it waited. A batch's max_seconds is cut so that its deadline (max_seconds + the poll
 * grace) and the poll after it (one poll wait at most) fall before its phase's end; step latency
 * comes on top (time.test.ts simulates it).
 */
import type { BatchAt, RunSoFar } from '../../../../../../inngest/check';
import {
  ACCESS_SLICE_S,
  CRAWL_CEILING_S,
  MIN_BATCH_S,
  PACE,
  QUEUE_WAIT_MAX_S,
  RENDER_SHARE_S,
  RESERVE_S,
} from '../limits';

const S = 1000;

/** The end of the fetching phases. */
export const fetchEndsAt = (startedAt: number): number =>
  startedAt + (PACE.finishS - RESERVE_S) * S;

/**
 * When the render step, started at `stepStart`, must stop rendering: RENDER_SHARE_S after the earlier
 * of its start and the end of the fetching phases. A retried attempt, or one Inngest started late,
 * gets only what the share has left, so the steps after render keep the rest of RESERVE_S however
 * many attempts render takes.
 */
export const renderEndsAt = (stepStart: number, so: Pick<RunSoFar, 'startedAt'>): number =>
  Math.min(stepStart, fetchEndsAt(so.startedAt)) + RENDER_SHARE_S * S;

/**
 * The busy time after the first accepted crawl batch that is added back to the crawl's end: what
 * the one wait budget has left once the wait before that batch is paid; 0 before it.
 */
export function addBackMs(
  so: Pick<RunSoFar, 'crawlFrom' | 'busyMs' | 'busyBeforeCrawlMs'>,
): number {
  if (so.crawlFrom === null) return 0;
  return Math.max(0, Math.min(so.busyMs, QUEUE_WAIT_MAX_S * S) - so.busyBeforeCrawlMs);
}

/** When the phase of `at`, posted at `now`, must have ended. */
export function phaseEndsAt(at: Pick<BatchAt, 'kind'>, so: RunSoFar, now: number): number {
  const fetchEnd = fetchEndsAt(so.startedAt);
  if (at.kind === 'access') return fetchEnd;
  const crawlFrom = so.crawlFrom ?? now;
  return Math.min(crawlFrom + CRAWL_CEILING_S * S + addBackMs(so), fetchEnd - ACCESS_SLICE_S * S);
}

/**
 * The max_seconds of a batch posted at `now`: its budget's most, or what the phase has left after the
 * grace and one poll wait, whichever is less; null when that is under MIN_BATCH_S.
 */
export function batchSeconds(endsAt: number, now: number, most: number): number | null {
  const left = Math.floor((endsAt - now) / S) - PACE.pollGraceS - PACE.pollMaxS;
  const seconds = Math.min(most, left);
  return seconds >= MIN_BATCH_S ? seconds : null;
}
