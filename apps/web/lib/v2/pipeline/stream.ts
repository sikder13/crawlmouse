/**
 * The progress stream of a real check (CC-22b D5): the `ProgressEvent`s (lib/v2/progress.ts) that a
 * check's stored rows imply, and the cursor that says which of them a viewer has been sent.
 *
 * Sources. A crawl batch's stored result gives `page_fetched` and `page_linked`; the check's row
 * gives `stage`, `counts` and `ended`. No `pages_estimated`, `page_classified`, `crawler_verdict`,
 * `finding` or `graded` event is derived: nothing stored while a check runs holds them.
 *
 * Order within one poll: each new batch's events (`batchEvents`), then the row's (`checkEvents`),
 * so the map has its pages before a `grading` stage could close it (progress.ts, `reduce`).
 *
 * The two stages the stored progress cannot name as under way, `without_js` and `grading`, are
 * closed when the check's status is `finished` or `partial`: the status says those steps ran. The
 * stream does not observe them start.
 */
import { gunzipSync } from 'node:zlib';
import { BatchResultSchema, type Check, type CrawlBatchResult } from '@crawlmouse/types/v2';
import { PHASES, type ProgressEvent } from '../progress';
import type { StreamBatch, StreamSnapshot } from './stream-store';
import type { EvidenceStore } from './types';

/** What a viewer has been sent. It travels as the SSE `id:` and comes back as `Last-Event-ID`. */
export interface Cursor {
  /** The last crawl batch whose events were sent, or passed over; 0 before the first. */
  batch: number;
  /**
   * How far the stages have gone: `2 * i` when the phases before `PHASES[i]` are done and it has
   * not started, `2 * i + 1` when it is under way, `2 * PHASES.length` when each is done.
   */
  step: number;
  pages: number;
  links: number;
  /** The last event's `at_ms`. */
  at: number;
  ended: boolean;
}

export const START: Cursor = Object.freeze({
  batch: 0,
  step: 0,
  pages: 0,
  links: 0,
  at: 0,
  ended: false,
});

const ALL_DONE = 2 * PHASES.length;
/**
 * As far as a check that has not ended is taken: `crawler_tests` done. The stored progress names
 * neither `without_js` nor `grading` as under way (steps/progress.ts, `phaseOf`).
 */
const OBSERVED = 2 * PHASES.indexOf('without_js');
const CURSOR = /^1\.(\d{1,7})\.(\d{1,2})\.(\d{1,9})\.(\d{1,9})\.(\d{1,12})\.([01])$/;

export const formatCursor = (c: Cursor): string =>
  `1.${c.batch}.${c.step}.${c.pages}.${c.links}.${c.at}.${c.ended ? 1 : 0}`;

/** The cursor a `Last-Event-ID` names; null when it is not one `formatCursor` writes. */
export function parseCursor(text: string): Cursor | null {
  const m = CURSOR.exec(text);
  if (!m) return null;
  const [batch, step, pages, links, at] = m.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (step > ALL_DONE) return null;
  return { batch, step, pages, links, at, ended: m[6] === '1' };
}

/** What the check's row says, as one poll reads it. */
export interface CheckFacts {
  status: Check['status'];
  /** The stored progress's steps; null unless the check is running. */
  steps: readonly { phase: string; state: string }[] | null;
  /** The pipeline's totals: the stored progress's, or for an ended check its batch rows' sums. */
  counts: { pages_crawled: number; links_found: number } | null;
  /** Milliseconds from the check's start to its end, or to this poll; 0 before it starts. */
  elapsedMs: number;
}

/** A crawl batch whose result is stored. `result` is null when it was not read (see `readBatch`). */
export interface StoredBatch {
  batch: number;
  result: Pick<CrawlBatchResult, 'pages' | 'link_edges'> | null;
}

export interface Snapshot {
  check: CheckFacts;
  /** The check's start, in milliseconds since the epoch; null before it starts. */
  startedAtMs: number | null;
  /** The stored crawl batches after the cursor's, in batch order. */
  batches: readonly StoredBatch[];
}

export interface Emitted {
  events: ProgressEvent[];
  cursor: Cursor;
}

const isEnded = (status: Check['status']): status is 'finished' | 'partial' | 'failed' =>
  status === 'finished' || status === 'partial' || status === 'failed';

