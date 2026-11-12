/**
 * POST /api/reports/[slug]/view (CC-29 Q14). The event goes through the real `captureServerEvent`
 * to a stubbed fetch, so what reaches PostHog, and whether anything does, is read where it leaves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReportRow } from '@/lib/reports';
import { fixture } from '@/lib/v2/fixtures';
import { buildPublicSnapshot } from '@/lib/v2/reports/build-snapshot';
import { FIRST_AUDIT } from '@/lib/v2/view/segment/test-helpers';

const store = vi.hoisted(() => ({
  row: null as unknown,
  allowed: true,
  buckets: [] as string[],
  reads: 0,
}));
vi.mock('@/lib/reports', () => ({
  getPublicReport: async () => {
    store.reads++;
    return store.row;
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string) => {
    store.buckets.push(key);
    return { allowed: store.allowed, remaining: 0, resetAt: new Date() };
  },
}));

const { POST } = await import('./route');

const MINTED = '2026-11-12T18:00:00.000Z';
const v2 = buildPublicSnapshot(fixture('bad-site'), FIRST_AUDIT['bad-site'], MINTED);

const row = (extra: Partial<PublicReportRow>): PublicReportRow => ({
  domain: 'example-outfitter.com',
  grade: null,
  score: null,
  cms_detected: null,
  orphan_count: null,
  avg_depth: null,
  takedown_requested_at: null,
  created_at: MINTED,
  claimed_at: null,
  listed: false,
  indexable: false,
  hidden_at: null,
  white_label: null,
  ...extra,
});
const v2Row = (extra: Partial<PublicReportRow> = {}) =>
  row({ report_snapshot: v2 as unknown as PublicReportRow['report_snapshot'], ...extra });

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

const post = (slug = 'abc123', cookie = 'cm_consent=granted') =>
  POST(
    new Request(`https://crawlmouse.com/api/reports/${slug}/view`, {
      method: 'POST',
      headers: { cookie, 'x-forwarded-for': '9.9.9.9' },
    }),
    { params: Promise.resolve({ slug }) },
  );

/** The events posted to PostHog. */
const sent = () =>
  (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([, init]) =>
    JSON.parse(String(init.body)),
  );

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  store.row = v2Row();
  store.allowed = true;
  store.buckets = [];
  store.reads = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/reports/[slug]/view', () => {
  it('is a 404 with the flag off, before any bucket, read or event', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await post()).status).toBe(404);
    expect([store.buckets, store.reads, fetchMock.mock.calls.length]).toEqual([[], 0, 0]);
  });

  it('a live v2 report: 204 and one report_viewed {kind: v2}, keyed by the report', async () => {
    const res = await post();
    expect(res.status).toBe(204);
    expect(store.buckets).toEqual(['report-view:ip:9.9.9.9']);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      event: 'report_viewed',
      distinct_id: 'report:abc123',
      properties: { kind: 'v2', $process_person_profile: false },
    });
  });

  it('a live v1 report sends kind v1', async () => {
    store.row = row({ grade: 'B', score: 79 });
    expect((await post()).status).toBe(204);
    expect(sent()[0].properties.kind).toBe('v1');
  });

  it('sends nothing when the visitor declined, or their region needs consent they have not given', async () => {
    expect((await post('abc123', 'cm_consent=denied')).status).toBe(204);
    expect((await post('abc123', 'cm_consent_required=1')).status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a hidden, taken-down or missing report is a 404 with no event', async () => {
    for (const r of [
      v2Row({ hidden_at: MINTED }),
      v2Row({ takedown_requested_at: MINTED }),
      null,
    ]) {
      store.row = r;
      expect((await post()).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a malformed slug is a 404 before any bucket or read', async () => {
    expect((await post('a/b')).status).toBe(404);
    expect((await post('x'.repeat(65))).status).toBe(404);
    expect([store.buckets, store.reads]).toEqual([[], 0]);
  });

  it('over the per-IP limit: 429, no read, no event', async () => {
    store.allowed = false;
    expect((await post()).status).toBe(429);
    expect([store.reads, fetchMock.mock.calls.length]).toEqual([0, 0]);
  });
});
