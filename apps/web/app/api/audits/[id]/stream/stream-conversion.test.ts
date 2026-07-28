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
const aiSig = (over = {}) => ({ pageClass: 'readable', mainTextChars: 400, title: 'Fixture Title', excerpt: 'x', csrSignals: [], frameworkMarker: null, hasTitle: true, hasMetaDescription: true, h1Count: 1, headingLevelsSkipped: false, hasMainLandmark: true, jsonLd: { present: true, valid: true, types: ['Organization'], hasEntityType: true }, ...over });
// Non-overlapping markers (neither a substring of the other) so the security assertions can't tautologize.
const HOME_VIEW_MARKER = 'HOMEVIEW_ALPHA_MARK';
const NONHOME_VIEW_MARKER = 'OTHERPAGE_BRAVO_MARK';
// The homepage PAGE url is canonical ('https://x.com', no slash); auditRow.url is the raw 'https://x.com/'
// — so the route must resolve homepageView through the depth-0 fallback, end to end.
const cannedPages = [
  { id: 'p1', url: 'https://x.com', title: 'Home', depth: 0, is_orphan: false, pagerank: 0.9, in_degree: 2, out_degree: 1, excluded_from_grade: false, ai_signals: aiSig({ excerpt: HOME_VIEW_MARKER }) },
  { id: 'p2', url: 'https://x.com/o', title: 'Orphan', depth: 1, is_orphan: true, pagerank: 0.1, in_degree: 1, out_degree: 0, excluded_from_grade: false, ai_signals: aiSig({ pageClass: 'js_blind', mainTextChars: 4, title: 'Fixture Title', excerpt: NONHOME_VIEW_MARKER }) },
];
const cannedAiScore = {
  score: 50, band: 'partial',
  components: { access: { score: 1, weight: 25 }, contentWithoutJs: { score: 0.5, weight: 40 }, machineLegibility: { score: 0.6, weight: 20 }, retrievalPath: { score: 0.5, weight: 15 } },
  confidence: 'high', isEstimate: false,
  basis: { pagesAnalyzed: 2, siteJsRendered: false, retrievalPathBasis: 'full' },
  findings: [{ id: 'ai-1', kind: 'js_blind_page', severity: 'high', targetUrl: 'https://x.com/o', targetTitle: 'Orphan', plainLanguage: 'renders with JS', evidence: 'strong' }],
  accessMatrix: { bots: [], robotsTxtFound: true, wafDetected: false, wafNote: null },
  llmsTxt: { present: false, parseable: false, note: 'n/a' }, asOf: '2026-07-01',
};
const PACKET_BODY_SIGNATURE = 'Rewrite this page so its main content';
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
  convRow = { confidence_band: { pointEstimate: 72, grade: 'B-', lower: 70, upper: 74, confidence: 'high', basis: { crawled: 2, estimatedTotal: 2, method: 'sitemap' }, isEstimate: false }, projected_score: '88.00', projected_grade: 'A-', previous_audit_id: null, completed_at: '2026-06-29T00:00:00Z', ai_readiness: cannedAiScore };
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
    expect(pagesSelectArg).toBe('is_orphan, depth'); // v1 reads only legacy cols — no dependency on pages.pagerank / ai_signals
  });

  // ── SPEC 05 §9/§11/§12 — the sibling AI-readiness projection, wired through the SSE done payload. ──
  it('owner + Pro receives the AI-readiness score + homepage view + whatAiSees + on-demand packets', async () => {
    const { data, raw } = await runDone();
    expect(data.aiReadiness.score.score).toBe(50);
    expect(data.aiReadiness.homepageView.excerpt).toBe(HOME_VIEW_MARKER);
    expect(data.aiReadiness.whatAiSees).toHaveLength(2); // whole-site simulator
    expect(data.aiReadiness.aiPackets.length).toBeGreaterThan(0); // built on-demand for the owner
    expect(raw).toContain(NONHOME_VIEW_MARKER); // the owner sees every page
    expect(raw).toContain(PACKET_BODY_SIGNATURE);
    expect(pagesSelectArg).toContain('ai_signals'); // A12 read-path: the v2 read selects the signals column
  });

  it('SECURITY (A11): a FREE owner gets score + homepage view but NO whatAiSees, NO packets, NO non-home excerpt', async () => {
    ownerProUntil = null; // owner, but not Pro
    const { data, raw } = await runDone();
    expect(data.aiReadiness.score.score).toBe(50); // the diagnosis is free
    expect(data.aiReadiness.homepageView.excerpt).toBe(HOME_VIEW_MARKER);
    expect(data.aiReadiness.whatAiSees).toBeNull();
    expect(data.aiReadiness.aiPackets).toBeNull();
    expect(raw).toContain(HOME_VIEW_MARKER);
    expect(raw).not.toContain(NONHOME_VIEW_MARKER); // no other page's excerpt on the wire
    expect(raw).not.toContain(PACKET_BODY_SIGNATURE); // no packet body on the wire
  });

  it('SECURITY (A11): a non-owner (different user) is gated exactly like free', async () => {
    userResult = { data: { user: { id: 'intruder' } } };
    const { data, raw } = await runDone();
    expect(data.aiReadiness.whatAiSees).toBeNull();
    expect(data.aiReadiness.aiPackets).toBeNull();
    expect(raw).not.toContain(NONHOME_VIEW_MARKER);
    expect(raw).not.toContain(PACKET_BODY_SIGNATURE);
  });

  it('degradation: an audit with no persisted ai_readiness projects aiReadiness = null', async () => {
    convRow!.ai_readiness = null;
    const { data } = await runDone();
    expect(data.aiReadiness).toBeNull();
  });
});
