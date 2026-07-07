import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrawlActivity, CrawlActivityEvent } from '@crawlmouse/types';

// SPEC 04 §2 — the batched progress writer (owner ruling 3). The ONLY writer of the audits
// progress columns, with an absolute honesty contract:
//   - a write happens ONLY in response to real pipeline events (no events -> zero writes; there is
//     deliberately NO timer here — a stalled crawl produces a visibly stale row, which the UI
//     renders as the honest stall state);
//   - batched: every PROGRESS_FLUSH_PAGES fetch events or once PROGRESS_FLUSH_MS has elapsed when
//     the next event arrives — never per-page (≤18%-MRR cost ceiling; worst case ~60 single-row
//     UPDATEs across the 300s function ceiling);
//   - guarded WHERE status='crawling' so a progress write can never race a terminal transition;
//   - every failure is swallowed: progress must never fail a crawl (and the columns may not even
//     exist yet — the code ships before Runbook A is applied);
//   - the activity ring is bounded (ACTIVITY_RING_SIZE, latest kept) with a strictly-monotonic
//     per-audit `seq` — the SSE layer's dedup cursor.

export const PROGRESS_FLUSH_PAGES = 10;
export const PROGRESS_FLUSH_MS = 5000;
export const ACTIVITY_RING_SIZE = 30;
/** Labels can embed crawled URL paths/titles (attacker-controlled) — bound them at the source. */
export const MAX_LABEL_LENGTH = 200;

export interface ProgressBatcher {
  /** Engine/worker emission listener — synchronous, never throws, schedules batched writes. */
  onActivity(activity: CrawlActivity): void;
  /** Await the serialized pending write (the final pre-persist flush). Never rejects. */
  flush(): Promise<void>;
}

export interface ProgressBatcherOpts {
  flushPages?: number;
  flushMs?: number;
  ringSize?: number;
  /** Test clock. */
  now?: () => number;
}

export function createProgressBatcher(
  sb: SupabaseClient,
  auditId: string,
  opts: ProgressBatcherOpts = {},
): ProgressBatcher {
  const flushPages = opts.flushPages ?? PROGRESS_FLUSH_PAGES;
  const flushMs = opts.flushMs ?? PROGRESS_FLUSH_MS;
  const ringSize = opts.ringSize ?? ACTIVITY_RING_SIZE;
  const now = opts.now ?? Date.now;

  let seq = 0;
  let ring: CrawlActivityEvent[] = [];
  let pagesCrawled: number | null = null;
  let estimatedTotal: number | null = null;
  let phase: string | null = null;
  let dirty = false;
  let pagesSinceFlush = 0;
  let lastFlushAt = now();
  // Writes are serialized on this chain so flush() is awaitable, re-entrant and never rejects.
  let writeChain: Promise<void> = Promise.resolve();

  const doWrite = async (): Promise<void> => {
    if (!dirty) return;
    dirty = false;
    pagesSinceFlush = 0;
    lastFlushAt = now();
    const payload = {
      pages_crawled: pagesCrawled,
      crawl_estimated_total: estimatedTotal,
      crawl_phase: phase,
      crawl_activity: [...ring],
    };
    try {
      await sb.from('audits').update(payload).eq('id', auditId).eq('status', 'crawling');
    } catch {
      /* swallowed: progress must never fail a crawl (columns may not exist pre-runbook) */
    }
  };

  const flush = (): Promise<void> => {
    writeChain = writeChain.then(doWrite, doWrite);
    return writeChain;
  };

  const onActivity = (a: CrawlActivity): void => {
    seq += 1;
    const event: CrawlActivityEvent = {
      ...a,
      label: String(a.label ?? '').slice(0, MAX_LABEL_LENGTH),
      at: new Date(now()).toISOString(),
      seq,
    };
    ring.push(event);
    if (ring.length > ringSize) ring = ring.slice(ring.length - ringSize);
    if (typeof a.pagesFetched === 'number') pagesCrawled = a.pagesFetched;
    if (a.estimatedTotal != null) estimatedTotal = a.estimatedTotal;
    if (a.kind === 'phase' && a.phase) phase = a.phase;
    dirty = true;

    const isFetch = a.kind === 'fetch_ok' || a.kind === 'fetch_blocked' || a.kind === 'fetch_dead';
    if (isFetch) pagesSinceFlush += 1;
    // Flush decisions are made ON EVENTS ONLY (the honesty contract: no timers).
    if (pagesSinceFlush >= flushPages || now() - lastFlushAt >= flushMs) {
      void flush();
    }
  };

  return { onActivity, flush };
}
