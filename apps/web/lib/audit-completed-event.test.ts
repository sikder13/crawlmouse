import { describe, it, expect } from 'vitest';
import { auditCompletedProps } from './audit-completed-event';

// SPEC 01 §10 / Option A: enrich the EXISTING `audit-completed` funnel event with per-audit
// crawl-health props WHEN PRESENT (v2). The pure helper is the unit-testable seam AuditView uses,
// so the enrichment is provable without a React render. The v1 contract is the load-bearing one:
// with no crawl-health, the props must be byte-identical to today's call site (zero new emits).
describe('auditCompletedProps (§10 PostHog enrichment — crawl-health on audit-completed, v2-gated)', () => {
  it('on a v1 audit (no crawl-health) emits EXACTLY today’s props — zero new emits on the v1 path', () => {
    expect(auditCompletedProps({ status: 'completed', grade: 'A', score: 92 })).toEqual({
      status: 'completed',
      grade: 'A',
      score: 92,
    });
  });

  it('coerces a missing grade/score to null (unchanged from today’s call site)', () => {
    expect(auditCompletedProps({ status: 'failed' })).toEqual({ status: 'failed', grade: null, score: null });
  });

  it('enriches with crawl-health props (confidence / coveragePct / blockRate / partial) when present (v2)', () => {
    expect(
      auditCompletedProps({
        status: 'completed',
        grade: 'B',
        score: 76,
        crawlHealth: { confidence: 'high', coveragePct: 0.95, blockRate: 0.02, partial: false },
      }),
    ).toEqual({
      status: 'completed',
      grade: 'B',
      score: 76,
      confidence: 'high',
      coveragePct: 0.95,
      blockRate: 0.02,
      partial: false,
    });
  });

  it('adds NO crawl-health keys when crawlHealth is null (a v1 row projected to null)', () => {
    const props = auditCompletedProps({ status: 'completed', grade: 'A', score: 90, crawlHealth: null });
    expect('confidence' in props).toBe(false);
    expect('partial' in props).toBe(false);
    expect('coveragePct' in props).toBe(false);
    expect('blockRate' in props).toBe(false);
  });
});
