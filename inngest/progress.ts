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
//     per-audit `seq` — the SSE layer's dedup watermark.

export const PROGRESS_FLUSH_PAGES = 10;
export const PROGRESS_FLUSH_MS = 5000;
export const ACTIVITY_RING_SIZE = 30;
/** Labels can embed crawled URL paths/titles (attacker-controlled) — bound them at the source. */
export const MAX_LABEL_LENGTH = 200;

// SPEC 04.3 — cap the feed label WITHOUT cutting a percent-escape (or multibyte char) in half. The engine's
// activityPath yields percent-encoded paths; a plain slice(0, N) can land mid-%XX, which made the display
// decoder throw → the whole label leaked raw. Trim back to the longest fully-decodable prefix and mark the
// cut with "…" (reserving room within MAX_LABEL_LENGTH). Stored data therefore always decodes clean; the
// tolerant display decoder (safeDecodeUrlForDisplay) is the backstop for any historical / pre-04.3 rows.
// Display-only concern kept at the label-builder — the engine's activityPath is untouched.
export function capActivityLabel(raw: string, max = MAX_LABEL_LENGTH): string {
  if (raw.length <= max) {
    try {
      decodeURIComponent(raw);
      return raw; // within budget and already decodable — the common case, unchanged
    } catch {
      // ends mid-escape / dangling half-codepoint — fall through to trim + mark
    }
  }
  // Reserve one char for the "…" marker, then back off to a boundary decodeURIComponent accepts.
  let cut = Math.min(raw.length, max - 1);
  while (cut > 0) {
    try {
      decodeURIComponent(raw.slice(0, cut));
      break;
    } catch {
      cut -= 1;
    }
  }
  return raw.slice(0, cut) + '…';
}

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

  // seq is per-batcher, hence per-crawlAndPersist-invocation. KNOWN LIMITATION (accepted): an
  // Inngest step retry (the rare transient-persist-blip path) constructs a fresh batcher, so seq
  // restarts at 1 and the ring is rewritten with low seqs; a client already connected from attempt 1
  // holds a higher watermark and filters the retried crawl's events, so its feed freezes until `done`.
  // It degrades HONESTLY (a frozen feed / stall state, never fake progress) and the retry re-crawls
  // from scratch anyway — so seeding seq from the prior ring isn't worth the extra read.
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
      label: capActivityLabel(String(a.label ?? '')),
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
