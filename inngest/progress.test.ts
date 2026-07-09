import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProgressBatcher, PROGRESS_FLUSH_PAGES, PROGRESS_FLUSH_MS, ACTIVITY_RING_SIZE } from './progress';
import type { CrawlActivity } from '@crawlmouse/types';

// SPEC 04 §2 — V1 (honest progress). The batcher is the ONLY writer of crawl progress and its
// honesty contract is absolute:
//   - it writes ONLY when real pipeline events arrive (no events -> ZERO writes, no timers);
//   - batched (every N pages or ~T ms), never per-page (cost ceiling);
//   - guarded to status='crawling' so it can never clobber a terminal status transition;
//   - write errors are SWALLOWED (progress must never fail a crawl);
//   - the activity ring is bounded and seq is strictly monotonic (the SSE dedup watermark).

interface UpdateCall {
  payload: Record<string, unknown>;
  filters: Array<[string, string]>;
}

function fakeSb(behavior: { failWith?: unknown } = {}) {
  const calls: UpdateCall[] = [];
  const sb = {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        const call: UpdateCall = { payload: { __table: table, ...payload } as Record<string, unknown>, filters: [] };
        const chain = {
          eq: (col: string, val: string) => {
            call.filters.push([col, val]);
            return chain;
          },
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            calls.push(call);
            if (behavior.failWith) reject(behavior.failWith);
            else resolve({ data: null, error: null });
          },
        };
        return chain;
      },
    }),
  };
  return { sb, calls };
}

const fetchEvent = (n: number): CrawlActivity => ({ kind: 'fetch_ok', label: `/page-${n}`, pagesFetched: n });