/** The check's crawl batches whose result is stored, in batch order. */
export const storedCrawlBatches = (s: Pick<StreamSnapshot, 'batches'>): StreamBatch[] =>
  s.batches.filter((b) => b.kind === 'crawl' && b.status === 'done' && b.resultPath !== null);

/**
 * A snapshot's row as `checkEvents` reads it, at `now` (milliseconds). The counts are the stored
 * progress's while the check runs; once it has ended and holds no progress, the sums of the counts
 * its read batches' rows hold, which are what the pipeline added up.
 */
export function factsOf(s: StreamSnapshot, now: number): CheckFacts {
  const started = s.startedAt === null ? null : Date.parse(s.startedAt);
  const until = s.finishedAt === null ? now : Date.parse(s.finishedAt);
  const read = s.batches.filter((b) => b.status === 'done');
  return {
    status: s.status,
    steps: s.progress?.steps ?? null,
    counts: s.progress
      ? { pages_crawled: s.progress.pages_crawled, links_found: s.progress.links_found }
      : read.length > 0
        ? {
            pages_crawled: read.reduce((n, b) => n + b.pages, 0),
            links_found: read.reduce((n, b) => n + b.links, 0),
          }
        : null,
    elapsedMs: started === null ? 0 : Math.max(0, until - started),
  };
}

/**
 * Whether a cursor a client sent can be this check's: its batch is 0 or a stored crawl batch's
 * number, and it says `ended` only of a check that has ended.
 */
export function cursorFits(
  cursor: Cursor,
  status: Check['status'],
  storedCrawlBatches: readonly number[],
): boolean {
  if (cursor.ended && !isEnded(status)) return false;
  return cursor.batch === 0 || storedCrawlBatches.includes(cursor.batch);
}

type Page = CrawlBatchResult['pages'][number];

/**
 * A crawl row as `page_fetched`, whose status, time and link count are not nullable: `status` is
 * the row's `status_code`, `ms` its `timing.total_ms`, `links` its `links_out`, `identity` its
 * `identity_sent`. Null when the row holds no value for one of the three.
 */
function fetchedEvent(page: Page, at_ms: number): ProgressEvent | null {
  if (page.status_code === null || page.timing === null || page.links_out === null) return null;
  return {
    type: 'page_fetched',
    at_ms,
    url: page.url,
    identity: page.identity_sent,
    purpose: 'crawl',
    status: page.status_code,
    ms: page.timing.total_ms,
    links: page.links_out,
  };
}

/**
 * One stored crawl batch's events: a `page_fetched` for each fetched row that can fill one, in the
 * order the rows were fetched, each followed by a `page_linked` for the first link in this batch
 * to each page its links reach. A link from a page to itself is not sent. The cursor moves to the
 * batch whether or not it gave an event.
 */
export function batchEvents(
  cursor: Cursor,
  batch: StoredBatch,
  startedAtMs: number | null,
): Emitted {
  const events: ProgressEvent[] = [];
  let at = cursor.at;
  if (batch.result !== null) {
    const { pages, link_edges } = batch.result;
    const linked = new Set<string>();
    const linksFrom = (from: string | null) => {
      for (const edge of link_edges) {
        if (from !== null && edge.from_url !== from) continue;
        if (edge.from_url === edge.to_url || linked.has(edge.to_url)) continue;
        linked.add(edge.to_url);
        events.push({
          type: 'page_linked',
          at_ms: at,
          url: edge.to_url,
          from: edge.from_url,
          via: edge.js_only ? 'javascript' : 'link',
        });
      }
    };
    const fetched = pages
      .filter((p) => p.outcome === 'fetched')
      .map((page) => ({ page, t: Date.parse(page.fetched_at) }))
      .sort((a, b) => a.t - b.t);
    for (const { page, t } of fetched) {
      if (startedAtMs !== null) at = Math.max(at, Math.round(t - startedAtMs));
      const event = fetchedEvent(page, at);
      if (event) events.push(event);
      linksFrom(page.url);
    }
    // Links found on a page with no fetched row of its own here (a redirect's landing page).
    linksFrom(null);
  }
  return { events, cursor: { ...cursor, batch: batch.batch, at } };
}

