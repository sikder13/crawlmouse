import { describe, it, expect, vi } from 'vitest';

// SPEC 04 §4 — buildMintSnapshot reads the audit's persisted findings/fixes/pages and assembles the
// FREE report snapshot. It must NEVER fetch the gated cure columns (suggested_links /
// action_packet_body), so cure data can't reach the frozen artifact even by accident (§11 + SPEC 02).

const fetchAllMock = vi.fn();
vi.mock('@/lib/supabase/fetch-all', () => ({ fetchAll: (...a: unknown[]) => fetchAllMock(...a) }));

import { buildMintSnapshot, FIX_DIAGNOSIS_COLS } from './mint-snapshot';

const AUDIT = {
  grade: 'C',
  score: '63.66',
  cms_detected: 'wordpress',
  page_count: 42,
  confidence: 'high',
  coverage_pct: '0.98',
  confidence_band: { basis: { estimatedTotal: 43, method: 'sitemap', crawled: 42 } },
  projected_score: '76.09',
  projected_grade: 'B',
};

function primeReads(over: { findings?: unknown[]; fixes?: unknown[]; pages?: unknown[] } = {}) {
  fetchAllMock.mockReset();
  fetchAllMock.mockImplementation((_sb: unknown, table: string) => {
    if (table === 'findings') return Promise.resolve(over.findings ?? [{ category: 'orphan', severity: 'critical', pages: { url: 'https://ex.com/a' } }]);
    if (table === 'fixes') return Promise.resolve(over.fixes ?? [{ category: 'orphan', target_url: 'https://ex.com/a', target_title: 'A', marginal_delta: '5.1', effort: 'low', rationale: 'r' }]);
    if (table === 'pages') return Promise.resolve(over.pages ?? [{ is_orphan: true, depth: 0 }, { is_orphan: false, depth: 2 }]);
    return Promise.resolve([]);
  });
}

describe('buildMintSnapshot', () => {
  it('builds the FREE snapshot from the audit + reads (deterministic mintedAt injected)', async () => {
    primeReads();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = await buildMintSnapshot({} as any, 'aud-1', AUDIT, 'ex.com', '2026-07-07T12:00:00.000Z');
    expect(snap).not.toBeNull();
    expect(snap!.domain).toBe('ex.com');
    expect(snap!.grade).toBe('C');
    expect(snap!.score).toBe(63.66);
    expect(snap!.confidence).toBe('high');
    expect(snap!.estimatedTotal).toBe(43); // from confidence_band.basis
    expect(snap!.projected).toEqual({ grade: 'B', score: 76.09 });
    expect(snap!.orphanCount).toBe(1); // one orphan page in the reads
    expect(snap!.ledger[0]!.marginalDelta).toBe(5.1);
  });

  it('the fixes fetch column list EXCLUDES the gated cure columns', () => {
    expect(FIX_DIAGNOSIS_COLS).not.toContain('suggested_links');
    expect(FIX_DIAGNOSIS_COLS).not.toContain('action_packet_body');
    // …but carries the diagnosis fields the ledger needs.
    for (const c of ['category', 'target_url', 'target_title', 'marginal_delta', 'effort', 'rationale']) {
      expect(FIX_DIAGNOSIS_COLS).toContain(c);
    }
  });

  it('actually calls fixes with the gated-free column list (no cure data is even read)', async () => {
    primeReads();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await buildMintSnapshot({} as any, 'aud-1', AUDIT, 'ex.com', '2026-07-07T12:00:00.000Z');
    const fixesCall = fetchAllMock.mock.calls.find((c) => c[1] === 'fixes');
    expect(fixesCall).toBeDefined();
    expect(fixesCall![2]).toBe(FIX_DIAGNOSIS_COLS);
    expect(fixesCall![2]).not.toContain('suggested');
  });

  it('returns null for an ungradeable audit (v1 / no grade)', async () => {
    primeReads();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = await buildMintSnapshot({} as any, 'aud-1', { ...AUDIT, grade: null }, 'ex.com', '2026-07-07T12:00:00.000Z');
    expect(snap).toBeNull();
  });
});

// SPEC 05 §10 / amendment v1.3 — the mint reads `audits.ai_readiness` and threads it into the snapshot.
// The column shipped in the SPEC 05 migration applied to production 2026-07-08, so there is no
// deploy-order risk; the null path (v1 audit / kill-switch off / pre-migration mint) is the normal case.
describe('buildMintSnapshot — SPEC 05 ai_readiness threading', () => {
  const AI = {
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
    findings: [],
    accessMatrix: { bots: [], robotsTxtFound: true, wafDetected: false, wafNote: null },
    llmsTxt: { present: false, parseable: false, note: 'n' },
    asOf: '2026-07-01',
  };

  it('carries a present ai_readiness into the snapshot', async () => {
    primeReads();
    const s = await buildMintSnapshot({} as never, 'a1', { ...AUDIT, ai_readiness: AI }, 'ex.com', '2026-07-07T12:00:00.000Z');
    expect(s?.aiReadiness).toEqual(AI);
  });

  it('OMITS the key when ai_readiness is null (byte-identical to a pre-SPEC-05 mint)', async () => {
    primeReads();
    const withNull = await buildMintSnapshot({} as never, 'a1', { ...AUDIT, ai_readiness: null }, 'ex.com', '2026-07-07T12:00:00.000Z');
    primeReads();
    const withoutKey = await buildMintSnapshot({} as never, 'a1', AUDIT as never, 'ex.com', '2026-07-07T12:00:00.000Z');
    expect('aiReadiness' in (withNull as object)).toBe(false);
    expect('aiReadiness' in (withoutKey as object)).toBe(false);
    expect(JSON.stringify(withNull)).toBe(JSON.stringify(withoutKey));
  });

  it('never reads a per-page excerpt column — the report AI section is DIAGNOSTIC-ONLY', async () => {
    primeReads();
    await buildMintSnapshot({} as never, 'a1', { ...AUDIT, ai_readiness: AI }, 'ex.com', '2026-07-07T12:00:00.000Z');
    const pagesCall = fetchAllMock.mock.calls.find((c) => c[1] === 'pages');
    expect(pagesCall?.[2]).not.toContain('ai_signals');
  });
});
