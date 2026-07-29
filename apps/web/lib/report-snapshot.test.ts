import { describe, it, expect } from 'vitest';
import { buildReportSnapshot, REPORT_SNAPSHOT_VERSION, MAX_FINDINGS_PER_CATEGORY, MAX_AI_FINDINGS, MAX_AI_FINDING_BYTES, type SnapshotInput } from './report-snapshot';
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

const aiScore = (over: Partial<AiReadinessScore> = {}): AiReadinessScore => ({
  score: 62,
  band: 'partial',
  components: {
    access: { score: 0.8, weight: 25 },
    contentWithoutJs: { score: 0.55, weight: 40 },
    machineLegibility: { score: 0.6, weight: 20 },
    retrievalPath: { score: 0.7, weight: 15 },
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
  ...over,
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

  it('carries the diagnostic score when present, leaving every pre-existing byte untouched', () => {
    const s = buildReportSnapshot(baseInput({ aiReadiness: aiScore() }));
    const ai = aiScore();
    expect(s.aiReadiness!.score).toBe(ai.score);
    expect(s.aiReadiness!.band).toBe(ai.band);
    expect(s.aiReadiness!.components).toEqual(ai.components);
    expect(s.aiReadiness!.accessMatrix).toEqual(ai.accessMatrix);
    expect(s.aiReadiness!.llmsTxt).toEqual(ai.llmsTxt);
    expect(s.aiReadiness!.asOf).toBe(ai.asOf);
    expect(s.aiReadiness!.totalFindings).toBe(ai.findings.length);
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

// SPEC 05 §10 — the AI projection is BOUNDED and FIELD-WHITELISTED. `public_reports` rows are permanent
// and immutable, so anything frozen here is frozen forever; the assembler emits findings PER PAGE, so an
// uncapped copy would blow the "bounded jsonb" contract this file exists to enforce.
describe('buildReportSnapshot — SPEC 05 AI projection is bounded + whitelisted', () => {
  const manyFindings = (n: number, severity: 'high' | 'medium' | 'info' = 'info') =>
    Array.from({ length: n }, (_, i) => ({
      id: `id-${i}`,
      kind: 'missing_structured_data' as const,
      severity,
      targetUrl: `https://ex.com/page-${i}`,
      targetTitle: `TITLE_MUST_NOT_PERSIST_${i}`,
      plainLanguage: `PLAIN_${i}`,
      evidence: 'contested' as const,
    }));

  it('caps the frozen findings at MAX_AI_FINDINGS and records the honest PRE-cap total', () => {
    const s = buildReportSnapshot(baseInput({ aiReadiness: aiScore({ findings: manyFindings(500) }) }));
    expect(s.aiReadiness!.findings.length).toBe(MAX_AI_FINDINGS);
    expect(s.aiReadiness!.totalFindings).toBe(500);
  });

  it('keeps the HIGH-severity findings when it cannot keep them all', () => {
    const mixed = [...manyFindings(40, 'info'), ...manyFindings(3, 'high')];
    const s = buildReportSnapshot(baseInput({ aiReadiness: aiScore({ findings: mixed }) }));
    expect(s.aiReadiness!.findings.filter((f) => f.severity === 'high').length).toBe(3);
    expect(s.aiReadiness!.findings.length).toBe(MAX_AI_FINDINGS);
  });

  it('PROTOTYPE severity keys are treated as unknown, not resolved through the chain', () => {
    // Same unvalidated `audits.ai_readiness` jsonb the SSE projection reads, but this write is
    // PERMANENT and world-readable: a NaN comparator degrades `sort` to input order, the highs fall
    // outside the cap, and the mis-ordered snapshot can never be corrected in place (§5 immutability).
    for (const evil of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      const poisoned = manyFindings(40).map((f) => ({ ...f, severity: evil as never }));
      const mixed = [...poisoned, ...manyFindings(3, 'high')];
      const s = buildReportSnapshot(baseInput({ aiReadiness: aiScore({ findings: mixed }) }));
      expect(s.aiReadiness!.findings.filter((f) => f.severity === 'high').length, evil).toBe(3);
    }
  });

  it('DROPS the never-rendered fields (id, targetTitle) from the permanent artifact', () => {
    const s = buildReportSnapshot(baseInput({ aiReadiness: aiScore({ findings: manyFindings(3) }) }));
    const raw = JSON.stringify(s);
    expect(raw).not.toContain('TITLE_MUST_NOT_PERSIST');
    expect(raw).not.toContain('id-0');
    for (const f of s.aiReadiness!.findings) {
      expect(Object.keys(f).sort()).toEqual(['evidence', 'kind', 'plainLanguage', 'severity', 'targetUrl']);
    }
  });

  it('bounds the two variable-length strings a hostile site controls', () => {
    const huge = 'x'.repeat(50_000);
    const s = buildReportSnapshot(
      baseInput({
        aiReadiness: aiScore({
          findings: [{ id: 'a', kind: 'thin_page', severity: 'medium', targetUrl: `https://ex.com/${huge}`, targetTitle: null, plainLanguage: huge, evidence: 'moderate' }],
        }),
      }),
    );
    const f = s.aiReadiness!.findings[0]!;
    expect(Buffer.byteLength(f.plainLanguage, 'utf8')).toBeLessThanOrEqual(MAX_AI_FINDING_BYTES);
    expect(Buffer.byteLength(f.targetUrl!, 'utf8')).toBeLessThanOrEqual(MAX_AI_FINDING_BYTES);
  });

  it('never truncates through a surrogate pair — a lone surrogate makes the jsonb INSERT fail', () => {
    // Postgres rejects an unpaired surrogate ("invalid input syntax for type json"), so a naive slice
    // through an emoji would 500 the mint and leave that report permanently un-mintable.
    const emoji = 'a'.repeat(MAX_AI_FINDING_BYTES - 1) + '\u{1F600}' + 'b'.repeat(50);
    const s = buildReportSnapshot(
      baseInput({
        aiReadiness: aiScore({
          findings: [{ id: 'e', kind: 'thin_page', severity: 'medium', targetUrl: emoji, targetTitle: null, plainLanguage: emoji, evidence: 'moderate' }],
        }),
      }),
    );
    for (const field of [s.aiReadiness!.findings[0]!.plainLanguage, s.aiReadiness!.findings[0]!.targetUrl!]) {
      const last = field.charCodeAt(field.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      // round-trips as valid JSON (what the jsonb column requires)
      expect(() => JSON.parse(JSON.stringify({ field }))).not.toThrow();
    }
  });

  it('WHITELISTS: a rogue field on the incoming score never reaches the world-readable snapshot', () => {
    // Guards the real regression risk — `AiReadinessClient` already carries `homepageView` (an excerpt)
    // one type over. A future field must not ride into a permanent public artifact via a spread.
    const rogue = { ...aiScore(), homepageView: { excerpt: 'LEAKED_EXCERPT' }, aiPackets: [{ body: 'LEAKED_PACKET' }] };
    const raw = JSON.stringify(buildReportSnapshot(baseInput({ aiReadiness: rogue as never })));
    expect(raw).not.toContain('LEAKED_EXCERPT');
    expect(raw).not.toContain('LEAKED_PACKET');
    expect(raw).not.toContain('homepageView');
    expect(raw).not.toContain('aiPackets');
  });

  it('WHITELISTS at DEPTH — a rogue field nested inside a carried object is dropped too', () => {
    // The first version of this guard planted keys only at the top level, so a one-level-deep whitelist
    // looked complete while `components`/`basis`/`accessMatrix`/`llmsTxt` were copied by reference.
    const ai = aiScore();
    const rogue = {
      ...ai,
      accessMatrix: { ...ai.accessMatrix, secretNote: 'LEAKED_NESTED_MATRIX' },
      llmsTxt: { ...ai.llmsTxt, rawBody: 'LEAKED_NESTED_BODY' },
      basis: { ...ai.basis, internalDebug: 'LEAKED_NESTED_BASIS' },
    };
    const raw = JSON.stringify(buildReportSnapshot(baseInput({ aiReadiness: rogue as never })));
    expect(raw).not.toContain('LEAKED_NESTED_MATRIX');
    expect(raw).not.toContain('LEAKED_NESTED_BODY');
    expect(raw).not.toContain('LEAKED_NESTED_BASIS');
  });

  it('WHITELISTS inside components AND inside each accessMatrix bot entry', () => {
    // The gap the previous version left: the code comment claimed the rebuild-to-depth was "pinned by a
    // nested rogue-field test" and named `components`, but no test planted anything there — and nothing
    // reached INSIDE a bots[] entry either. Both `components: c` and `bots: m.bots ?? []` typechecked
    // identically and passed toEqual, so both survived a green suite. No leak existed at the time
    // because those shapes happened to be closed; this is a PERMANENT, world-readable, immutable
    // artifact, so "happens to be closed today" is not the property worth relying on.
    const ai = aiScore();
    const rogue = {
      ...ai,
      components: {
        ...ai.components,
        access: { ...ai.components.access, internalWeightNote: 'LEAKED_COMPONENT_FIELD' },
        rogueComponent: { score: 1, weight: 99 },
      },
      accessMatrix: {
        ...ai.accessMatrix,
        bots: (ai.accessMatrix.bots ?? []).map((b) => ({ ...b, internalRule: 'LEAKED_BOT_FIELD' })),
      },
    };
    const raw = JSON.stringify(buildReportSnapshot(baseInput({ aiReadiness: rogue as never })));
    expect(raw).not.toContain('LEAKED_COMPONENT_FIELD');
    expect(raw).not.toContain('rogueComponent');
    expect(raw).not.toContain('LEAKED_BOT_FIELD');
  });

  it('PREFERS the engine-stamped pre-cap count — the number is frozen FOREVER', () => {
    // `ai.findings` is post-cap at the read, so `all.length` is the wrong number for a large site, and
    // this artifact is immutable and world-readable: re-minting is impossible, so a wrong "…and N more"
    // can never be corrected. Swapping to `all.length` survived the whole suite before this case.
    const ai = { ...aiScore(), totalFindings: 6002 };
    const snap = buildReportSnapshot(baseInput({ aiReadiness: ai as never }));
    expect(snap.aiReadiness!.totalFindings).toBe(6002);
    expect(snap.aiReadiness!.totalFindings).not.toBe(ai.findings.length);
  });

  it('WHITELISTS every component individually, not just the first one', () => {
    // The previous version planted a rogue field in `components.access` ONLY, so copying any of the
    // other three by reference (`contentWithoutJs: c.contentWithoutJs`, etc.) survived a green suite.
    // Same one-level-whitelist class as the bug it was written to close, one level further down.
    const ai = aiScore();
    const rogue = {
      ...ai,
      components: {
        access: { ...ai.components.access, leak: 'LEAK_ACCESS' },
        contentWithoutJs: { ...ai.components.contentWithoutJs, leak: 'LEAK_CONTENT' },
        machineLegibility: { ...ai.components.machineLegibility, leak: 'LEAK_LEGIBILITY' },
        retrievalPath: { ...ai.components.retrievalPath, leak: 'LEAK_RETRIEVAL' },
      },
    };
    const raw = JSON.stringify(buildReportSnapshot(baseInput({ aiReadiness: rogue as never })));
    for (const marker of ['LEAK_ACCESS', 'LEAK_CONTENT', 'LEAK_LEGIBILITY', 'LEAK_RETRIEVAL']) {
      expect(raw, `${marker} must not reach a permanent public artifact`).not.toContain(marker);
    }
  });

  it('CLAMPS the llms.txt note as well as the bot notes and wafNote', () => {
    // The F6 fix pinned two of the three clamps; `llmsTxt.note` passed through raw under mutation.
    const ai = aiScore();
    const rogue = { ...ai, llmsTxt: { ...ai.llmsTxt, note: 'N'.repeat(MAX_AI_FINDING_BYTES * 3) } };
    const snap = buildReportSnapshot(baseInput({ aiReadiness: rogue as never }));
    expect(Buffer.byteLength(snap.aiReadiness!.llmsTxt.note, 'utf8')).toBeLessThanOrEqual(MAX_AI_FINDING_BYTES);
  });

  it('CLAMPS the per-bot note and the WAF note, not just the finding strings', () => {
    // Minor sibling F6: both clamps were unpinned, so a raw pass-through survived. The sources are
    // static registries today, which is exactly the assumption a future change would quietly break.
    const ai = aiScore();
    const long = 'N'.repeat(MAX_AI_FINDING_BYTES * 3);
    const rogue = {
      ...ai,
      accessMatrix: {
        ...ai.accessMatrix,
        bots: (ai.accessMatrix.bots ?? []).map((b) => ({ ...b, note: long })),
        wafNote: long,
      },
    };
    const snap = buildReportSnapshot(baseInput({ aiReadiness: rogue as never }));
    const m = snap.aiReadiness!.accessMatrix;
    expect(m.bots.length).toBeGreaterThan(0); // the fixture must actually HAVE bots, or this proves nothing
    m.bots.forEach((b) => expect(Buffer.byteLength(b.note, 'utf8')).toBeLessThanOrEqual(MAX_AI_FINDING_BYTES));
    expect(Buffer.byteLength(m.wafNote!, 'utf8')).toBeLessThanOrEqual(MAX_AI_FINDING_BYTES);
  });

  it('stays bounded at the true WORST CASE, not just on friendly fixtures', () => {
    // The earlier version fed short PLAIN_n / /page-n strings, so it passed for the wrong reason: the
    // real ceiling is MAX_AI_FINDINGS x (2 x MAX_AI_FINDING_BYTES) plus the bot registry. Feed
    // max-length strings so the assertion pins the bound it names.
    const long = 'x'.repeat(5_000);
    const worst = Array.from({ length: 2500 }, (_, i) => ({
      id: `id-${i}`,
      kind: 'missing_structured_data' as const,
      severity: 'info' as const,
      targetUrl: `https://ex.com/${long}`,
      targetTitle: long,
      plainLanguage: long,
      evidence: 'contested' as const,
    }));
    const s = buildReportSnapshot(baseInput({ aiReadiness: aiScore({ findings: worst }) }));
    const bytes = JSON.stringify(s.aiReadiness).length;
    // Comfortably inside Postgres/data-cache limits, and ~2 orders of magnitude below the 582 KB the
    // unbounded pass-through produced on a typical 500-page site.
    expect(bytes).toBeLessThan(35_000);
    // and the cap really is what bounds it
    expect(s.aiReadiness!.findings.length).toBe(MAX_AI_FINDINGS);
    expect(s.aiReadiness!.totalFindings).toBe(2500);
  });
});
