import { describe, it, expect } from 'vitest';
import { buildPageRows, buildLinkRows, buildFindingRows, buildFixRows, boundAiReadinessForPersist } from './persist-helpers';
import type { AiFinding, AiReadinessScore } from '@crawlmouse/types';
import { AI_PERSIST_MAX_FINDINGS } from '@crawlmouse/types';
import type { FixDiagnosis, FixPrescription, PageAiSignals } from '@crawlmouse/types';

const PAGES = [
  { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 2, outDegree: 1, isOrphan: false },
  { url: 'https://x.com/a', urlHash: 'h1', title: null, statusCode: 200, depth: 1, inDegree: 1, outDegree: 0, isOrphan: false },
];

describe('buildPageRows', () => {
  it('maps a legacy (v1) page to a db row with the additive columns at their safe defaults', () => {
    // The v1 engine path never sets fetchOutcome/excludedFromGrade, so the row must carry
    // fetch_outcome: null + excluded_from_grade: false — exactly the new columns' defaults, so
    // the persisted shape is unchanged for the v1 path / prod until the ENGINE_V2 flip.
    const rows = buildPageRows('aud-1', PAGES);
    expect(rows[0]).toEqual({
      audit_id: 'aud-1', url: 'https://x.com/', url_hash: 'h0', title: 'Home',
      status_code: 200, depth: 0, in_degree: 2, out_degree: 1, is_orphan: false,
      fetch_outcome: null, excluded_from_grade: false, pagerank: null, ai_signals: null,
    });
  });

  it('maps a v2 blocked/excluded page to fetch_outcome + excluded_from_grade', () => {
    const rows = buildPageRows('aud-1', [
      { url: 'https://x.com/b', urlHash: 'h2', title: null, statusCode: 403, depth: null, inDegree: 0, outDegree: 0, isOrphan: false, fetchOutcome: 'blocked', excludedFromGrade: true },
    ]);
    expect(rows[0]).toEqual({
      audit_id: 'aud-1', url: 'https://x.com/b', url_hash: 'h2', title: null,
      status_code: 403, depth: null, in_degree: 0, out_degree: 0, is_orphan: false,
      fetch_outcome: 'blocked', excluded_from_grade: true, pagerank: null, ai_signals: null,
    });
  });

  it('maps a v2 page aiSignals to the ai_signals column; a v1 page (no aiSignals) → null (SPEC 05 §4)', () => {
    const sig: PageAiSignals = { pageClass: 'js_blind', mainTextChars: 0, excerpt: '', csrSignals: ['empty_mount:#root'], frameworkMarker: null, hasTitle: true, hasMetaDescription: false, h1Count: 0, headingLevelsSkipped: false, hasMainLandmark: false, jsonLd: { present: false, valid: false, types: [] } };
    const rows = buildPageRows('aud-1', [
      { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 2, outDegree: 1, isOrphan: false, aiSignals: sig },
      { url: 'https://x.com/v1', urlHash: 'h1', title: 'V1', statusCode: 200, depth: 1, inDegree: 1, outDegree: 0, isOrphan: false },
    ]);
    expect(rows[0]!.ai_signals).toEqual(sig);
    expect(rows[1]!.ai_signals).toBeNull();
  });

  it('maps a v2 gradeable page pagerank to the pagerank column', () => {
    const rows = buildPageRows('aud-1', [
      { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 2, outDegree: 1, isOrphan: false, fetchOutcome: 'ok', excludedFromGrade: false, pagerank: 0.42 },
    ]);
    expect(rows[0]!.pagerank).toBe(0.42);
  });

  it('maps a v2 ok/gradeable page to fetch_outcome: ok + excluded_from_grade: false', () => {
    const rows = buildPageRows('aud-1', [
      { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 2, outDegree: 1, isOrphan: false, fetchOutcome: 'ok', excludedFromGrade: false },
    ]);
    expect(rows[0]!.fetch_outcome).toBe('ok');
    expect(rows[0]!.excluded_from_grade).toBe(false);
  });
});

describe('buildLinkRows', () => {
  const map = new Map([['https://x.com/', 'p0'], ['https://x.com/a', 'p1']]);

  it('resolves both endpoints to page ids when present', () => {
    const rows = buildLinkRows('aud-1', [{ fromUrl: 'https://x.com/', toUrl: 'https://x.com/a', anchorText: 'A', isGenericAnchor: false }], map);
    expect(rows).toEqual([{ audit_id: 'aud-1', from_page_id: 'p0', to_page_id: 'p1', anchor_text: 'A', is_generic_anchor: false }]);
  });

  it('drops a link if either endpoint is missing from the page map', () => {
    // This is the exact corruption an incomplete (truncated) page map caused: links to
    // pages that fell out of the map were silently dropped. With a complete map, kept.
    const rows = buildLinkRows('aud-1', [
      { fromUrl: 'https://x.com/', toUrl: 'https://x.com/missing', anchorText: null, isGenericAnchor: false },
      { fromUrl: 'https://x.com/missing', toUrl: 'https://x.com/a', anchorText: null, isGenericAnchor: false },
    ], map);
    expect(rows).toEqual([]);
  });
});

