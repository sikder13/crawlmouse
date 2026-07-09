import { describe, it, expect } from 'vitest';
import { projectAuditForClient, type AuditRow, type ConversionProjectionInput } from './audit-stream-projection';
import { entitlementFor } from './entitlement';
import type { AiSignalsPage } from './ai-readiness-packets';
import type { ConfidenceBand, ProjectedGrade, FreeFix, FixPrescription, MonitoringDelta, Finding, GraphData, AiReadinessScore, PageAiSignals } from '@crawlmouse/types';

const row = (o: Partial<AuditRow> = {}): AuditRow => ({
  id: 'a1',
  url: 'https://ex.com/',
  status: 'completed',
  grade: 'A',
  score: '92.50',
  page_count: 10,
  link_count: 40,
  cms_detected: 'custom',
  user_id: 'user-123',
  settings: { pageCap: 500 },
  failure_reason: null,
  confidence: null,
  coverage_pct: null,
  block_rate: null,
  partial: null,
  ...o,
});

describe('projectAuditForClient', () => {
  it('never puts user_id on the wire', () => {
    const out = projectAuditForClient(row({ user_id: 'secret-user' }));
    expect('user_id' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret-user');
  });

  it('never puts the SPEC 04 server-side progress/notify columns on the wire (activity flows ONLY via the activity event)', () => {
    // The SSE route now selects crawl_activity (the ring) and the row may carry notify_email.
    // The projection is the single chokepoint: neither may ever reach snapshot/progress payloads —
    // activity is emitted separately (seq-delta) and the email is for the worker only.
    const out = projectAuditForClient({
      ...row(),
      crawl_activity: [{ kind: 'fetch_ok', label: '/x', at: 't', seq: 1 }],
      notify_email: 'secret@example.com',
      pages_crawled: 12,
      crawl_estimated_total: 200,
      crawl_phase: 'crawling',
    } as unknown as AuditRow);
    expect('crawl_activity' in out).toBe(false);
    expect('notify_email' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret@example.com');
  });

  it('never puts the raw failure_reason on the wire — only the coarse category', () => {
    const out = projectAuditForClient(
      row({
        status: 'failed',
        grade: null,
        score: null,
        failure_reason: 'Request timed out after 15000ms: https://internal.example/secret-path',
      }),
    );
    expect('failure_reason' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret-path');
    expect(out.failureCategory).toBe('timeout');
  });

  it('coerces the PostgREST numeric-string score to a number', () => {
    expect(projectAuditForClient(row({ score: '87.25' })).score).toBe(87.25);
    expect(projectAuditForClient(row({ score: null })).score).toBe(null);
  });

  it('only a failed audit gets a failureCategory; everything else is null', () => {
    expect(projectAuditForClient(row({ status: 'completed' })).failureCategory).toBe(null);
    expect(projectAuditForClient(row({ status: 'crawling' })).failureCategory).toBe(null);
    // A stray reason on a non-failed row is ignored; a real failure is classified.
    expect(
      projectAuditForClient(row({ status: 'completed', failure_reason: 'getaddrinfo ENOTFOUND x' })).failureCategory,
    ).toBe(null);
    expect(
      projectAuditForClient(row({ status: 'failed', grade: null, score: null, failure_reason: 'getaddrinfo ENOTFOUND x' }))
        .failureCategory,
    ).toBe('dns');
  });

  it('passes through the client-safe fields', () => {
    const out = projectAuditForClient(row({ id: 'z9', grade: 'B', cms_detected: 'shopify' }));
    expect(out).toMatchObject({
      id: 'z9',
      status: 'completed',
      grade: 'B',
      cms_detected: 'shopify',
      page_count: 10,
      link_count: 40,
      settings: { pageCap: 500 },
    });
  });
});

// SPEC 01 §6/§10 (v2): per-audit crawl-health rides the SAME client-safe projection chokepoint so
// the client can enrich `audit-completed` with it. The numeric columns (coverage_pct / block_rate)
// arrive from PostgREST as STRINGS and must be coerced to numbers (like score) so PostHog charts a
// real distribution, not string buckets. A v1 row (NULL columns) must project to `crawlHealth: null`
// so the client adds no crawl-health props — zero new emits on the v1 path.
describe('projectAuditForClient — crawl-health (§6/§10, v2)', () => {
  it('carries crawl-health to the client, coercing PostgREST numeric strings to numbers', () => {
    const out = projectAuditForClient(
      row({ confidence: 'high', coverage_pct: '0.9500', block_rate: '0.0200', partial: false }),
    );
    expect(out.crawlHealth).toEqual({ confidence: 'high', coveragePct: 0.95, blockRate: 0.02, partial: false });
  });

  it('projects to null when the crawl-health columns are NULL (a v1 audit) — client emits no crawl-health props', () => {
    const out = projectAuditForClient(row({ confidence: null, coverage_pct: null, block_rate: null, partial: null }));
    expect(out.crawlHealth).toBe(null);
  });

  it('carries a low-confidence / partial crawl through unchanged (the degraded case the UI caveats)', () => {
    const out = projectAuditForClient(
      row({ confidence: 'low', coverage_pct: '0.5', block_rate: '0.3', partial: true }),
    );
    expect(out.crawlHealth).toEqual({ confidence: 'low', coveragePct: 0.5, blockRate: 0.3, partial: true });
  });
});

// SPEC 02 §6/§7 — the wall inversion. The cure (`prescriptions` + `monitoring`) is OWNER-SCOPED:
// served only to the authenticated owner who is Pro. The free taste (`freeFix`, the `projectedGrade`
// ledger, `confidenceBand`, the full `findings` diagnosis) is ALWAYS present. Gated fields are `null`
// AND must never appear anywhere in the serialized payload.
const band: ConfidenceBand = {
  pointEstimate: 92.5, grade: 'A', lower: 90.5, upper: 94.5, confidence: 'high',
  basis: { crawled: 10, estimatedTotal: 10, method: 'sitemap' }, isEstimate: false,
};
const freePrescription: FixPrescription = {
  fixId: 'orphan:https://x.com/o',
  suggestedLinks: [{ fromUrl: 'https://x.com/h', fromTitle: 'Home', anchorText: 'the orphan page', relevanceScore: 0.8 }],
  actionPacket: { fixId: 'orphan:https://x.com/o', format: 'markdown', body: 'FREE TASTE BODY', copyLabel: 'Copy for ChatGPT / Claude' },
};
const gatedPrescription: FixPrescription = {
  fixId: 'deep_page:https://x.com/d',
  suggestedLinks: [{ fromUrl: 'https://x.com/h', fromTitle: 'Home', anchorText: 'a deep page', relevanceScore: 0.5 }],
  actionPacket: { fixId: 'deep_page:https://x.com/d', format: 'markdown', body: 'GATED CURE BODY', copyLabel: 'Copy for ChatGPT / Claude' },
};
const freeFix: FreeFix = {
  diagnosis: { id: 'orphan:https://x.com/o', category: 'orphan', targetUrl: 'https://x.com/o', targetTitle: 'Orphan', marginalDelta: 5, effort: 'low', rationale: 'no inbound links' },
  prescription: freePrescription,
  rank: 1,
};
const projectedGrade: ProjectedGrade = {
  current: { score: 92.5, grade: 'A' }, projected: { score: 97, grade: 'A' },
  ledger: [freeFix.diagnosis], disclaimer: 'Estimated, not guaranteed.',
};
const monitoring: MonitoringDelta = {
  previousAuditId: 'prev', currentAuditId: 'a1', scoreDelta: 3, gradeFrom: 'B', gradeTo: 'A',
  resolvedFixIds: ['x'], newFixIds: [], ranAt: '2026-06-29T00:00:00Z',
};
const findings: Finding[] = [{ category: 'orphan', severity: 'critical', pageUrl: 'https://x.com/o', payload: { secret: 'PAYLOAD_SECRET' } }];
const testGraph: GraphData = { nodes: [], edges: [], totalNodes: 5, totalEdges: 4, capped: true, capReason: 'free_tier' };
const conv = (over: Partial<ConversionProjectionInput> = {}): ConversionProjectionInput => ({
  entitlement: entitlementFor('pro', null),
  isOwner: true,
  confidenceBand: band,
  projectedGrade,
  freeFix,
  prescriptions: [freePrescription, gatedPrescription],
  monitoring,
  findings,
  orphanCount: 1,
  avgDepth: 2.5,
  viewerSignedIn: true,
  graph: testGraph,
  aiReadiness: null,
  pageAiSignals: [],
  ...over,
});

// ── SPEC 05 §9 fixtures — the sibling AI-readiness projection (owner-scoped gate). The homepage
// (row.url = 'https://ex.com/') carries a distinct excerpt marker; a NON-homepage page carries a
// separate marker so A11 can prove the non-homepage excerpt never reaches a free/non-owner viewer.
const HOME_EXCERPT = 'HOMEPAGE_EXCERPT_WELCOME';
const NONHOME_EXCERPT = 'NONHOME_EXCERPT_ZZTOP';
const aiSignals = (over: Partial<PageAiSignals> = {}): PageAiSignals => ({
  pageClass: 'readable', mainTextChars: 500, excerpt: 'x', csrSignals: [], frameworkMarker: null,
  hasTitle: true, hasMetaDescription: true, h1Count: 1, headingLevelsSkipped: false, hasMainLandmark: true,
  jsonLd: { present: true, valid: true, types: ['Organization'] }, ...over,
});
// row().url is the RAW submission 'https://ex.com/'; the homepage PAGE url is CANONICAL 'https://ex.com'
// (no slash) at depth 0 — so homepageView must resolve via the depth-0 fallback, not an exact match.
const aiPages: AiSignalsPage[] = [
  { url: 'https://ex.com', title: 'Home', depth: 0, aiSignals: aiSignals({ excerpt: HOME_EXCERPT }) },
  { url: 'https://ex.com/deep', title: 'Deep', depth: 2, aiSignals: aiSignals({ pageClass: 'js_blind', mainTextChars: 5, excerpt: NONHOME_EXCERPT }) },
];
const aiScore: AiReadinessScore = {
  score: 55, band: 'partial',
  components: { access: { score: 1, weight: 25 }, contentWithoutJs: { score: 0.5, weight: 40 }, machineLegibility: { score: 0.6, weight: 20 }, retrievalPath: { score: 0.5, weight: 15 } },
  confidence: 'high', isEstimate: false,
  basis: { pagesAnalyzed: 2, siteJsRendered: false, retrievalPathBasis: 'full' },
  findings: [{ id: 'ai-1', kind: 'js_blind_page', severity: 'high', targetUrl: 'https://ex.com/deep', targetTitle: 'Deep', plainLanguage: 'This page renders with JavaScript.', evidence: 'strong' }],
  accessMatrix: { bots: [], robotsTxtFound: true, wafDetected: false, wafNote: null },
  llmsTxt: { present: false, parseable: false, note: 'n/a' }, asOf: '2026-07-01',
};
const aiConv = (over: Partial<ConversionProjectionInput> = {}) => conv({ aiReadiness: aiScore, pageAiSignals: aiPages, ...over });
// The static packet Task text is a reliable "a packet body is present" signature (never in the free payload).
const PACKET_BODY_SIGNATURE = 'Rewrite this page so its main content';

describe('projectAuditForClient — AI-readiness (SPEC 05 §9 owner-scoped)', () => {
  it('degradation: no persisted score ⇒ aiReadiness is null end-to-end (extraction off / signals absent)', () => {
    expect(projectAuditForClient(row(), conv()).aiReadiness).toBeNull();
    expect(projectAuditForClient(row(), aiConv({ aiReadiness: null })).aiReadiness).toBeNull();
  });

  it('FREE viewer: full score + homepage view (via depth-0 fallback), but NO whatAiSees and NO aiPackets', () => {
    const out = projectAuditForClient(row(), aiConv({ isOwner: false, entitlement: entitlementFor('free', null) }));
    expect(out.aiReadiness).not.toBeNull();
    expect(out.aiReadiness!.score).toEqual(aiScore); // full ledger + matrix + llms.txt — FREE
    expect(out.aiReadiness!.homepageView!.excerpt).toBe(HOME_EXCERPT); // the wow — FREE (raw row.url ≠ canonical page url)
    expect(out.aiReadiness!.whatAiSees).toBeNull();
    expect(out.aiReadiness!.aiPackets).toBeNull();
    expect(out.aiReadiness!.hasMoreAiPackets).toBe(true); // wall shape without the cure
  });

  it('A11 SECURITY: a FREE OWNER (owner but not Pro) is gated exactly like a free viewer — NO whatAiSees, NO packets', () => {
    // Kills the mutation `canArtifacts = isOwner` (dropping `&& canUseActionPackets`) at the UNIT level.
    const out = projectAuditForClient(row(), aiConv({ isOwner: true, entitlement: entitlementFor('free', null) }));
    expect(out.aiReadiness!.homepageView!.excerpt).toBe(HOME_EXCERPT); // free taste still delivered
    expect(out.aiReadiness!.whatAiSees).toBeNull();
    expect(out.aiReadiness!.aiPackets).toBeNull();
    expect(JSON.stringify(out)).not.toContain(NONHOME_EXCERPT);
    expect(JSON.stringify(out)).not.toContain(PACKET_BODY_SIGNATURE);
  });

  it('A11 SECURITY: a free serialized payload contains NO non-homepage excerpt and NO packet body', () => {
    const json = JSON.stringify(projectAuditForClient(row(), aiConv({ isOwner: false, entitlement: entitlementFor('free', null) })));
    expect(json).toContain(HOME_EXCERPT);        // homepage excerpt is FREE
    expect(json).not.toContain(NONHOME_EXCERPT); // ...but no OTHER page's excerpt leaks
    expect(json).not.toContain(PACKET_BODY_SIGNATURE); // ...and no packet body leaks
  });

  it('A11 SECURITY: a non-owner Pro is gated exactly like free (owner-scoped, not tier-scoped)', () => {
    const out = projectAuditForClient(row(), aiConv({ isOwner: false, entitlement: entitlementFor('pro', null) }));
    expect(out.aiReadiness!.whatAiSees).toBeNull();
    expect(out.aiReadiness!.aiPackets).toBeNull();
    expect(JSON.stringify(out)).not.toContain(NONHOME_EXCERPT);
    expect(JSON.stringify(out)).not.toContain(PACKET_BODY_SIGNATURE);
  });

  it('Pro OWNER: whatAiSees (all pages) + aiPackets (built on-demand, escaped) are delivered', () => {
    const out = projectAuditForClient(row(), aiConv()); // default conv() = owner + pro (canUseActionPackets)
    expect(out.aiReadiness!.whatAiSees).toHaveLength(2);
    expect(out.aiReadiness!.aiPackets!.length).toBeGreaterThan(0);
    const json = JSON.stringify(out);
    expect(json).toContain(NONHOME_EXCERPT);       // the owner DOES see every page
    expect(json).toContain(PACKET_BODY_SIGNATURE); // ...and the packet body
  });

  it('on-demand packets are byte-deterministic across two projection calls (R1)', () => {
    const a = projectAuditForClient(row(), aiConv());
    const b = projectAuditForClient(row(), aiConv());
    expect(JSON.stringify(a.aiReadiness)).toBe(JSON.stringify(b.aiReadiness));
  });
});

describe('projectAuditForClient — conversion core (§6/§7 owner-scoped wall)', () => {
  it('single-arg projection is the legacy ClientAudit — no conversion keys leak onto v1 payloads', () => {
    const out = projectAuditForClient(row());
    expect('entitlement' in out).toBe(false);
    expect('projectedGrade' in out).toBe(false);
    expect('prescriptions' in out).toBe(false);
    expect('freeFix' in out).toBe(false);
  });

  it('owner+Pro receives the full cure (prescriptions + monitoring populated)', () => {
    const out = projectAuditForClient(row(), conv());
    expect(out.prescriptions).toHaveLength(2);
    expect(out.monitoring).not.toBeNull();
    expect(out.hasMorePrescriptions).toBe(true); // 2 cures > 1 free
    expect(JSON.stringify(out)).toContain('GATED CURE BODY'); // entitled → cure delivered
  });

  it('SECURITY: a FREE owner gets the free taste but NEVER the gated cure', () => {
    const out = projectAuditForClient(row(), conv({ entitlement: entitlementFor('free', null) }));
    expect(out.prescriptions).toBeNull();
    expect(out.monitoring).toBeNull();
    expect(JSON.stringify(out)).not.toContain('GATED CURE BODY'); // gated cure never serialized
    // the FREE taste IS delivered
    expect(out.freeFix).not.toBeNull();
    expect(out.projectedGrade).not.toBeNull();
    expect(out.confidenceBand).not.toBeNull();
    expect(JSON.stringify(out)).toContain('FREE TASTE BODY');
    expect(out.hasMorePrescriptions).toBe(true); // still signal the wall
  });

  it('SECURITY: a non-owner (even Pro) never receives the cure — owner-scoped, not just tier-scoped', () => {
    const out = projectAuditForClient(row(), conv({ isOwner: false, entitlement: entitlementFor('pro', null) }));
    expect(out.prescriptions).toBeNull();
    expect(out.monitoring).toBeNull();
    expect(JSON.stringify(out)).not.toContain('GATED CURE BODY');
    expect(out.freeFix).not.toBeNull(); // a non-owner still gets the free view
  });

  it('omits Finding.payload on the wire (lean projection)', () => {
    const out = projectAuditForClient(row(), conv());
    expect(out.findings).toHaveLength(1);
    expect('payload' in out.findings[0]!).toBe(false);
    expect(out.findings[0]!.pageUrl).toBe('https://x.com/o');
    expect(JSON.stringify(out)).not.toContain('PAYLOAD_SECRET');
  });

  it('hasMorePrescriptions is false when only the single free fix exists', () => {
    const out = projectAuditForClient(row(), conv({ prescriptions: [freePrescription] }));
    expect(out.hasMorePrescriptions).toBe(false);
  });

  it('still strips user_id on the v2 (conversion) path', () => {
    const out = projectAuditForClient(row({ user_id: 'secret-user' }), conv());
    expect('user_id' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret-user');
  });

  it('v1.2: viewerSignedIn + graph are FREE — present for a free non-owner; cure still gated', () => {
    const out = projectAuditForClient(row(), conv({ isOwner: false, entitlement: entitlementFor('free', null), viewerSignedIn: false }));
    expect(out.viewerSignedIn).toBe(false);
    expect(out.graph).toBe(testGraph); // the graph is the wow — a free non-owner still sees it
    expect(out.prescriptions).toBeNull(); // ...but the cure stays owner+Pro gated
  });
});
