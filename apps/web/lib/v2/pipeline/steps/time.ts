/**
 * The time plan (plan §4, finding 8): how long a batch posted now may run. Its zero is the first
 * claim attempt (`RunSoFar.startedAt`). Every fetching phase ends by `fetchEndsAt`, the finish
 * timeout less RESERVE_S; the crawl also ends by CRAWL_CEILING_S after discovery and leaves
 * ACCESS_SLICE_S to the access stages. A batch's max_seconds is cut so that its deadline
 * (max_seconds + the poll grace) and the last poll after it (one poll wait at most) fall before its
 * phase ends.
 */
import type { BatchAt, RunSoFar } from '../../../../../../inngest/check';
import { ACCESS_SLICE_S, CRAWL_CEILING_S, MIN_BATCH_S, PACE, RESERVE_S } from '../limits';

const S = 1000;

/** When the crawl and access batches must all have ended. */
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
