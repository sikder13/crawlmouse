/**
 * The time plan (plan §4, finding 8): how long a batch posted now may run. Its zero is the first
 * claim attempt (`RunSoFar.startedAt`). The fetching phases end by `fetchEndsAt`, the finish timeout
 * less RESERVE_S; the crawl's end comes earlier, CRAWL_CEILING_S after discovery, or ACCESS_SLICE_S
 * before `fetchEndsAt`. A batch's max_seconds is cut so that its deadline (max_seconds + the poll
 * grace) and the poll after it (one poll wait at most) fall before its phase's end; step latency
 * comes on top (time.test.ts simulates it).
 */
import type { BatchAt, RunSoFar } from '../../../../../../inngest/check';
import { ACCESS_SLICE_S, CRAWL_CEILING_S, MIN_BATCH_S, PACE, RESERVE_S } from '../limits';

const S = 1000;

/** The end of the fetching phases. */
export const fetchEndsAt = (startedAt: number): number =>
  startedAt + (PACE.finishS - RESERVE_S) * S;

/** When the phase of `at` must have ended. */
export function phaseEndsAt(at: Pick<BatchAt, 'kind'>, so: RunSoFar): number {
  const fetchEnd = fetchEndsAt(so.startedAt);
  if (at.kind === 'access') return fetchEnd;
  const crawlFrom = so.crawlFrom ?? so.startedAt;
  return Math.min(crawlFrom + CRAWL_CEILING_S * S, fetchEnd - ACCESS_SLICE_S * S);
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