describe('buildFindingRows', () => {
  const map = new Map([['https://x.com/a', 'p1']]);

  it('attaches page_id when the finding has a known page url', () => {
    const rows = buildFindingRows('aud-1', [{ category: 'orphan', severity: 'high', pageUrl: 'https://x.com/a', payload: { k: 1 } }], map);
    expect(rows[0]).toEqual({ audit_id: 'aud-1', category: 'orphan', severity: 'high', page_id: 'p1', payload: { k: 1 } });
  });

  it('sets page_id null for a site-level finding or an unmapped url', () => {
    const rows = buildFindingRows('aud-1', [
      { category: 'site', severity: 'low' },
      { category: 'x', severity: 'low', pageUrl: 'https://x.com/gone' },
    ], map);
    expect(rows.map((r) => r.page_id)).toEqual([null, null]);
    expect(rows[0]!.payload).toBeNull();
  });
});

describe('buildFixRows (SPEC 02 ledger + cures → fixes rows)', () => {
  const ledger: FixDiagnosis[] = [
    { id: 'orphan:https://x.com/o', category: 'orphan', targetUrl: 'https://x.com/o', targetTitle: 'O', marginalDelta: 5, effort: 'low', rationale: 'no inbound' },
    { id: 'deep_page:https://x.com/d', category: 'deep_page', targetUrl: 'https://x.com/d', targetTitle: null, marginalDelta: 2, effort: 'medium', rationale: 'too deep' },
  ];
  const prescriptions: FixPrescription[] = [
    {
      fixId: 'orphan:https://x.com/o',
      suggestedLinks: [{ fromUrl: 'https://x.com/h', fromTitle: 'H', anchorText: 'o page', relevanceScore: 0.8 }],
      actionPacket: { fixId: 'orphan:https://x.com/o', format: 'markdown', body: 'PACKET O', copyLabel: 'Copy AI prompt' },
    },
  ];

  it('joins each diagnosis to its prescription, ranks by ledger order, marks the free fix', () => {
    const rows = buildFixRows('aud-1', ledger, prescriptions, 'orphan:https://x.com/o');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      audit_id: 'aud-1', fix_id: 'orphan:https://x.com/o', category: 'orphan',
      target_url: 'https://x.com/o', target_title: 'O', marginal_delta: 5, effort: 'low',
      rationale: 'no inbound', rank: 1, is_free_fix: true,
      suggested_links: prescriptions[0]!.suggestedLinks, action_packet_body: 'PACKET O',
    });
    // the 2nd diagnosis has NO prescription → gated cure columns null, not the free fix
    expect(rows[1]!.rank).toBe(2);
    expect(rows[1]!.is_free_fix).toBe(false);
    expect(rows[1]!.suggested_links).toBeNull();
    expect(rows[1]!.action_packet_body).toBeNull();
  });

  it('returns [] for an empty ledger (v1 / no projection)', () => {
    expect(buildFixRows('aud-1', [], [], null)).toEqual([]);
  });
});

