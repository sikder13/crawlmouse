import { describe, it, expect } from 'vitest';
import { buildReportSnapshot, REPORT_SNAPSHOT_VERSION, MAX_FINDINGS_PER_CATEGORY, type SnapshotInput } from './report-snapshot';
import type { FixDbRow } from './conversion-from-fixes';
import type { AiReadinessScore } from '@crawlmouse/types';

// SPEC 04 §4 (V7) — the mint-time report snapshot is the FROZEN, FREE, deterministic artifact the
// public report renders forever (it outlives the audit's 30-day TTL). Contracts:
//   - deterministic: same audit → byte-identical snapshot (no clock/random inside);
//   - FREE only: the ledger is DIAGNOSIS-ONLY (never suggestedLinks / actionPacket / monitoring);
//   - bounded: findings capped per category so the jsonb stays small;
//   - the ledger is sorted by marginalDelta desc and NEVER summed (each delta stands alone).

const fix = (over: Partial<FixDbRow> = {}): FixDbRow => ({
  fix_id: 'f1',
  category: 'orphan',
  target_url: 'https://ex.com/lost',
  target_title: 'Lost page',
  marginal_delta: 3.5,
  effort: 'low',
  rationale: 'Add internal links from related hubs.',
  rank: 1,
  is_free_fix: true,
  // GATED prescription fields — must NEVER appear in the snapshot:
  suggested_links: [{ fromUrl: 'https://ex.com/hub', anchor: 'lost page' }],
  action_packet_body: '## Do this\n- link A → B',
  ...over,
});

const baseInput = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  domain: 'ex.com',
  grade: 'C',
  score: 63.66,
  cms: 'wordpress',
  mintedAt: '2026-07-07T12:00:00.000Z',
  pageCount: 42,
  orphanCount: 5,
  avgDepth: 2.4,
  confidence: 'high',
  coveragePct: 0.98,
  estimatedTotal: 43,
  projectedScore: 76.09,
  projectedGrade: 'B',
  findings: [
    { category: 'orphan', severity: 'critical', pageUrl: 'https://ex.com/a' },
    { category: 'orphan', severity: 'critical', pageUrl: 'https://ex.com/b' },
    { category: 'deep_page', severity: 'medium', pageUrl: 'https://ex.com/deep', payload: { depth: 5 } },
    { category: 'js_rendered', severity: 'medium' },
  ],
  fixes: [fix({ fix_id: 'f1', marginal_delta: 3.5, rank: 1 }), fix({ fix_id: 'f2', marginal_delta: 5.1, rank: 2, is_free_fix: false })],
  ...over,
});

