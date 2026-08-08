import { describe, it, expect } from 'vitest';
import { projectAuditForClient, type AuditRow, type ConversionProjectionInput } from './audit-stream-projection';
import { entitlementFor } from './entitlement';
import type { AiSignalsPage } from './ai-readiness-packets';
import type { ConfidenceBand, ProjectedGrade, FreeFix, FixPrescription, MonitoringDelta, Finding, GraphData, AiReadinessScore, PageAiSignals, AiFinding } from '@crawlmouse/types';
import { AI_CLIENT_MAX_FINDINGS, WHAT_AI_SEES_MAX_PAGES } from '@crawlmouse/types';
import { PRO_PAGE_CAP } from './limits';

/** Base AI finding used by the payload RULE test below (kind is packetable, so packets get built too). */
const aiFindingBase = (i: number): AiFinding => ({
  // `js_blind_page` — a real AiFindingKind that IS packetable (FINDING_TO_PACKET maps it to the
  // server_render packet). The earlier value here was `server_render`, which is a PacketKind, not a
  // finding kind: it failed typecheck AND made every fixture finding non-packetable, so the RULE test
  // below asserted `aiPackets` was non-null while the array was silently EMPTY.
  id: `rule-${i}`, kind: 'js_blind_page', severity: 'info',
  targetUrl: `https://ex.com/p${i}`, targetTitle: `T${i}`, plainLanguage: 'P', evidence: 'strong',
});

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
    expect(out.crawlHealth).toEqual({ confidence: 'high', coveragePct: 0.95, blockRate: 0.02, partial: false, discovered: null, blocked: null });
  });

  it('projects to null when the crawl-health columns are NULL (a v1 audit) — client emits no crawl-health props', () => {
    const out = projectAuditForClient(row({ confidence: null, coverage_pct: null, block_rate: null, partial: null }));
    expect(out.crawlHealth).toBe(null);
  });

  it('carries a low-confidence / partial crawl through unchanged (the degraded case the UI caveats)', () => {
    const out = projectAuditForClient(
      row({ confidence: 'low', coverage_pct: '0.5', block_rate: '0.3', partial: true }),
    );
    expect(out.crawlHealth).toEqual({ confidence: 'low', coveragePct: 0.5, blockRate: 0.3, partial: true, discovered: null, blocked: null });
  });

  it('carries the ATTEMPTED and REFUSED counts, which the refusal copy needs as two distinct numbers', () => {
    // These were dropped here, so the copy derived both figures of "N requests, M refused" from
    // whatever number was nearest — rendering "0 requests, 0 refused" on the trigger whose headline
    // says the server refused us. Null stays null: not instrumented is not zero.
    const out = projectAuditForClient(
      row({ confidence: 'low', coverage_pct: '0', block_rate: '1', partial: true, discovered_count: 61, blocked_count: 47 }),
    );
    expect(out.crawlHealth).toMatchObject({ discovered: 61, blocked: 47 });
    const absent = projectAuditForClient(row({ confidence: 'low', coverage_pct: '0', block_rate: '1', partial: true }));
    expect(absent.crawlHealth).toMatchObject({ discovered: null, blocked: null });
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
  pageClass: 'readable', mainTextChars: 500, title: 'Fixture Title', excerpt: 'x', csrSignals: [], frameworkMarker: null,
  hasTitle: true, hasMetaDescription: true, h1Count: 1, headingLevelsSkipped: false, hasMainLandmark: true,
  jsonLd: { present: true, valid: true, types: ['Organization'], hasEntityType: true }, ...over,
});
// row().url is the RAW submission 'https://ex.com/'; the homepage PAGE url is CANONICAL 'https://ex.com'
// (no slash) at depth 0 — so homepageView must resolve via the depth-0 fallback, not an exact match.
const aiPages: AiSignalsPage[] = [
  { url: 'https://ex.com', title: 'Home', depth: 0, aiSignals: aiSignals({ excerpt: HOME_EXCERPT }) },
  { url: 'https://ex.com/deep', title: 'Deep', depth: 2, aiSignals: aiSignals({ pageClass: 'js_blind', mainTextChars: 5, title: 'Fixture Title', excerpt: NONHOME_EXCERPT }) },
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

/**
 * WORST-case signal pages: `n` of them, each carrying a FULL-LENGTH excerpt. Payload-size tests must be
 * built from this, never from the 2-row `aiPages` fixture — a fixture smaller than the cap cannot
 * exercise the cap, and that is exactly how a 4 MB payload passed a test named "bounds the serialized
 * payload". Half are js_blind so worst-first ordering has something to order.
 */
const bigSignalPages = (n: number): AiSignalsPage[] =>
  Array.from({ length: n }, (_, i) => ({
    url: `https://ex.com/p${String(i).padStart(5, '0')}`,
    title: `Page ${i}`,
    depth: i === 0 ? 0 : 2,
    aiSignals: aiSignals({
      pageClass: i % 2 === 0 ? 'js_blind' : 'readable',
      // WORST CASE ON EVERY STRING AXIS AT ONCE. Holding any one axis at a convenient value is how a
      // 100-row cap still serialised to 20.4 MB: the excerpt axis was maximal and the TITLE axis, the
      // one that actually dominated, was `Page ${i}`.
      title: 'X'.repeat(200_000),
      excerpt: 'w'.repeat(200_000),
      mainTextChars: 2000,
      jsonLd: { present: true, valid: true, types: Array.from({ length: 50 }, () => 'T'.repeat(5000)), hasEntityType: false },
    }),
  }));
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

// SPEC 05 §9 — the AI ledger delivered to the BROWSER is bounded. The assembler emits findings per page,
// so a 500-page free crawl yields thousands; unbounded, that is hundreds of KB over the SSE `done` event
// and into the DOM on the conversion-critical result page, for every viewer. Nothing is GATED by the cap
// (diagnosis stays free) — the list is severity-ordered and `totalFindings` reports the honest pre-cap
// count. These tests exist because a full revert of the cap previously survived the entire web suite.
describe('projectAuditForClient — SPEC 05 client ledger is bounded (§9)', () => {
  const aiFinding = (severity: 'high' | 'medium' | 'info', i: number): AiFinding => ({
    id: `f-${severity}-${i}`,
    kind: 'missing_structured_data',
    severity,
    targetUrl: `https://ex.com/p${i}`,
    targetTitle: `P${i}`,
    plainLanguage: `PLAIN_${severity}_${i}`,
    evidence: 'contested',
  });
  /**
   * A finding that CANNOT produce a packet: `retrieval_bot_blocked` is site-level and has no entry in
   * FINDING_TO_PACKET, and targetUrl is null. Needed so a cap-filling fixture does not accidentally
   * make every assertion about packet-buildability true by construction.
   */
  const nonPacketable = (i: number): AiFinding => ({
    id: `np-${i}`,
    kind: 'retrieval_bot_blocked',
    severity: 'high',
    targetUrl: null,
    targetTitle: null,
    plainLanguage: `NONPACKETABLE_${i}`,
    evidence: 'strong',
  });
  const withFindings = (findings: AiFinding[], over: Partial<AiReadinessScore> = {}) =>
    projectAuditForClient(row(), aiConv({ aiReadiness: { ...aiScore, findings, ...over } })).aiReadiness!;

  it('caps the delivered findings at AI_CLIENT_MAX_FINDINGS', () => {
    const out = withFindings(Array.from({ length: AI_CLIENT_MAX_FINDINGS + 250 }, (_, i) => aiFinding('info', i)));
    expect(out.score.findings.length).toBe(AI_CLIENT_MAX_FINDINGS);
  });

  it('reports the honest PRE-cap total, not the delivered length', () => {
    const total = AI_CLIENT_MAX_FINDINGS + 250;
    const out = withFindings(Array.from({ length: total }, (_, i) => aiFinding('info', i)));
    expect(out.totalFindings).toBe(total);
    expect(out.totalFindings).toBeGreaterThan(out.score.findings.length);
  });

  it('PREFERS the engine-stamped pre-cap count over the array length', () => {
    // The array is post-cap at the read (AI_PERSIST_MAX_FINDINGS bounds what was persisted), so the
    // `?? findings.length` fallback is a LAST resort, never the answer for a large site. Every other
    // fixture sets the two equal, which is why swapping to `allFindings.length` survived the suite:
    // this is the only case where the preference is observable.
    const out = withFindings(Array.from({ length: 500 }, (_, i) => aiFinding('info', i)), { totalFindings: 6002 });
    expect(out.totalFindings).toBe(6002);
    expect(out.totalFindings).not.toBe(500);
  });

  it('falls back to the array length only when the stamp is absent (pre-field rows)', () => {
    const out = withFindings(Array.from({ length: 7 }, (_, i) => aiFinding('info', i)));
    expect(out.totalFindings).toBe(7);
  });

  it('PROTOTYPE severity keys are treated as unknown, not resolved through the chain', () => {
    // `severity` is read back from the deliberately unvalidated `audits.ai_readiness` jsonb. A plain
    // index resolves `__proto__`/`constructor`/`toString` to an object or a function via the prototype
    // chain, so the comparator returns NaN — and a NaN comparator makes `sort` degrade to INPUT ORDER,
    // losing worst-first for every row and evicting real `high` findings at the cap. This guard existed
    // at ONE of four sibling sort sites; it now lives in a shared helper and is pinned at each of them.
    for (const evil of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      const findings = [
        ...Array.from({ length: AI_CLIENT_MAX_FINDINGS + 50 }, (_, i) => ({
          ...aiFinding('info', i),
          severity: evil as never,
        })),
        ...Array.from({ length: 5 }, (_, i) => aiFinding('high', i)),
      ];
      const out = withFindings(findings);
      expect(out.score.findings.filter((f) => f.severity === 'high').length, evil).toBe(5);
    }
  });

  it('keeps the HIGH-severity findings when it cannot deliver them all', () => {
    // Worst order on purpose: the highs are last, so an absent or reversed sort drops them.
    const findings = [
      ...Array.from({ length: AI_CLIENT_MAX_FINDINGS + 50 }, (_, i) => aiFinding('info', i)),
      ...Array.from({ length: 5 }, (_, i) => aiFinding('high', i)),
    ];
    const out = withFindings(findings);
    expect(out.score.findings.filter((f) => f.severity === 'high').length).toBe(5);
    expect(out.score.findings.length).toBe(AI_CLIENT_MAX_FINDINGS);
  });

  it('bounds the SERIALIZED payload at PRO_PAGE_CAP — every gated array, for the viewer who pays', () => {
    // Sized at the REAL worst case. The previous version held pageAiSignals at 2 rows, so the term that
    // actually dominated — whatAiSees, measured at 4.03 MB inside a 4.14 MB `event: done` — was
    // structurally absent from the fixture and the assertion passed for the wrong reason. A fixture
    // smaller than the cap cannot test the cap.
    const out = projectAuditForClient(
      row(),
      aiConv({
        aiReadiness: { ...aiScore, findings: Array.from({ length: 3000 }, (_, i) => aiFinding('info', i)) },
        pageAiSignals: bigSignalPages(PRO_PAGE_CAP),
      }),
    );
    const ai = out.aiReadiness!;
    expect(ai.whatAiSees).not.toBeNull(); // owner+Pro by default, so the gated arrays ARE populated here
    expect(ai.aiPackets).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(ai), 'utf8')).toBeLessThan(1_000_000);
    // …and pin each array separately, so no single one can quietly become the new dominant term while
    // the total still fits. Bounding the aggregate alone is how the previous four escapes happened.
    expect(Buffer.byteLength(JSON.stringify(ai.whatAiSees), 'utf8')).toBeLessThan(500_000);
    expect(Buffer.byteLength(JSON.stringify(ai.aiPackets), 'utf8')).toBeLessThan(300_000);
    expect(Buffer.byteLength(JSON.stringify(ai.score), 'utf8')).toBeLessThan(200_000);
  });

  it('leaves a small ledger untouched (the cap is a ceiling, never a rewrite)', () => {
    const out = withFindings(aiScore.findings);
    expect(out.score.findings).toEqual(aiScore.findings);
    expect(out.totalFindings).toBe(aiScore.findings.length);
  });

  it('counts packet-buildability from the FULL pre-cap ledger, so the Pro wall shape never shifts', () => {
    // The old fixture filled the cap with `missing_structured_data` + targetUrl — EVERY one packetable —
    // so `.toBe(true)` held whether buildability was counted pre-cap or post-cap, and BOTH mutations
    // (`= true`, and counting the bounded ledger) survived a green suite. The top-cap findings must be
    // NON-packetable for this assertion to mean anything.
    const buried = [
      ...Array.from({ length: AI_CLIENT_MAX_FINDINGS + 10 }, (_, i) => nonPacketable(i)),
      { ...aiScore.findings[0]!, severity: 'info' as const, id: 'buried-packetable' },
    ];
    const out = withFindings(buried);
    expect(out.score.findings.some((f) => f.id === 'buried-packetable')).toBe(false); // past the cap…
    expect(out.aiPackets).toEqual([]); // …so the DELIVERED packets are empty — post-cap counting sees nothing
    expect(out.hasMoreAiPackets).toBe(true); // …yet the wall still knows a packet exists. That is the property.
  });

  it('hasMoreAiPackets is FALSE when nothing in the ledger is packetable', () => {
    // Nothing anywhere asserted the false case, so a constant `true` was a surviving mutation — and the
    // live consequence is the Pro wall advertising "copy-paste AI fix packets" on a site that has none.
    const out = withFindings(Array.from({ length: 20 }, (_, i) => nonPacketable(i)));
    expect(out.hasMoreAiPackets).toBe(false);
    expect(out.aiPackets).toEqual([]);
  });

  it('hasMoreAiPackets is FALSE when a packetable KIND is present but has no targetUrl', () => {
    // Buildability needs kind AND a target; a kind-only check would call this true.
    const out = withFindings([{ ...aiFinding('high', 1), targetUrl: null, targetTitle: null }]);
    expect(out.hasMoreAiPackets).toBe(false);
  });
});

