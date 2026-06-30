import { describe, it, expect } from 'vitest';
import { reconstructConversion, type FixDbRow } from './conversion-from-fixes';

const audit = { currentScore: 72, currentGrade: 'B-', projectedScore: 88, projectedGrade: 'A-' };

const fix = (over: Partial<FixDbRow>): FixDbRow => ({
  fix_id: 'orphan:https://x.com/o',
  category: 'orphan',
  target_url: 'https://x.com/o',
  target_title: 'Orphan',
  marginal_delta: 5,
  effort: 'low',
  rationale: 'no inbound links',
  rank: 1,
  is_free_fix: false,
  suggested_links: null,
  action_packet_body: null,
  ...over,
});

describe('reconstructConversion', () => {
  it('v1 / JS-rendered audit (no persisted projected columns) → all null', () => {
    expect(reconstructConversion([], { currentScore: 60, currentGrade: 'C', projectedScore: null, projectedGrade: null }))
      .toEqual({ projectedGrade: null, freeFix: null, prescriptions: null });
  });

  it('zero-fix v2 audit (no gap) → projectedGrade from columns with an EMPTY ledger; no cure', () => {
    const noGap = { currentScore: 90, currentGrade: 'A', projectedScore: 90, projectedGrade: 'A' };
    const out = reconstructConversion([], noGap);
    expect(out.projectedGrade!.current).toEqual({ score: 90, grade: 'A' });
    expect(out.projectedGrade!.projected).toEqual({ score: 90, grade: 'A' });
    expect(out.projectedGrade!.ledger).toEqual([]);
    expect(out.freeFix).toBeNull();
    expect(out.prescriptions).toBeNull();
  });

  it('rebuilds the ledger (rank order), projected grade, free fix, and prescriptions', () => {
    const rows: FixDbRow[] = [
      fix({
        fix_id: 'orphan:https://x.com/o', rank: 1, is_free_fix: true,
        suggested_links: [{ fromUrl: 'https://x.com/', fromTitle: 'Home', anchorText: 'the orphan', relevanceScore: 0.8 }],
        action_packet_body: 'PASTE INTO AI',
      }),
      fix({ fix_id: 'deep:https://x.com/d', category: 'deep_page', target_url: 'https://x.com/d', target_title: 'Deep', rank: 2, marginal_delta: 2, suggested_links: [{ fromUrl: 'https://x.com/hub', fromTitle: 'Hub', anchorText: 'deep page', relevanceScore: 0.5 }], action_packet_body: 'CURE 2' }),
      fix({ fix_id: 'generic_anchor_overuse', category: 'generic_anchor_overuse', target_url: 'https://x.com/', target_title: null, rank: 3, marginal_delta: 1 }), // advisory: no cure
    ];
    const out = reconstructConversion(rows, audit);

    // projected grade: current from the audit row, projected from the columns, full ledger, disclaimer
    expect(out.projectedGrade!.current).toEqual({ score: 72, grade: 'B-' });
    expect(out.projectedGrade!.projected).toEqual({ score: 88, grade: 'A-' });
    expect(out.projectedGrade!.ledger.map((d) => d.id)).toEqual(['orphan:https://x.com/o', 'deep:https://x.com/d', 'generic_anchor_overuse']);
    expect(out.projectedGrade!.disclaimer).toContain('do not sum');

    // free fix = the is_free_fix row, with its cure
    expect(out.freeFix!.diagnosis.id).toBe('orphan:https://x.com/o');
    expect(out.freeFix!.prescription.actionPacket.body).toBe('PASTE INTO AI');
    expect(out.freeFix!.prescription.actionPacket.copyLabel).toBe('Copy AI prompt');
    expect(out.freeFix!.rank).toBe(1);

    // prescriptions = only rows with a cure (the advisory generic_anchor_overuse row is excluded)
    expect(out.prescriptions!.map((p) => p.fixId)).toEqual(['orphan:https://x.com/o', 'deep:https://x.com/d']);
  });

  it('falls back to current grade when projected columns are null', () => {
    const out = reconstructConversion([fix({})], { currentScore: 60, currentGrade: 'C', projectedScore: null, projectedGrade: null });
    expect(out.projectedGrade!.projected).toEqual({ score: 60, grade: 'C' });
  });
});
