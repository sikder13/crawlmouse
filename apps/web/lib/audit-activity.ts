import type { CrawlActivityEvent, CrawlPhase } from '@crawlmouse/types';

// SPEC 04 §2 — the activity pipeline's pure core, shared by the SSE route (seq-delta emission over
// the audits.crawl_activity ring) and the client (deriving determinate progress + the stall state).
// The honesty contract lives here: every number the UI shows is derived from REAL persisted events;
// staleness (a stalled crawl) is DETECTED and displayed, never papered over with synthetic motion.

/** Labels can embed crawled URL paths/titles (attacker-controlled) — bounded defensively on read. */
export const MAX_ACTIVITY_LABEL_LENGTH = 200;
/** How long without a new event before the UI shows the honest stall state. */
export const STALL_AFTER_MS = 20_000;
/** The client keeps a bounded feed (the ring is ≤30 server-side anyway). */
const MAX_FEED_LENGTH = 60;

/**
 * Parse the jsonb activity ring defensively and return only events newer than the cursor, sorted
 * by seq. Malformed payloads/entries are dropped — a corrupt row must never crash the stream.
 */
export function extractNewActivity(
  raw: unknown,
  lastSeq: number,
): { events: CrawlActivityEvent[]; lastSeq: number } {
  if (!Array.isArray(raw)) return { events: [], lastSeq };
  const events: CrawlActivityEvent[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.seq !== 'number' || !Number.isFinite(e.seq)) continue;
    if (typeof e.kind !== 'string' || e.label == null) continue;
    if (e.seq <= lastSeq) continue;
    events.push({
      kind: e.kind as CrawlActivityEvent['kind'],
      label: String(e.label).slice(0, MAX_ACTIVITY_LABEL_LENGTH),
      at: typeof e.at === 'string' ? e.at : '',
      seq: e.seq,
      ...(typeof e.pagesFetched === 'number' ? { pagesFetched: e.pagesFetched } : {}),
      ...(typeof e.estimatedTotal === 'number' ? { estimatedTotal: e.estimatedTotal } : {}),
      ...(typeof e.phase === 'string' ? { phase: e.phase as CrawlPhase } : {}),
    });
  }
  events.sort((a, b) => a.seq - b.seq);
  return { events, lastSeq: events.length > 0 ? events[events.length - 1]!.seq : lastSeq };
}

/** Client-side progress state, derived exclusively from received activity events. */
export interface ActivityState {
  pagesCrawled: number | null;
  estimatedTotal: number | null;
  phase: CrawlPhase | null;
  feed: CrawlActivityEvent[];
  lastSeq: number;
  /** Reducer-clock time of the last NEW event — the staleness anchor for the stall state. */
  lastEventAtMs: number | null;
}

const EMPTY: ActivityState = {
  pagesCrawled: null,
  estimatedTotal: null,
  phase: null,
  feed: [],
  lastSeq: 0,
  lastEventAtMs: null,
};

/**
 * Fold a batch of received events into the state. Duplicate/stale seqs (ring replays after an
 * EventSource reconnect) are ignored, so state never goes backwards and the feed never duplicates.
 */
export function reduceActivity(
  state: ActivityState | undefined,
  batch: CrawlActivityEvent[],
  nowMs: () => number = Date.now,
): ActivityState {
  const s = state ?? EMPTY;
  const fresh = batch.filter((e) => typeof e.seq === 'number' && e.seq > s.lastSeq).sort((a, b) => a.seq - b.seq);
  if (fresh.length === 0) return s;
  let { pagesCrawled, estimatedTotal, phase } = s;
  for (const e of fresh) {
    if (typeof e.pagesFetched === 'number') pagesCrawled = e.pagesFetched;
    if (typeof e.estimatedTotal === 'number') estimatedTotal = e.estimatedTotal;
    if (e.kind === 'phase' && e.phase) phase = e.phase;
  }
  const feed = [...s.feed, ...fresh].slice(-MAX_FEED_LENGTH);
  return {
    pagesCrawled,
    estimatedTotal,
    phase,
    feed,
    lastSeq: fresh[fresh.length - 1]!.seq,
    lastEventAtMs: nowMs(),
  };
}

/** True once STALL_AFTER_MS has passed since the last new event (and at least one event arrived). */
export function isStalled(state: ActivityState | undefined, nowMs: number): boolean {
  if (!state || state.lastEventAtMs == null) return false;
  return nowMs - state.lastEventAtMs > STALL_AFTER_MS;
}