/** Drain the batcher's serialized write chain (writes are async; observation must settle first). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

let nowMs = 1_000_000;
const now = () => nowMs;

beforeEach(() => {
  nowMs = 1_000_000;
});

describe('createProgressBatcher — V1 honest progress', () => {
  it('performs ZERO writes when no events arrive (progress can never be timer-faked)', async () => {
    const { sb, calls } = fakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-1', { now });
    nowMs += PROGRESS_FLUSH_MS * 100; // arbitrary time passes — a stalled crawl
    await batcher.flush();
    expect(calls.length).toBe(0);
  });

  it('has NO internal timer: advancing real wall-clock past the flush window triggers no write', async () => {
    // Stronger than the fake-clock test above: a setInterval/setTimeout-driven implementation WOULD
    // fire here. This batcher uses the REAL Date.now (no injected clock), so vi's fake timers govern
    // any timer it might have; advancing time with zero events must produce zero writes — proving
    // writes are strictly event-driven, never clock-driven.
    vi.useFakeTimers();
    try {
      const { sb, calls } = fakeSb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batcher = createProgressBatcher(sb as any, 'aud-1');
      await vi.advanceTimersByTimeAsync(PROGRESS_FLUSH_MS * 10);
      expect(calls.length).toBe(0);
      await batcher.flush(); // nothing dirty → still no write
      expect(calls.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes after PROGRESS_FLUSH_PAGES fetch events (batched, never per-page)', async () => {
    const { sb, calls } = fakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-1', { now });
    for (let i = 1; i < PROGRESS_FLUSH_PAGES; i++) batcher.onActivity(fetchEvent(i));
    await settle();
    expect(calls.length).toBe(0); // below the page threshold and inside the time window: no write
    batcher.onActivity(fetchEvent(PROGRESS_FLUSH_PAGES));
    await settle();
    expect(calls.length).toBe(1); // the Nth page triggers exactly one batched write
    expect(calls[0]!.payload.pages_crawled).toBe(PROGRESS_FLUSH_PAGES);
  });

  it('flushes on the time threshold when a real event arrives after PROGRESS_FLUSH_MS', async () => {
    const { sb, calls } = fakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-1', { now });
    batcher.onActivity(fetchEvent(1));
    await settle();
    expect(calls.length).toBe(0);
    nowMs += PROGRESS_FLUSH_MS + 1;
    batcher.onActivity(fetchEvent(2)); // the EVENT triggers the flush — time alone never does
    await settle();
    expect(calls.length).toBe(1);
    expect(calls[0]!.payload.pages_crawled).toBe(2);
  });

  it('guards every write to the crawling status and the exact audit id', async () => {
    const { sb, calls } = fakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-7', { now });
    for (let i = 1; i <= PROGRESS_FLUSH_PAGES; i++) batcher.onActivity(fetchEvent(i));
    await settle();
    expect(calls[0]!.filters).toContainEqual(['id', 'aud-7']);
    expect(calls[0]!.filters).toContainEqual(['status', 'crawling']);
  });

  it('swallows write errors — progress must never break the crawl', async () => {
    const { sb, calls } = fakeSb({ failWith: new Error('db down') });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-1', { now });
    for (let i = 1; i <= PROGRESS_FLUSH_PAGES; i++) batcher.onActivity(fetchEvent(i));
    await expect(batcher.flush()).resolves.toBeUndefined();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('caps the activity ring at ACTIVITY_RING_SIZE keeping the LATEST events, with strictly increasing seq', async () => {
    const { sb, calls } = fakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-1', { now });
    const total = ACTIVITY_RING_SIZE + 15;
    for (let i = 1; i <= total; i++) batcher.onActivity(fetchEvent(i));
    await batcher.flush();
    const last = calls[calls.length - 1]!;
    const ring = last.payload.crawl_activity as Array<{ seq: number; label: string }>;
    expect(ring.length).toBe(ACTIVITY_RING_SIZE);
    expect(ring[ring.length - 1]!.label).toBe(`/page-${total}`); // latest kept
    for (let i = 1; i < ring.length; i++) expect(ring[i]!.seq).toBeGreaterThan(ring[i - 1]!.seq);
  });

  it('final flush() writes pending state exactly once and is idempotent when nothing is dirty', async () => {
    const { sb, calls } = fakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-1', { now });
    batcher.onActivity(fetchEvent(1));
    batcher.onActivity({ kind: 'sitemap_seeded', label: 'Sitemap found — 42 URLs', estimatedTotal: 42 });
    batcher.onActivity({ kind: 'phase', label: 'Analyzing your link graph', phase: 'analyzing' });
    await batcher.flush();
    expect(calls.length).toBe(1);
    expect(calls[0]!.payload.pages_crawled).toBe(1);
    expect(calls[0]!.payload.crawl_estimated_total).toBe(42);
    expect(calls[0]!.payload.crawl_phase).toBe('analyzing');
    await batcher.flush(); // nothing new — no second write
    expect(calls.length).toBe(1);
  });

  it('label length is bounded (crawled titles/URLs are attacker-controlled; rows must stay small)', async () => {
    const { sb, calls } = fakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-1', { now });
    batcher.onActivity({ kind: 'fetch_ok', label: 'x'.repeat(10_000), pagesFetched: 1 });
    await batcher.flush();
    const ring = calls[0]!.payload.crawl_activity as Array<{ label: string }>;
    expect(ring[0]!.label.length).toBeLessThanOrEqual(200);
  });

  // SPEC 04.3 — the label cap must NOT cut a percent-escape in half (the engine's activityPath yields
  // percent-encoded paths; a long Cyrillic/Arabic path gets sliced mid-%XX). Trim back to a COMPLETE escape
  // boundary + mark with "…" so the stored label always decodes clean (the display decoder is the backstop).
  it('SPEC 04.3 — caps the label at a complete %XX boundary (never mid-escape); stays decodable + marks "…"', async () => {
    const { sb, calls } = fakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batcher = createProgressBatcher(sb as any, 'aud-1', { now });
    const label = '/wiki/' + '%D0%A1'.repeat(30) + '%D0%B'; // a percent-encoded path cut mid-escape ("…%D0%B")
    batcher.onActivity({ kind: 'fetch_ok', label, pagesFetched: 1 });
    await batcher.flush();
    const stored = (calls[0]!.payload.crawl_activity as Array<{ label: string }>)[0]!.label;
    expect(() => decodeURIComponent(stored)).not.toThrow(); // decodable — never cut mid-escape
    expect(decodeURIComponent(stored)).not.toMatch(/%[0-9A-Fa-f]{2}/);
    expect(stored.endsWith('…')).toBe(true); // truncation marked
    expect(stored.length).toBeLessThanOrEqual(200);
  });
});
