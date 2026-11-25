/**
 * The time plan (plan §4, finding 8; CC-42A): how long a batch posted now may run. Its zero is the
 * first claim attempt (`RunSoFar.startedAt`). The fetching phases end by `fetchEndsAt`, the finish
 * timeout less RESERVE_S; the finish timeout holds the whole wait budget, so that end needs no time
 * added back. The crawl's end comes earlier: CRAWL_CEILING_S after the worker accepted the first
 * crawl batch, plus the busy time added back since (`addBackMs`), or ACCESS_SLICE_S before
 * `fetchEndsAt`. When it is the latter (a run that waited long before its crawl), the last crawl
 * batch's grace and poll fall in the access slice, which then keeps at least ACCESS_SLICE_S less two
 * graces and polls (time.test.ts); not reserved, because a check that waited must not crawl less
 * (CC-42A). Before
 * the first batch is accepted the crawl clock has not started, and the window is measured from the
 * post's own time, so that batch gets its full budget however long it waited. An access batch's
 * max_seconds is cut so that its deadline (max_seconds + the poll grace) and the poll after it (one
 * poll wait at most) fall before its phase's end; a crawl batch's is cut to the crawl's end, and its
 * grace and poll fall after it (PhaseTail, F-247). Step latency comes on top (time.test.ts simulates
 * it).
 */
import type { BatchAt, RunSoFar } from '../../../../../../inngest/check';
import {
  ACCESS_SLICE_S,
  cadenceFor,
  crawlCeilingS,
  finishSFor,
  MIN_BATCH_S,
  PACE,
  QUEUE_WAIT_MAX_S,
  RENDER_SHARE_S,
  reserveS,
} from '../limits';

const S = 1000;

/** The end of the fetching phases: the check's own finish (by its page cap) less its reserve. */
export const fetchEndsAt = (so: Pick<RunSoFar, 'startedAt' | 'pageCap'>): number =>
  so.startedAt + (finishSFor(so.pageCap) - reserveS(so.pageCap)) * S;

/**
 * When the render step, started at `stepStart`, must stop rendering: RENDER_SHARE_S after the earlier
 * of its start and the end of the fetching phases. A retried attempt, or one Inngest started late,
 * gets only what the share has left, so the steps after render keep the rest of RESERVE_S however
 * many attempts render takes.
 */
export const renderEndsAt = (
  stepStart: number,
  so: Pick<RunSoFar, 'startedAt' | 'pageCap'>,
): number => Math.min(stepStart, fetchEndsAt(so)) + RENDER_SHARE_S * S;

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
  const fetchEnd = fetchEndsAt(so);
  if (at.kind === 'access') return fetchEnd;
  const crawlFrom = so.crawlFrom ?? now;
  return Math.min(
    crawlFrom + crawlCeilingS(so.pageCap) * S + addBackMs(so),
    fetchEnd - ACCESS_SLICE_S * S,
  );
}

/**
 * What follows a phase's end. After the crawl comes the access slice (ACCESS_SLICE_S of the fetching
 * time, far more than a poll grace and a poll wait), so a crawl batch may run to the crawl's end and
 * its grace and poll fall in that slice: the crawl ceiling bounds crawling, not the wait to hear that
 * it ended (F-247: ordinary sites stopped ~115 s short of it). Access batches end the fetching time,
 * after which only the reserve is left, so they keep the grace and the poll inside their phase.
 */
export type PhaseTail = 'spills_into_access' | 'kept_inside';
export const tailOf = (kind: BatchAt['kind']): PhaseTail =>
  kind === 'crawl' ? 'spills_into_access' : 'kept_inside';

/**
 * The max_seconds of a batch posted at `now`: its budget's most, or what the phase has left (after
 * the grace and one poll wait, unless they fall after the phase, see PhaseTail), whichever is less;
 * null when that is under MIN_BATCH_S.
 */
export function batchSeconds(
  endsAt: number,
  now: number,
  most: number,
  tail: PhaseTail,
  pageCap: number,
): number | null {
  const after = tail === 'kept_inside' ? PACE.pollGraceS + cadenceFor(pageCap).pollMaxS : 0;
  const left = Math.floor((endsAt - now) / S) - after;
  const seconds = Math.min(most, left);
  return seconds >= MIN_BATCH_S ? seconds : null;
}
