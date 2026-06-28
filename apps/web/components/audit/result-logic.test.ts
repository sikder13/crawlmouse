import { describe, it, expect } from 'vitest';
import type { ConfidenceBand, FixDiagnosis, FreeFix, ProjectedGrade } from '@crawlmouse/types';
import {
  actionPacketClipboardText,
  estimateBasisText,
  gaugeDashoffset,
  gaugeTier,
  gradeGap,
  informationalFindings,
  lockedCureCount,
  relativeImpactLabel,
  severityLabel,
  sortedLedger,
} from './result-logic';
import { estimateFixture, freeFixture } from './__fixtures__/client-audit-v2';

const dx = (id: string, marginalDelta: number): FixDiagnosis => ({
  id,
  category: 'orphan',
  targetUrl: `https://x.example/${id}`,
  targetTitle: id,
  marginalDelta,
  effort: 'low',
  rationale: 'r',
});

describe('result-logic', () => {
  it('sortedLedger orders by marginalDelta desc without mutating', () => {
    const input = [dx('a', 2), dx('b', 9), dx('c', 5)];
    expect(sortedLedger(input).map((d) => d.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((d) => d.id)).toEqual(['a', 'b', 'c']); // input untouched
  });

  it('relativeImpactLabel is a rounded relative gain (never a sum)', () => {
    expect(relativeImpactLabel(8.4)).toBe('+8 pts');
    expect(relativeImpactLabel(1.6)).toBe('+2 pts');
  });

  it('gradeGap exposes current, projected, and a non-negative score gain', () => {
    const pg = freeFixture.projectedGrade as ProjectedGrade;
    const gap = gradeGap(pg);
    expect(gap.current.grade).toBe('C');
    expect(gap.projected.grade).toBe('B+');
    expect(gap.scoreGain).toBe(pg.projected.score - pg.current.score);
  });

  it('severityLabel maps medium→Warning, minor→Info', () => {
    expect(severityLabel('critical')).toBe('Critical');
    expect(severityLabel('medium')).toBe('Warning');
    expect(severityLabel('minor')).toBe('Info');
  });

  it('informationalFindings keeps only the site-wide caveats', () => {
    expect(
      informationalFindings(freeFixture.findings)
        .map((f) => f.category)
        .sort(),
    ).toEqual(['incomplete_crawl', 'js_rendered']);
  });

  it('lockedCureCount = ledger minus the free fix when more cures exist', () => {
    const total = (freeFixture.projectedGrade as ProjectedGrade).ledger.length;
    expect(lockedCureCount(freeFixture)).toBe(total - 1);
  });

  it('estimateBasisText reads "N of ~M pages"', () => {
    expect(estimateBasisText(estimateFixture.confidenceBand as ConfidenceBand)).toBe(
      'based on 70 of ~500 pages',
    );
  });

  it('actionPacketClipboardText returns the exact packet body', () => {
    const body = (freeFixture.freeFix as FreeFix).prescription.actionPacket.body;
    expect(actionPacketClipboardText({ body })).toBe(body);
  });
});

describe('gauge (D0)', () => {
  it('tiers by grade letter: A/B strong (sage), C/D fair (peach), F weak (warning)', () => {
    expect(gaugeTier('A-').tier).toBe('strong');
    expect(gaugeTier('A-').arcClass).toBe('text-sage');
    expect(gaugeTier('B').tier).toBe('strong');
    expect(gaugeTier('C').tier).toBe('fair');
    expect(gaugeTier('C').arcClass).toBe('text-peach'); // the reserved brand orange
    expect(gaugeTier('D+').tier).toBe('fair');
    expect(gaugeTier('F').tier).toBe('weak');
    expect(gaugeTier('F').arcClass).toBe('text-warning');
  });

  it('frames low grades as supportive + fixable, never humiliating', () => {
    expect(gaugeTier('F').headline.toLowerCase()).toContain('fixable');
    expect(gaugeTier('F').icon).not.toBe(''); // a non-color tier signal always exists
  });

  it('gaugeDashoffset: 0→full ring, 100→0, 50→half, clamped', () => {
    expect(gaugeDashoffset(0, 100)).toBe(100);
    expect(gaugeDashoffset(100, 100)).toBe(0);
    expect(gaugeDashoffset(50, 100)).toBe(50);
    expect(gaugeDashoffset(150, 100)).toBe(0);
  });
});