describe('buildReportSnapshot', () => {
  it('is deterministic — the same input yields a byte-identical snapshot', () => {
    const a = JSON.stringify(buildReportSnapshot(baseInput()));
    const b = JSON.stringify(buildReportSnapshot(baseInput()));
    expect(a).toBe(b);
  });

  it('stamps the version and carries the exec-summary scalars', () => {
    const s = buildReportSnapshot(baseInput());
    expect(s.version).toBe(REPORT_SNAPSHOT_VERSION);
    expect(s.grade).toBe('C');
    expect(s.score).toBe(63.66);
    expect(s.domain).toBe('ex.com');
    expect(s.mintedAt).toBe('2026-07-07T12:00:00.000Z');
    expect(s.confidence).toBe('high');
    expect(s.projected).toEqual({ grade: 'B', score: 76.09 });
  });

  it('NEVER serializes gated cure data (no suggestedLinks / actionPacket / packet body)', () => {
    const raw = JSON.stringify(buildReportSnapshot(baseInput()));
    expect(raw).not.toContain('suggested');
    expect(raw).not.toContain('actionPacket');
    expect(raw).not.toContain('Do this'); // the packet body
    expect(raw).not.toContain('link A');
  });

  it('ledger is diagnosis-only, sorted by marginalDelta desc, and carries the disclaimer (never summed)', () => {
    const s = buildReportSnapshot(baseInput());
    expect(s.ledger.map((l) => l.marginalDelta)).toEqual([5.1, 3.5]); // desc, not summed
    for (const item of s.ledger) {
      expect(Object.keys(item).sort()).toEqual(['category', 'effort', 'marginalDelta', 'rationale', 'targetTitle', 'targetUrl']);
    }
    expect(s.ledgerDisclaimer.length).toBeGreaterThan(0);
  });

  it('caps findings per category (bounded jsonb)', () => {
    const many = Array.from({ length: MAX_FINDINGS_PER_CATEGORY + 5 }, (_, i) => ({
      category: 'orphan' as const,
      severity: 'critical' as const,
      pageUrl: `https://ex.com/o${i}`,
    }));
    const s = buildReportSnapshot(baseInput({ findings: many }));
    expect(s.findings.filter((f) => f.category === 'orphan').length).toBe(MAX_FINDINGS_PER_CATEGORY);
  });

  it('strips finding payloads (lean wire; a needed datum becomes a typed field, never the Record)', () => {
    const s = buildReportSnapshot(baseInput());
    const deep = s.findings.find((f) => f.category === 'deep_page');
    expect(deep).toBeDefined();
    expect('payload' in (deep as object)).toBe(false);
  });

  it('handles a v1 / no-projection audit (null projected, empty ledger) without crashing', () => {
    const s = buildReportSnapshot(baseInput({ projectedScore: null, projectedGrade: null, fixes: [] }));
    expect(s.projected).toBeNull();
    expect(s.ledger).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// SPEC 05 §10 / amendment v1.3 — the additive, diagnostic-only AI-readiness field.
//
// The load-bearing contract is OMIT-WHEN-NULL: when an audit has no AI-readiness data the key is
// absent from the snapshot object entirely (never an explicit `null`), so a no-AI mint stays
// BYTE-IDENTICAL to pre-SPEC-05 output and SPEC 04's V7 determinism pin above holds unchanged.
// PRE_SPEC05_JSON below is the literal serialization captured from the builder BEFORE this field
// existed — it is the actual pre-SPEC-05 artifact, not a re-derivation of the current builder.
// ---------------------------------------------------------------------------------------------

const PRE_SPEC05_JSON =
  '{"version":1,"domain":"ex.com","grade":"C","score":63.66,"cms":"wordpress","mintedAt":"2026-07-07T12:00:00.000Z","pageCount":42,"orphanCount":5,"avgDepth":2.4,"confidence":"high","coveragePct":0.98,"estimatedTotal":43,"findings":[{"category":"orphan","severity":"critical","pageUrl":"https://ex.com/a"},{"category":"orphan","severity":"critical","pageUrl":"https://ex.com/b"},{"category":"deep_page","severity":"medium","pageUrl":"https://ex.com/deep"},{"category":"js_rendered","severity":"medium"}],"ledger":[{"category":"orphan","targetUrl":"https://ex.com/lost","targetTitle":"Lost page","marginalDelta":5.1,"effort":"low","rationale":"Add internal links from related hubs."},{"category":"orphan","targetUrl":"https://ex.com/lost","targetTitle":"Lost page","marginalDelta":3.5,"effort":"low","rationale":"Add internal links from related hubs."}],"ledgerDisclaimer":"Each impact is an individual estimate of that one fix’s effect on the grade — they are not additive and do not sum to a total.","projected":{"grade":"B","score":76.09}}';

const aiScore = (): AiReadinessScore => ({
  score: 62,
  band: 'partial',
  components: {
    access: { score: 80, weight: 25 },
    contentWithoutJs: { score: 55, weight: 40 },
    machineLegibility: { score: 60, weight: 20 },
    retrievalPath: { score: 70, weight: 15 },
  },
  confidence: 'high',
  isEstimate: false,
  basis: { pagesAnalyzed: 42, siteJsRendered: false, retrievalPathBasis: 'full' },
  findings: [
    { id: 'a1', kind: 'js_blind_page', severity: 'high', targetUrl: 'https://ex.com/x', targetTitle: 'X', plainLanguage: 'An AI assistant reading this page sees an empty shell.', evidence: 'strong' },
  ],
  accessMatrix: { bots: [{ token: 'OAI-SearchBot', operator: 'OpenAI', botClass: 'retrieval', allowedPageRatio: 1, fullyBlocked: false, note: 'Allowed everywhere.' }], robotsTxtFound: true, wafDetected: false, wafNote: null },
  llmsTxt: { present: false, parseable: false, note: 'Not consumed by AI search engines as of 2026.' },
  asOf: '2026-07-01',
});

describe('buildReportSnapshot — SPEC 05 aiReadiness (§10 / amendment v1.3)', () => {
  it('OMITS the key entirely when there is no AI data — byte-identical to pre-SPEC-05 output (V7 holds)', () => {
    const noField = buildReportSnapshot(baseInput());
    const explicitNull = buildReportSnapshot(baseInput({ aiReadiness: null }));
    const explicitUndefined = buildReportSnapshot(baseInput({ aiReadiness: undefined }));

    // The key must not exist — not merely be null/undefined. `in` is the strict presence check.
    expect('aiReadiness' in noField).toBe(false);
    expect('aiReadiness' in explicitNull).toBe(false);
    expect('aiReadiness' in explicitUndefined).toBe(false);

    // Byte-identity against the ACTUAL pre-SPEC-05 serialization.
    expect(JSON.stringify(noField)).toBe(PRE_SPEC05_JSON);
    expect(JSON.stringify(explicitNull)).toBe(PRE_SPEC05_JSON);
    expect(JSON.stringify(explicitUndefined)).toBe(PRE_SPEC05_JSON);
  });

  it('does NOT bump the snapshot version when the AI field is present (amendment v1.3 §2)', () => {
    const s = buildReportSnapshot(baseInput({ aiReadiness: aiScore() }));
    expect(s.version).toBe(1);
    expect(REPORT_SNAPSHOT_VERSION).toBe(1);
  });

  it('carries the score verbatim when present, leaving every pre-existing byte untouched', () => {
    const s = buildReportSnapshot(baseInput({ aiReadiness: aiScore() }));
    expect(s.aiReadiness).toEqual(aiScore());
    // The AI field is appended LAST, so the pre-SPEC-05 prefix is preserved byte-for-byte.
    const raw = JSON.stringify(s);
    expect(raw.startsWith(PRE_SPEC05_JSON.slice(0, -1))).toBe(true);
  });

  it('stays deterministic with the AI field present (same input → byte-identical)', () => {
    expect(JSON.stringify(buildReportSnapshot(baseInput({ aiReadiness: aiScore() }))))
      .toBe(JSON.stringify(buildReportSnapshot(baseInput({ aiReadiness: aiScore() }))));
  });

  it('is DIAGNOSTIC-ONLY — no packet body, no simulator excerpt, no cure content rides along', () => {
    const raw = JSON.stringify(buildReportSnapshot(baseInput({ aiReadiness: aiScore() })));
    expect(raw).not.toContain('excerpt');
    expect(raw).not.toContain('whatAiSees');
    expect(raw).not.toContain('aiPackets');
    expect(raw).not.toContain('actionPacket');
    expect(raw).not.toContain('suggested');
  });
});
