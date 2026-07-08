import { describe, it, expect } from 'vitest';
import { reportRobotsIndex, isReportGone, isReportClaimed } from './report-visibility';
import type { PublicReportRow } from './reports';

// SPEC 04 §3/§8 (V5, V13-partial) + deploy-order safety. Robots + 404 gating derived from the report
// row's visibility columns. Pre-migration (columns undefined) preserves today's indexed behavior;
// post-migration, only CLAIMED + indexable reports are indexed (unclaimed default = noindex), and a
// hidden/taken-down report is GONE (404).

const row = (over: Partial<PublicReportRow> = {}): PublicReportRow => ({
  domain: 'ex.com',
  grade: 'C',
  score: '63',
  cms_detected: 'custom',
  orphan_count: 1,
  avg_depth: 2,
  takedown_requested_at: null,
  created_at: 't',
  ...over,
});

describe('reportRobotsIndex', () => {
  it('unclaimed report (indexable=false) is NOINDEX (the guardrail default)', () => {
    expect(reportRobotsIndex(row({ indexable: false, claimed_at: null }))).toBe(false);
  });

  it('claimed + indexable report is INDEXED', () => {
    expect(reportRobotsIndex(row({ indexable: true, claimed_at: 't' }))).toBe(true);
  });

  it('a claimed report whose owner opted OUT (indexable=false) is noindex', () => {
    expect(reportRobotsIndex(row({ indexable: false, claimed_at: 't' }))).toBe(false);
  });

  it('deploy-order: pre-migration (indexable undefined) preserves today’s indexed behavior', () => {
    expect(reportRobotsIndex(row({ indexable: undefined }))).toBe(true);
  });

  it('never indexes a hidden or taken-down report', () => {
    expect(reportRobotsIndex(row({ indexable: true, claimed_at: 't', hidden_at: 't' }))).toBe(false);
    expect(reportRobotsIndex(row({ indexable: true, claimed_at: 't', takedown_requested_at: 't' }))).toBe(false);
  });
});

describe('isReportGone (404 gate)', () => {
  it('is true for a hidden or taken-down report, or a missing grade', () => {
    expect(isReportGone(row({ hidden_at: 't' }))).toBe(true);
    expect(isReportGone(row({ takedown_requested_at: 't' }))).toBe(true);
    expect(isReportGone(row({ grade: null }))).toBe(true);
    expect(isReportGone(null)).toBe(true);
  });
  it('is false for a live report (pre-migration hidden_at undefined = not hidden)', () => {
    expect(isReportGone(row({ hidden_at: undefined }))).toBe(false);
    expect(isReportGone(row())).toBe(false);
  });
});

describe('isReportClaimed', () => {
  it('is true when claimed_at is set; false when null; pre-migration (undefined) treated as claimed (legacy verified)', () => {
    expect(isReportClaimed(row({ claimed_at: 't' }))).toBe(true);
    expect(isReportClaimed(row({ claimed_at: null }))).toBe(false);
    expect(isReportClaimed(row({ claimed_at: undefined }))).toBe(true); // legacy rows were all verified
  });
});