// ── SPEC 05 §9 — the gated "What AI Sees" simulator is bounded (B4) ──────────────────────────────
describe('projectAuditForClient — whatAiSees is bounded and worst-first', () => {
  const proj = (pages: AiSignalsPage[]) =>
    projectAuditForClient(row(), aiConv({ pageAiSignals: pages })).aiReadiness!;

  it('caps the rows at WHAT_AI_SEES_MAX_PAGES even at PRO_PAGE_CAP pages', () => {
    const out = proj(bigSignalPages(PRO_PAGE_CAP));
    expect(out.whatAiSees!.length).toBe(WHAT_AI_SEES_MAX_PAGES);
  });

  it('reports the honest PRE-cap page total, so the UI cannot imply the site is 100 pages', () => {
    const out = proj(bigSignalPages(PRO_PAGE_CAP));
    expect(out.whatAiSeesTotalPages).toBe(PRO_PAGE_CAP);
    expect(out.whatAiSeesTotalPages).toBeGreaterThan(out.whatAiSees!.length);
  });

  it('keeps the WORST pages, not the alphabetically-first ones', () => {
    // The js_blind pages sort LAST by url here, so a url-only ordering would drop every one of them —
    // discarding exactly the evidence the simulator is sold to show.
    const readable = Array.from({ length: 200 }, (_, i) => ({
      url: `https://ex.com/a${String(i).padStart(4, '0')}`,
      title: `R${i}`, depth: 1,
      aiSignals: aiSignals({ pageClass: 'readable' as const, excerpt: 'r' }),
    }));
    const blind = Array.from({ length: 10 }, (_, i) => ({
      url: `https://ex.com/z${String(i).padStart(4, '0')}`,
      title: `B${i}`, depth: 1,
      aiSignals: aiSignals({ pageClass: 'js_blind' as const, excerpt: 'b' }),
    }));
    const out = proj([...readable, ...blind]);
    expect(out.whatAiSees!.filter((p) => p.pageClass === 'js_blind')).toHaveLength(10);
    expect(out.whatAiSees!.slice(0, 10).every((p) => p.pageClass === 'js_blind')).toBe(true);
  });

  it('R1: the capped selection is deterministic across runs', () => {
    const pages = bigSignalPages(500);
    expect(JSON.stringify(proj(pages).whatAiSees)).toBe(JSON.stringify(proj(pages).whatAiSees));
  });

  it('whatAiSeesTotalPages is viewer-independent — reported even to a free viewer with no rows', () => {
    // It must never double as an entitlement signal: same number, gated array still null.
    const out = projectAuditForClient(
      row(),
      aiConv({ pageAiSignals: bigSignalPages(300), isOwner: false, entitlement: entitlementFor('free', null) }),
    ).aiReadiness!;
    expect(out.whatAiSees).toBeNull();
    expect(out.whatAiSeesTotalPages).toBe(300);
  });
});

