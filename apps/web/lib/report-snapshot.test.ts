import { describe, it, expect } from 'vitest';
import { buildReportSnapshot, REPORT_SNAPSHOT_VERSION, MAX_FINDINGS_PER_CATEGORY, type SnapshotInput } from './report-snapshot';
import type { FixDbRow } from './conversion-from-fixes';

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
