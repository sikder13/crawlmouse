import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { REPORT_VIEWS_PER_IP_PER_HOUR } from '@/lib/limits';

// CC-37 A-1 (rulings-2): the v1 audit stream refuses an id that is not a UUID before any database
// read, spends a per-IP bucket before it reads, and marks its owner-dependent body `private`. The
// admin client records every table it is asked for; the limiter is an in-memory counter keyed like
// `rate_limits`.
const h = vi.hoisted(() => ({
  tables: [] as string[],
  buckets: new Map<string, number>(),
  limiterCalls: [] as { key: string; limit: number; windowMs: number }[],
  ip: '198.51.100.30',
  row: null as Record<string, unknown> | null,
  readError: null as { code: string; message: string } | null,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number, windowMs: number) => {
    h.limiterCalls.push({ key, limit, windowMs });
    const n = (h.buckets.get(key) ?? 0) + 1;
    h.buckets.set(key, n);
    return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetAt: new Date(0) };
  },
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => h.ip }));
vi.mock('@/lib/supabase/fetch-all', () => ({
  fetchAll: (_admin: unknown, table: string) => {
    h.tables.push(table);
    return Promise.resolve([]);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      h.tables.push(table);
      const c = {
        select: () => c,
        eq: () => c,
        maybeSingle: () =>
          Promise.resolve(
            h.readError ? { data: null, error: h.readError } : { data: h.row, error: null },
          ),
      };
      return c;
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: () => {
        const c = {
          select: () => c,
          eq: () => c,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return c;
      },
    }),
}));

import { GET } from './route';

const AUDIT_ID = '3f2b8c1e-5d4a-4b7f-9e21-0c6d8a9b1f42';
/** A finished v1 audit (no `confidence`), so the stream sends snapshot and done and closes. */
const COMPLETED_V1 = {
  id: AUDIT_ID,
  url: 'https://x.com/',
  status: 'completed',
  grade: 'B-',
  score: '72.00',
  page_count: 2,
  link_count: 1,
  cms_detected: 'custom',
  user_id: null,
  settings: { pageCap: 500 },
  failure_reason: null,
  confidence: null,
  coverage_pct: null,
  block_rate: null,
  partial: false,
};

const open = (id: string) =>
  GET(new NextRequest(`http://localhost/api/audits/${encodeURIComponent(id)}/stream`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  h.tables = [];
  h.buckets.clear();
  h.limiterCalls = [];
  h.ip = '198.51.100.30';
  h.row = { ...COMPLETED_V1 };
  h.readError = null;
});

/** The named events of a stream body, with their parsed data. */
async function eventsOf(res: Response) {
  return (await res.text())
    .split('\n\n')
    .filter((b) => b.startsWith('event: '))
    .map((b) => ({
      event: b.slice(7, b.indexOf('\n')),
      data: JSON.parse(b.slice(b.indexOf('data: ') + 6)) as Record<string, unknown>,
    }));
}

describe('GET /api/audits/[id]/stream — id, rate limit and cache (A-1)', () => {
  it.each([
    'aud-1',
    'not-a-uuid',
    `${AUDIT_ID}x`,
    `${AUDIT_ID.slice(0, -1)}`,
    `${AUDIT_ID}' or '1'='1`,
    '',
  ])('a non-UUID id (%j) is a 400 before any database read or bucket', async (id) => {
    const res = await open(id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid id' });
    expect(h.tables).toEqual([]);
    expect(h.limiterCalls).toEqual([]);
  });

  it('spends the per-IP audit-stream bucket at the hourly limit it shares with report views', async () => {
    await (await open(AUDIT_ID)).text();
    expect(h.limiterCalls).toEqual([
      {
        key: 'audit-stream:ip:198.51.100.30',
        limit: REPORT_VIEWS_PER_IP_PER_HOUR,
        windowMs: 60 * 60 * 1000,
      },
    ]);
  });

  it('one stream over the hourly limit from one IP is a named rate_limited error that reads nothing', async () => {
    for (let i = 0; i < REPORT_VIEWS_PER_IP_PER_HOUR; i++) {
      expect((await open(AUDIT_ID)).status).toBe(200);
    }
    h.tables = [];
    const res = await open(AUDIT_ID);
    // F-C 1: an event stream, not a JSON 429, so the page's EventSource reads it: one named `error`
    // carrying `code: 'rate_limited'`, which the wiring turns into a terminal state, then the end.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('private, no-cache, no-transform');
    const events = await eventsOf(res);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'error', data: { code: 'rate_limited' } });
    expect(typeof events[0]!.data.message).toBe('string');
    expect(h.tables).toEqual([]);
    // Another address is not affected.
    h.ip = '198.51.100.31';
    expect((await open(AUDIT_ID)).status).toBe(200);
  });

  it('a request with no known client IP is not bucketed (one shared "unknown" bucket would throttle everyone)', async () => {
    h.ip = 'unknown';
    const res = await open(AUDIT_ID);
    expect(res.status).toBe(200);
    expect(h.limiterCalls).toEqual([]);
  });

  it('a valid id still streams snapshot then done, with Cache-Control private, no-cache, no-transform', async () => {
    const res = await open(AUDIT_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('private, no-cache, no-transform');
    const events = (await res.text())
      .split('\n\n')
      .filter((b) => b.startsWith('event: '))
      .map((b) => b.slice(7, b.indexOf('\n')));
    expect(events).toEqual(['snapshot', 'done']);
    expect(h.tables[0]).toBe('audits');
  });

  // F-C 2: a well-formed id with no row ends the stream at once instead of polling until self-close.
  it('a UUID with no audit row sends one named error (not_found) and closes after one read', async () => {
    h.row = null;
    const res = await open(AUDIT_ID);
    expect(res.status).toBe(200);
    const events = await eventsOf(res);
    expect(events).toEqual([
      { event: 'error', data: { code: 'not_found', message: expect.any(String) } },
    ]);
    expect(h.tables).toEqual(['audits']);
  });

  it('a failed first read is not taken for a missing row: the stream stays open to poll', async () => {
    vi.useFakeTimers();
    try {
      h.readError = { code: '57014', message: 'canceling statement due to statement timeout' };
      const res = await open(AUDIT_ID);
      const reader = res.body!.getReader();
      // Nothing is emitted for the failed read; the next poll finds the row and finishes.
      h.readError = null;
      await vi.advanceTimersByTimeAsync(3000);
      const chunks: string[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
      const names = chunks
        .join('')
        .split('\n\n')
        .filter((b) => b.startsWith('event: '))
        .map((b) => b.slice(7, b.indexOf('\n')));
      expect(names).toEqual(['progress', 'done']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an upper-case UUID is a UUID (Postgres reads it the same)', async () => {
    const res = await open(AUDIT_ID.toUpperCase());
    expect(res.status).toBe(200);
    await res.text();
  });
});