// ── RULE: the SERIALIZED client payload carries no lone surrogate, at PRO_PAGE_CAP ───────────────
// Field-by-field assertions are how four unbounded/malformed fields shipped in sequence — each new
// field was a new place to forget. This walks whatever the projection actually emitted. Well-formed
// JSON.stringify escapes ONLY unpaired surrogates, so a \uD800–\uDFFF escape in the payload is exactly
// the malformed-UTF-16 condition, measured on the bytes the SSE `done` event puts on the wire.
describe('RULE: the serialized client payload is well-formed UTF-16', () => {
  const LONE = /\\u[dD][89abcdefABCDEF][0-9a-fA-F]{2}/;
  const wellFormed = (v: unknown) => !LONE.test(JSON.stringify(v) ?? '');
  const astral = (n: number) => `A${'\u{1F600}'.repeat(n)}`;

  it('the detector is honest — fires on a lone HIGH and a lone LOW half, not on real astral text', () => {
    expect(wellFormed({ excerpt: '\ud800' })).toBe(false);
    expect(wellFormed({ excerpt: '\udfff' })).toBe(false);
    expect(wellFormed({ excerpt: '\u{1F600} 中文 héllo' })).toBe(true);
  });

  it('a Pro owner at PRO_PAGE_CAP with astral text everywhere gets a clean payload', () => {
    const pages: AiSignalsPage[] = Array.from({ length: PRO_PAGE_CAP }, (_, i) => ({
      url: `https://ex.com/p${String(i).padStart(5, '0')}/${'\u{1F600}'.repeat(3)}`,
      title: astral(150),
      depth: i === 0 ? 0 : 2,
      aiSignals: aiSignals({
        pageClass: i % 2 === 0 ? 'js_blind' : 'readable',
        excerpt: astral(999),
        jsonLd: { present: true, valid: true, types: [astral(49)], hasEntityType: false },
      }),
    }));
    const findings: AiFinding[] = Array.from({ length: 600 }, (_, i) => ({
      ...aiFindingBase(i), targetTitle: astral(120), plainLanguage: astral(100),
      targetUrl: `https://ex.com/p${String(i).padStart(5, '0')}/${'\u{1F600}'.repeat(3)}`,
    }));
    const out = projectAuditForClient(row(), aiConv({ aiReadiness: { ...aiScore, findings }, pageAiSignals: pages }));
    const ai = out.aiReadiness!;
    expect(ai.whatAiSees).not.toBeNull(); // the gated arrays are populated — they must be covered
    expect(ai.aiPackets!.length).toBeGreaterThan(0); // …and NON-EMPTY: `not.toBeNull()` passes on []
    // The whole payload MINUS the packet bodies. Those are assembled by SPEC 02's sanitizers, whose
    // raw cut is held out of this branch as FU-7; packets are never persisted (D4) so they carry no
    // 22P02 path. Everything SPEC 05 persists or streams itself is covered.
    expect(wellFormed({ ...out, aiReadiness: { ...ai, aiPackets: null } })).toBe(true);
  });

  it('a FREE viewer payload is clean too (homepageView is the one crawled string they receive)', () => {
    const pages: AiSignalsPage[] = [
      { url: 'https://ex.com', title: astral(150), depth: 0, aiSignals: aiSignals({ excerpt: astral(999) }) },
    ];
    const out = projectAuditForClient(
      row(),
      aiConv({ pageAiSignals: pages, isOwner: false, entitlement: entitlementFor('free', null) }),
    );
    expect(out.aiReadiness!.homepageView).not.toBeNull();
    expect(wellFormed(out)).toBe(true);
  });
});
