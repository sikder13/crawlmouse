import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Integration test for the SSE `done` payload: drives the real GET route and parses the streamed
// conversion core, proving the owner-scoped cure gate end-to-end (reads → reconstruct → project).
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

let auditRow: Record<string, unknown>;
let convRow: Record<string, unknown> | null;
let userResult: { data: { user: { id: string } | null } };
let ownerProUntil: string | null;
let pagesSelectArg = '';

const cannedFindings = [{ category: 'orphan', severity: 'critical', pages: { url: 'https://x.com/o' } }];
const cannedPages = [
  { id: 'p1', url: 'https://x.com/', title: 'Home', depth: 0, is_orphan: false, pagerank: 0.9, in_degree: 2, out_degree: 1, excluded_from_grade: false },
  { id: 'p2', url: 'https://x.com/o', title: 'Orphan', depth: 1, is_orphan: true, pagerank: 0.1, in_degree: 1, out_degree: 0, excluded_from_grade: false },
];
const cannedLinks = [{ from_page_id: 'p1', to_page_id: 'p2' }];
const freeFixRow = { fix_id: 'orphan:https://x.com/o', category: 'orphan', target_url: 'https://x.com/o', target_title: 'Orphan', marginal_delta: 5, effort: 'low', rationale: 'no inbound', rank: 1, is_free_fix: true, suggested_links: [{ fromUrl: 'https://x.com/', fromTitle: 'Home', anchorText: 'the orphan', relevanceScore: 0.8 }], action_packet_body: 'FREE TASTE BODY' };
const gatedFixRow = { fix_id: 'deep:https://x.com/d', category: 'deep_page', target_url: 'https://x.com/d', target_title: 'Deep', marginal_delta: 2, effort: 'medium', rationale: 'too deep', rank: 2, is_free_fix: false, suggested_links: [{ fromUrl: 'https://x.com/', fromTitle: 'Home', anchorText: 'deep', relevanceScore: 0.5 }], action_packet_body: 'GATED CURE BODY' };

vi.mock('@/lib/supabase/fetch-all', () => ({
  POSTGREST_PAGE: 1000,
  fetchAll: (_c: unknown, table: string, cols: string) => {
    if (table === 'findings') return Promise.resolve(cannedFindings);
    if (table === 'pages') { pagesSelectArg = cols; return Promise.resolve(cannedPages); }
    if (table === 'links') return Promise.resolve(cannedLinks);
    if (table === 'fixes') return Promise.resolve(cols === 'fix_id' ? [] : [freeFixRow, gatedFixRow]);
    return Promise.resolve([]);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      let selectCols = '';
      const chain = {
        select: (cols: string) => { selectCols = cols; return chain; },
        eq: () => chain,
        maybeSingle: () => {
          if (table === 'audits') {
            if (selectCols.includes('confidence_band')) return Promise.resolve({ data: convRow, error: null });
            if (selectCols.includes('failure_reason')) return Promise.resolve({ data: auditRow, error: null }); // initial read
            return Promise.resolve({ data: null, error: null }); // a predecessor (none in these fixtures)
          }
          return Promise.resolve({ data: null, error: null });
        },
        range: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({
    auth: { getUser: () => Promise.resolve(userResult) },
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { pro_until: ownerProUntil }, error: null }) };
      return chain;
    },
  }),
}));

import { GET } from './route';

async function runDone() {
  const res = await GET(new NextRequest('http://localhost/api/audits/aud-1/stream'), { params: Promise.resolve({ id: 'aud-1' }) });
  const raw = await res.text();
  const doneBlock = raw.split('\n\n').find((b) => b.startsWith('event: done'))!;
  const data = JSON.parse(doneBlock.slice(doneBlock.indexOf('data: ') + 6));
  return { data, raw };
}

beforeEach(() => {
  // a completed v2 audit (confidence set = v2) owned by owner-1
  auditRow = { id: 'aud-1', url: 'https://x.com/', status: 'completed', grade: 'B-', score: '72.00', page_count: 2, link_count: 1, cms_detected: 'custom', user_id: 'owner-1', settings: { pageCap: 500 }, failure_reason: null, confidence: 'high', coverage_pct: '0.95', block_rate: '0', partial: false };
  convRow = { confidence_band: { pointEstimate: 72, grade: 'B-', lower: 70, upper: 74, confidence: 'high', basis: { crawled: 2, estimatedTotal: 2, method: 'sitemap' }, isEstimate: false }, projected_score: '88.00', projected_grade: 'A-', previous_audit_id: null, completed_at: '2026-06-29T00:00:00Z' };
  userResult = { data: { user: { id: 'owner-1' } } };
  ownerProUntil = FUTURE;
  pagesSelectArg = '';
});

describe('SSE done payload — conversion core wiring + owner-scoped gate (integration)', () => {
  it('owner + Pro receives the full cure (projectedGrade + freeFix + prescriptions + band)', async () => {
    const { data, raw } = await runDone();
    expect(data.projectedGrade.projected).toEqual({ score: 88, grade: 'A-' });
    expect(data.confidenceBand.grade).toBe('B-');
    expect(data.freeFix.diagnosis.id).toBe('orphan:https://x.com/o');
    expect(data.prescriptions).toHaveLength(2);
    expect(raw).toContain('GATED CURE BODY'); // entitled → the gated cure is delivered
    expect(raw).toContain('FREE TASTE BODY');
  });

  it('SECURITY: a FREE owner gets the free taste but NOT the gated cure', async () => {
    ownerProUntil = null; // owner, but not Pro
    const { data, raw } = await runDone();
    expect(data.freeFix.diagnosis.id).toBe('orphan:https://x.com/o'); // free taste present
    expect(data.projectedGrade).not.toBeNull(); // the gap is free
    expect(data.prescriptions).toBeNull(); // the full cure is gated
    expect(raw).toContain('FREE TASTE BODY');
    expect(raw).not.toContain('GATED CURE BODY'); // never serialized
  });

  it('SECURITY: a non-owner (different user) never receives the gated cure', async () => {
    userResult = { data: { user: { id: 'intruder' } } };
    const { data, raw } = await runDone();
    expect(data.prescriptions).toBeNull();
    expect(data.monitoring).toBeNull();
    expect(raw).not.toContain('GATED CURE BODY');
    expect(data.freeFix).not.toBeNull(); // a non-owner still gets the free view + graph
    expect(data.graph).not.toBeNull();
  });

  it('v1 audit (no crawl-health): no conversion core, legacy keys preserved, and pagerank NOT selected (deploy-safe)', async () => {
    auditRow.confidence = null; // v1 row
    const { data } = await runDone();
    expect(data.projectedGrade).toBeNull();
    expect(data.graph).toBeNull();
    expect(data.findingGroups).toBeDefined(); // legacy key preserved
    expect(pagesSelectArg).toBe('is_orphan, depth'); // v1 reads only legacy cols — no dependency on pages.pagerank
  });
});
