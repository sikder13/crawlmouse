/**
 * `GET /api/checks/[id]/stream` (CC-22b D5): a check's progress as server-sent `ProgressEvent`s.
 *
 * Who may open it is `readableCheck`'s rule. Each poll then makes one narrow read (`snapshot`), and
 * the stream closes, sending nothing more, when that read shows the site removed, the check
 * expired, or the site's account changed to one the viewer is not a member of.
 *
 * Framing. The events one batch gives, and the events one poll's row gives, are each a group: the
 * group's last event carries `id:`, the cursor after the group, and the events before it carry no
 * id. A browser reconnects with the last id it saw, so a group cut short is sent again whole; the
 * crawl screen applies a group when its id arrives (app/audit/[id]/_crawl/live-source.ts).
 *
 * Limits. A poll every POLL_MS; the stream closes itself STREAM_CLOSE_MS after it opened, before
 * the route's `maxDuration`, and the browser reconnects; STREAM_OPENS_PER_IP_PER_HOUR opens an hour
 * for one address (../_lib/limit-keys.ts); one batch result in memory at a time (`readBatch`'s bounds).
 */
import { isExpired, readableCheck, type Viewer } from '../../../../../lib/v2/pipeline/public';
import {
  START,
  batchEvents,
  checkEvents,
  cursorFits,
  factsOf,
  formatCursor,
  parseCursor,
  readBatch,
  storedCrawlBatches,
  type Cursor,
} from '../../../../../lib/v2/pipeline/stream';
import type { StreamSnapshot, StreamStore } from '../../../../../lib/v2/pipeline/stream-store';
import type { CheckReader, EvidenceStore } from '../../../../../lib/v2/pipeline/types';
import type { ProgressEvent } from '../../../../../lib/v2/progress';
import type { PublicServerEvents } from '../../_lib/events';
import type { CheckRouteLimits } from '../_lib/limit-keys';

export const POLL_MS = 1500;
/** The stream closes itself this long after it opened; the route's `maxDuration` is 300 s. */
export const STREAM_CLOSE_MS = 240_000;
/** How long a browser waits before it reconnects. */
const RETRY_MS = 2000;

export interface StreamDeps {
  read: CheckReader;
  isMember(siteId: string, userId: string): Promise<boolean>;
  store: Pick<StreamStore, 'snapshot' | 'scores'>;
  evidence: Pick<EvidenceStore, 'get'>;
  limits: Pick<CheckRouteLimits, 'streamOpens' | 'finishedOnce'>;
  /** Sends `check_finished` (app/api/checks/_lib/events.ts, `capturePublicEvent`). */
  captureFinished(
    req: Request,
    checkId: string,
    properties: PublicServerEvents['check_finished'],
  ): Promise<void>;
  clientIp(req: Request): string;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const refuse = (status: number, code: string): Response => Response.json({ code }, { status });

/** One group as SSE text: the last event carries the cursor as its id. */
export function frame(events: readonly ProgressEvent[], cursor: Cursor): string {
  return events
    .map((e, i) =>
      i === events.length - 1
        ? `id: ${formatCursor(cursor)}\ndata: ${JSON.stringify(e)}\n\n`
        : `data: ${JSON.stringify(e)}\n\n`,
    )
    .join('');
}

export async function serveStream(
  req: Request,
  checkId: string,
  viewer: Viewer,
  deps: StreamDeps,
): Promise<Response> {
  const lastId = req.headers.get('last-event-id');
  const resumed = lastId === null ? START : parseCursor(lastId);
  if (resumed === null) return refuse(400, 'invalid_cursor');

  if (!(await deps.limits.streamOpens(deps.clientIp(req)))) return refuse(429, 'rate_limited');

  const access = await readableCheck(deps, checkId, viewer);
  if (access === null || isExpired(access, deps.now())) return refuse(404, 'not_found');

  let accountId = access.accountId;
  /** Whether the viewer may still read the check this snapshot shows. */
  const readable = async (s: StreamSnapshot): Promise<boolean> => {
    if (s.siteRemoved || isExpired({ expiresAt: s.expiresAt }, deps.now())) return false;
    if (s.accountId === accountId) return true;
    // The site changed hands since the stream opened: an account's site needs its member.
    if (s.accountId !== null) {
      if (viewer.userId === null || !(await deps.isMember(s.siteId, viewer.userId))) return false;
    }
    accountId = s.accountId;
    return true;
  };

  const first = await deps.store.snapshot(checkId);
  if (first === null || !(await readable(first))) return refuse(404, 'not_found');
  const stored = storedCrawlBatches(first).map((b) => b.batch);
  if (!cursorFits(resumed, first.status, stored)) return refuse(400, 'invalid_cursor');

  const encoder = new TextEncoder();
  let open = true;
  req.signal.addEventListener('abort', () => {
    open = false;
  });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };
      const openedAt = deps.now();
      let cursor = resumed;
      let snapshot: StreamSnapshot | null = first;
      write(`retry: ${RETRY_MS}\n\n`);
      try {
        while (open) {
          if (snapshot === null || !(await readable(snapshot))) break;
          const before = cursor;
          let groups = 0;
          const send = (events: ProgressEvent[], after: Cursor) => {
            cursor = after;
            if (events.length === 0) return;
            write(frame(events, after));
            groups++;
          };
          if (!cursor.ended) {
            const startedAtMs = snapshot.startedAt === null ? null : Date.parse(snapshot.startedAt);
            for (const batch of storedCrawlBatches(snapshot)) {
              if (batch.batch <= cursor.batch) continue;
              // One result in memory at a time: it is read, turned into events and dropped.
              const result = await readBatch(deps.evidence, batch.resultPath!);
              const out = batchEvents(cursor, { batch: batch.batch, result }, startedAtMs);
              send(out.events, out.cursor);
            }
          }
          const facts = factsOf(snapshot, deps.now());
          const out = checkEvents(cursor, facts);
          send(out.events, out.cursor);
          if (cursor.ended) {
            if (!before.ended) await finished(req, checkId, access.trigger, facts, deps);
            break;
          }
          // A comment line when there was nothing to send, so an idle connection is not dropped.
          if (groups === 0) write(':\n\n');
          if (deps.now() - openedAt >= STREAM_CLOSE_MS) break;
          await deps.sleep(POLL_MS);
          if (!open) break;
          snapshot = await deps.store.snapshot(checkId);
        }
      } catch {
        // A read that failed ends this connection; the browser reconnects from its last id.
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * `check_finished`: `finishedOnce` admits one capture for the check in its bucket's 24-hour window.
 * What it carries is read from the check's rows (`facts`, `scores`) and from `readableCheck`'s
 * answer; the cursor, which the client sends, gives it nothing. The scores are read for a finished
 * or partial check.
 */
async function finished(
  req: Request,
  checkId: string,
  trigger: PublicServerEvents['check_finished']['trigger'],
  facts: ReturnType<typeof factsOf>,
  deps: StreamDeps,
): Promise<void> {
  const status = facts.status as PublicServerEvents['check_finished']['status'];
  if (!(await deps.limits.finishedOnce(checkId))) return;
  const scores = status === 'failed' ? {} : await deps.store.scores(checkId);
  await deps.captureFinished(req, checkId, {
    trigger,
    status,
    pages: facts.counts?.pages_crawled ?? 0,
    durationMs: Math.round(facts.elapsedMs),
    ...scores,
  });
}
