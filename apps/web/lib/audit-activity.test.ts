import { describe, it, expect } from 'vitest';
import { extractNewActivity, reduceActivity, isStalled, shouldShowStall, isUndefinedColumnError, STALL_AFTER_MS, MAX_ACTIVITY_LABEL_LENGTH } from './audit-activity';
import type { CrawlActivityEvent } from '@crawlmouse/types';

// SPEC 04 §2 — the activity pipeline's pure core, shared by the SSE route (seq-delta emission over
// the crawl_activity ring) and the client (deriving determinate progress + the stall state from
// REAL events only). The ring is jsonb written by the worker but read defensively: malformed
// entries are dropped, labels are coerced + bounded (attacker-adjacent crawled content).

const ev = (seq: number, extra: Partial<CrawlActivityEvent> = {}): CrawlActivityEvent => ({
  kind: 'fetch_ok',
  label: `/p${seq}`,
  at: '2026-07-07T00:00:00.000Z',
  seq,
  pagesFetched: seq,
  ...extra,
});

describe('extractNewActivity (server: seq-delta emission)', () => {
  it('returns only events with seq greater than the cursor, sorted by seq', () => {
    const raw = [ev(3), ev(1), ev(2)];
    const { events, lastSeq } = extractNewActivity(raw, 1);
    expect(events.map((e) => e.seq)).toEqual([2, 3]);
    expect(lastSeq).toBe(3);
  });

  it('returns an empty slice when nothing is newer (idempotent across poll ticks)', () => {
    const { events, lastSeq } = extractNewActivity([ev(1), ev(2)], 2);
    expect(events).toEqual([]);
    expect(lastSeq).toBe(2);
  });

  it('drops malformed entries and non-array payloads instead of crashing the stream', () => {
    expect(extractNewActivity(null, 0).events).toEqual([]);
    expect(extractNewActivity('junk', 0).events).toEqual([]);
    expect(extractNewActivity({ not: 'an array' }, 0).events).toEqual([]);
    const mixed = [ev(1), { seq: 'NaN' }, 42, { kind: 'fetch_ok' }, ev(2)];
    const { events } = extractNewActivity(mixed, 0);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('coerces + bounds labels (crawled titles/URLs are attacker-controlled)', () => {
    const { events } = extractNewActivity([ev(1, { label: 'x'.repeat(10_000) })], 0);
    expect(events[0]!.label.length).toBeLessThanOrEqual(MAX_ACTIVITY_LABEL_LENGTH);
    const { events: coerced } = extractNewActivity([{ ...ev(2), label: 12345 }], 0);
    expect(typeof coerced[0]!.label).toBe('string');
  });
});

describe('reduceActivity (client: determinate progress from real events only)', () => {
  it('derives pagesCrawled from the latest fetch event and estimatedTotal from sitemap_seeded', () => {
    const s = reduceActivity(undefined, [
      ev(1, { pagesFetched: 1 }),
      { kind: 'sitemap_seeded', label: 'Sitemap found — 214 URLs', at: 't', seq: 2, estimatedTotal: 214 },
      ev(3, { pagesFetched: 7 }),
    ]);
    expect(s.pagesCrawled).toBe(7);
    expect(s.estimatedTotal).toBe(214);
  });

  it('tracks the current phase and accumulates the feed (bounded), preserving order', () => {
    const s = reduceActivity(undefined, [
      { kind: 'phase', label: 'Crawling your site', at: 't', seq: 1, phase: 'crawling' },
      ev(2),
      { kind: 'phase', label: 'Analyzing your link graph', at: 't', seq: 3, phase: 'analyzing' },
    ]);
    expect(s.phase).toBe('analyzing');
    expect(s.feed.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('ignores stale/duplicate seqs on reconnect (the ring replays; state never goes backwards)', () => {
    const s1 = reduceActivity(undefined, [ev(1), ev(2, { pagesFetched: 9 })]);
    const s2 = reduceActivity(s1, [ev(1), ev(2, { pagesFetched: 9 })]); // replayed ring
    expect(s2.pagesCrawled).toBe(9);
    expect(s2.feed.map((e) => e.seq)).toEqual([1, 2]); // no duplicates
  });

  it('records lastEventAtMs from the reducer clock so staleness is derivable', () => {
    const s = reduceActivity(undefined, [ev(1)], () => 123_456);
    expect(s.lastEventAtMs).toBe(123_456);
  });
});

describe('isStalled (the honest stall state — absence of events is DISPLAYED, never papered over)', () => {
  it('is false before any event and until STALL_AFTER_MS has elapsed since the last one', () => {
    expect(isStalled(undefined, 999_999_999)).toBe(false);
    const s = reduceActivity(undefined, [ev(1)], () => 1000);
    expect(isStalled(s, 1000 + STALL_AFTER_MS - 1)).toBe(false);
  });
  it('is true once STALL_AFTER_MS passes with no new events', () => {
    const s = reduceActivity(undefined, [ev(1)], () => 1000);
    expect(isStalled(s, 1000 + STALL_AFTER_MS + 1)).toBe(true);
  });
});

describe('isUndefinedColumnError (SSE column fallback fires ONLY pre-migration, not on transient blips)', () => {
  it('is true only for the Postgres undefined-column code 42703', () => {
    expect(isUndefinedColumnError({ code: '42703', message: 'column "crawl_activity" does not exist' })).toBe(true);
  });
  it('is false for a transient/other error, null, or a non-object', () => {
    expect(isUndefinedColumnError({ code: '57014', message: 'statement timeout' })).toBe(false);
    expect(isUndefinedColumnError(null)).toBe(false);
    expect(isUndefinedColumnError(undefined)).toBe(false);
    expect(isUndefinedColumnError('boom')).toBe(false);
  });
});

describe('shouldShowStall (never contradict "Saving report" with "site rate-limits crawlers")', () => {
  it('shows the stall line only during the crawling phase (or the pre-first-event window)', () => {
    expect(shouldShowStall('crawling', 'crawling', true)).toBe(true);
    expect(shouldShowStall('crawling', null, true)).toBe(true); // before the first phase event
  });

  it('SUPPRESSES the stall line during the event-quiet analyzing/grading/persisting phases', () => {
    // The persist-bound tail keeps DB status = crawling for minutes on large sites with no events;
    // the stall copy there would be a false "this site rate-limits crawlers" under "Saving report".
    expect(shouldShowStall('crawling', 'persisting', true)).toBe(false);
    expect(shouldShowStall('crawling', 'analyzing', true)).toBe(false);
    expect(shouldShowStall('crawling', 'grading', true)).toBe(false);
  });

  it('never shows the stall line outside a running crawl or when not time-stalled', () => {
    expect(shouldShowStall('completed', 'crawling', true)).toBe(false);
    expect(shouldShowStall('crawling', 'crawling', false)).toBe(false);
  });
});