// ── SPEC 05 — the AI-readiness ledger is bounded AT THE WRITE (C3) ───────────────────────────────
// The source of truth, and the one every downstream cap was silently relying on. The mint snapshot
// (25), the client ledger (100), the packets and the simulator each had a cap while the row they all
// read from had none: measured 6002 findings / 1.90 MB at PRO_PAGE_CAP, 31.54 MB with long titles.
describe('boundAiReadinessForPersist (SPEC 05 C3)', () => {
  const finding = (i: number, over: Partial<AiFinding> = {}): AiFinding => ({
    id: `f${i}`,
    kind: 'missing_structured_data',
    severity: 'info',
    targetUrl: `https://ex.com/p${i}`,
    targetTitle: `Title ${i}`,
    plainLanguage: `PLAIN_${i}`,
    evidence: 'contested',
    ...over,
  });
  const score = (findings: AiFinding[]): AiReadinessScore => ({
    score: 55,
    band: 'partial',
    components: {
      access: { score: 1, weight: 25 }, contentWithoutJs: { score: 0.5, weight: 40 },
      machineLegibility: { score: 0.6, weight: 20 }, retrievalPath: { score: 0.5, weight: 15 },
    },
    confidence: 'high',
    isEstimate: false,
    basis: { pagesAnalyzed: 2000, siteJsRendered: false, retrievalPathBasis: 'full' },
    findings,
    totalFindings: findings.length,
    accessMatrix: { bots: [], robotsTxtFound: true, wafDetected: false, wafNote: null },
    llmsTxt: { present: false, parseable: false, note: 'n/a' },
    asOf: '2026-07-01',
  });

  it('caps the persisted findings at AI_PERSIST_MAX_FINDINGS', () => {
    const out = boundAiReadinessForPersist(score(Array.from({ length: 6002 }, (_, i) => finding(i))));
    expect(out.findings.length).toBe(AI_PERSIST_MAX_FINDINGS);
  });

  it('keeps the honest PRE-cap total, so "showing N of M" never reports the cap', () => {
    const out = boundAiReadinessForPersist(score(Array.from({ length: 6002 }, (_, i) => finding(i))));
    expect(out.totalFindings).toBe(6002);
    expect(out.totalFindings).toBeGreaterThan(out.findings.length);
  });

  it('bounds the SERIALIZED jsonb at the measured worst case (6002 findings, 5000-char titles)', () => {
    // Bytes-in-the-insert-body is the property that matters; a count cap alone would still let an
    // attacker-chosen title length blow the row up. Unbounded this measured 31.54 MB.
    const out = boundAiReadinessForPersist(
      score(Array.from({ length: 6002 }, (_, i) => finding(i, { targetTitle: 'X'.repeat(5000) }))),
    );
    expect(JSON.stringify(out).length).toBeLessThan(3_000_000);
  });

  it('leaves a small ledger byte-identical (the cap is a ceiling, never a rewrite)', () => {
    const s = score(Array.from({ length: 10 }, (_, i) => finding(i)));
    expect(boundAiReadinessForPersist(s).findings).toEqual(s.findings);
  });

  it('keeps HIGH severity when it cannot keep everything', () => {
    const findings = [
      ...Array.from({ length: AI_PERSIST_MAX_FINDINGS + 200 }, (_, i) => finding(i)),
      ...Array.from({ length: 5 }, (_, i) => finding(9000 + i, { severity: 'high', id: `hi${i}` })),
    ];
    const out = boundAiReadinessForPersist(score(findings));
    expect(out.findings.filter((f) => f.severity === 'high')).toHaveLength(5);
  });

  it('PRESERVES the Pro wall shape: one finding of every (kind, targeted) class survives the cut', () => {
    // This is the property the cap exists to not break. Packet-buildability depends only on kind +
    // whether the finding targets a page, so if a class is dropped entirely, hasMoreAiPackets can flip
    // to false and the wall stops advertising packets that genuinely exist. A plain severity cut fails
    // this: the 600 `high` site-level findings would evict every `info` packetable one.
    const findings = [
      ...Array.from({ length: 600 }, (_, i) =>
        finding(i, { kind: 'retrieval_bot_blocked', severity: 'high', targetUrl: null, targetTitle: null })),
      finding(9999, { kind: 'server_render', severity: 'info', id: 'the-only-packetable' }),
    ];
    const out = boundAiReadinessForPersist(score(findings));
    expect(out.findings.some((f) => f.id === 'the-only-packetable')).toBe(true);
    const classes = (fs: AiFinding[]) => new Set(fs.map((f) => `${f.kind}|${f.targetUrl == null}`));
    expect(classes(out.findings)).toEqual(classes(findings));
  });

  it('R1: deterministic — same input, byte-identical output', () => {
    const s = score(Array.from({ length: 2000 }, (_, i) => finding(i, { severity: i % 3 === 0 ? 'high' : 'info' })));
    expect(JSON.stringify(boundAiReadinessForPersist(s))).toBe(JSON.stringify(boundAiReadinessForPersist(s)));
  });

  it('preserves the assembler ORDER — the cap changes which findings survive, never their order', () => {
    // The HIGHs sit LATE in the array on purpose. With an alternating-severity fixture the survivors
    // come out index-ascending anyway, so a reserved-then-rest emission passed this test for the wrong
    // reason. Here the severity-selected survivors are indices 400..699, which appear in ascending
    // order only if the output is genuinely re-emitted in assembler order.
    const findings = [
      ...Array.from({ length: 400 }, (_, i) => finding(i, { severity: 'info' })),
      ...Array.from({ length: 300 }, (_, i) => finding(400 + i, { severity: 'high' })),
    ];
    const out = boundAiReadinessForPersist(score(findings));
    expect(out.findings.length).toBe(AI_PERSIST_MAX_FINDINGS);
    const idx = out.findings.map((f) => findings.findIndex((o) => o.id === f.id));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(idx[0]).toBe(0); // the reserved class representative stays in place, never hoisted to front
  });

  it('falls back to the array length when totalFindings is absent (rows predating the field)', () => {
    const s = score(Array.from({ length: 700 }, (_, i) => finding(i)));
    delete (s as { totalFindings?: number }).totalFindings;
    expect(boundAiReadinessForPersist(s).totalFindings).toBe(700);
  });
});
