import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reportRobotsIndex,
  isReportGone,
  isReportGoneEitherKind,
  isReportClaimed,
} from './report-visibility';
import type { PublicReportRow } from './reports';
import { fixture } from './v2/fixtures';
import { buildPublicSnapshot } from './v2/reports/build-snapshot';
import { FIRST_AUDIT } from './v2/view/segment/test-helpers';

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
    expect(reportRobotsIndex(row({ indexable: true, claimed_at: 't', hidden_at: 't' }))).toBe(
      false,
    );
    expect(
      reportRobotsIndex(row({ indexable: true, claimed_at: 't', takedown_requested_at: 't' })),
    ).toBe(false);
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

describe('isReportGoneEitherKind — a v2 report (CC-29)', () => {
  const v2 = {
    domain: 'example-outfitter.com',
    grade: null,
    score: null,
    cms_detected: null,
    orphan_count: null,
    avg_depth: null,
    takedown_requested_at: null,
    created_at: '2026-11-12T00:00:00Z',
    hidden_at: null,
    report_snapshot: buildPublicSnapshot(
      fixture('bad-site'),
      FIRST_AUDIT['bad-site'],
      '2026-11-12T18:00:00.000Z',
    ) as unknown as PublicReportRow['report_snapshot'],
  } satisfies PublicReportRow;
  afterEach(() => vi.unstubAllEnvs());

  it('is gone for v1’s reading (isReportGone) whatever the flag, as a row with no grade', () => {
    for (const flag of ['', '1']) {
      vi.stubEnv('V2_CHECKS_PUBLIC', flag);
      expect(isReportGone(v2)).toBe(true);
    }
  });

  it('is gone with V2_CHECKS_PUBLIC off', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect(isReportGoneEitherKind(v2)).toBe(true);
  });

  it('is live with the flag on, although its grade column is null', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(isReportGoneEitherKind(v2)).toBe(false);
  });

  it('is gone when hidden or taken down, flag on', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(isReportGoneEitherKind({ ...v2, hidden_at: '2026-11-12T19:00:00Z' })).toBe(true);
    expect(isReportGoneEitherKind({ ...v2, takedown_requested_at: '2026-11-12T19:00:00Z' })).toBe(
      true,
    );
  });

  it('a v1 row with no grade stays gone with the flag on', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(isReportGoneEitherKind({ ...v2, report_snapshot: null })).toBe(true);
  });

  it('reads a row without a v2 snapshot exactly as isReportGone does, flag on or off', () => {
    const v1 = { ...v2, report_snapshot: null, grade: 'B' };
    const rows = [
      v1,
      { ...v1, grade: null },
      { ...v1, hidden_at: '2026-11-12T19:00:00Z' },
      { ...v1, takedown_requested_at: '2026-11-12T19:00:00Z' },
      null,
    ];
    for (const flag of ['', '1']) {
      vi.stubEnv('V2_CHECKS_PUBLIC', flag);
      for (const r of rows) expect(isReportGoneEitherKind(r)).toBe(isReportGone(r));
    }
    expect(isReportGoneEitherKind(v1)).toBe(false);
  });
});