/** How far the row says the stages have gone, in the cursor's `step` units. */
function stepOf(check: CheckFacts): number {
  if (check.status === 'finished' || check.status === 'partial') return ALL_DONE;
  const steps = check.steps ?? [];
  const now = PHASES.findIndex((p) => steps.some((s) => s.phase === p && s.state === 'now'));
  if (now !== -1) return Math.min(OBSERVED, 2 * now + 1);
  const open = PHASES.findIndex((p) => !steps.some((s) => s.phase === p && s.state === 'done'));
  return Math.min(OBSERVED, open === -1 ? ALL_DONE : 2 * open);
}

/**
 * The row's events after the cursor: the `now` and `done` stages between where the cursor is and
 * where the row is, in `PHASES` order (a poll can miss a phase); `counts` when a total has risen;
 * and `ended` for a check that has ended. A failed check's open steps are left open. Each is
 * stamped with the row's elapsed time, or the cursor's last when that is later.
 *
 * Call it once every stored batch after the cursor has been through `batchEvents`.
 */
export function checkEvents(cursor: Cursor, check: CheckFacts): Emitted {
  if (cursor.ended) {
    // A viewer who was sent the end is sent it again, alone, when they reconnect.
    return isEnded(check.status)
      ? { events: [{ type: 'ended', at_ms: cursor.at, status: check.status }], cursor }
      : { events: [], cursor };
  }
  const events: ProgressEvent[] = [];
  const at = Math.max(cursor.at, Math.round(check.elapsedMs));
  const step = Math.max(cursor.step, stepOf(check));
  for (let k = cursor.step + 1; k <= step; k++) {
    events.push(
      k % 2 === 1
        ? { type: 'stage', at_ms: at, phase: PHASES[(k - 1) / 2]!, state: 'now' }
        : { type: 'stage', at_ms: at, phase: PHASES[k / 2 - 1]!, state: 'done' },
    );
  }
  const pages = Math.max(cursor.pages, check.counts?.pages_crawled ?? 0);
  const links = Math.max(cursor.links, check.counts?.links_found ?? 0);
  if (pages !== cursor.pages || links !== cursor.links) {
    events.push({ type: 'counts', at_ms: at, pages_crawled: pages, links_found: links });
  }
  const ended = isEnded(check.status) ? check.status : null;
  if (ended) events.push({ type: 'ended', at_ms: at, status: ended });
  if (events.length === 0) return { events, cursor };
  return { events, cursor: { ...cursor, step, pages, links, at, ended: ended !== null } };
}

/** The events a snapshot implies after `cursor`, and the cursor once they are sent. */
export function nextEvents(cursor: Cursor, snapshot: Snapshot): Emitted {
  const events: ProgressEvent[] = [];
  let c = cursor;
  if (!c.ended) {
    for (const batch of snapshot.batches) {
      if (batch.batch <= c.batch) continue;
      const out = batchEvents(c, batch, snapshot.startedAtMs);
      events.push(...out.events);
      c = out.cursor;
    }
  }
  const out = checkEvents(c, snapshot.check);
  return { events: [...events, ...out.events], cursor: out.cursor };
}

/**
 * The most a stored batch result may be for the stream to read it, gzipped and inflated. Measured
 * at the 500-page cap in stream.budget.test.ts; a result over either is passed over, and the screen
 * says how many fetched pages its map does not show.
 */
export const BATCH_GZIP_BYTES = 4 * 1024 * 1024;
export const BATCH_RAW_BYTES = 16 * 1024 * 1024;

/**
 * A stored crawl batch result, read for the stream: null when the object is missing, over a bound
 * above, not gzipped JSON, not a contract `BatchResult`, or not a crawl batch's.
 */
export async function readBatch(
  evidence: Pick<EvidenceStore, 'get'>,
  path: string,
): Promise<StoredBatch['result']> {
  try {
    const gzipped = await evidence.get(path);
    if (gzipped.byteLength > BATCH_GZIP_BYTES) return null;
    const raw = gunzipSync(gzipped, { maxOutputLength: BATCH_RAW_BYTES });
    const parsed = BatchResultSchema.safeParse(JSON.parse(raw.toString('utf8')));
    if (!parsed.success || parsed.data.kind !== 'crawl') return null;
    return { pages: parsed.data.pages, link_edges: parsed.data.link_edges };
  } catch {
    return null;
  }
}
