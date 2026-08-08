import type { ProjectedGrade, FreeFix, FixPrescription, FixDiagnosis, FindingCategory } from '@crawlmouse/types';
import { PROJECTION_DISCLAIMER, ACTION_PACKET_COPY_LABEL } from '@crawlmouse/engine';
import { asNumber } from './numeric';

/** A persisted `fixes` row (the inverse of inngest buildFixRows). */
export interface FixDbRow {
  fix_id: string;
  category: string;
  target_url: string;
  target_title: string | null;
  marginal_delta: number | string | null;
  effort: string | null;
  rationale: string | null;
  rank: number;
  is_free_fix: boolean;
  suggested_links: unknown;
  action_packet_body: string | null;
}

export interface AuditGradeRow {
  /**
   * NULLABLE, because a REFUSED audit has no verdict — gate 7. These were `number` / `string`, which
   * forced the SSE route to coerce (`asNumber(row.score) ?? 0`, `row.grade ?? ''`) at the call site,
   * and a coerced 0 is the exact fabrication this spec exists to remove: it would appear as
   * `projectedGrade.current = { score: 0, grade: '' }` — a withheld verdict rendered as a total
   * failure. It was unreachable, but only because `projected_score` is NULL for a refusal and the
   * early return below happens to fire first. That is ONE GUARD standing between a null and a
   * fabricated zero, in a file whose whole subject is not doing that. Withheld at the source now.
   */
  currentScore: number | null;
  currentGrade: string | null;
  projectedScore: number | null;
  projectedGrade: string | null;
}

export interface ReconstructedConversion {
  projectedGrade: ProjectedGrade | null;
  freeFix: FreeFix | null;
  prescriptions: FixPrescription[] | null;
}

// NOTE: `effort` (always written by the engine) and the packet `format: 'markdown'` + copyLabel are
// engine invariants, not stored per-row — so they are defaulted here. If a non-markdown packet format
// ever ships, persist + read it explicitly. No drift today (the engine writes one shape).
function toDiagnosis(f: FixDbRow): FixDiagnosis {
  return {
    id: f.fix_id,
    category: f.category as FindingCategory,
    targetUrl: f.target_url,
    targetTitle: f.target_title,
    marginalDelta: asNumber(f.marginal_delta) ?? 0,
    effort: (f.effort as FixDiagnosis['effort']) ?? 'low',
    rationale: f.rationale ?? '',
  };
}

/** A diagnosis-only (advisory) row carries neither links nor a packet → it is NOT a prescription. */
function toPrescription(f: FixDbRow): FixPrescription | null {
  if (f.action_packet_body == null && f.suggested_links == null) return null;
  return {
    fixId: f.fix_id,
    suggestedLinks: Array.isArray(f.suggested_links) ? (f.suggested_links as FixPrescription['suggestedLinks']) : [],
    actionPacket: { fixId: f.fix_id, format: 'markdown', body: f.action_packet_body ?? '', copyLabel: ACTION_PACKET_COPY_LABEL },
  };
}

/**
 * Reconstruct the SPEC 02 §2–§4 conversion projection (gap ledger + cures) from the persisted `fixes`
 * rows — the exact inverse of inngest buildFixRows, so the SSE stream delivers the same data the engine
 * produced. The owner-scoped gate in projectAuditForClient decides who actually receives prescriptions;
 * this only rebuilds the objects. Empty fixes (a v1 / no-projection audit) → all null.
 */
export function reconstructConversion(fixes: FixDbRow[], audit: AuditGradeRow): ReconstructedConversion {
  // NO VERDICT, NO PROJECTION — checked FIRST, before anything can read a coerced value. A projection
  // is a statement ABOUT a current grade ("you are a C, you could be a B"), so without one there is
  // nothing to project FROM and the honest output is absence. This does not depend on the fix rows or
  // on `projected_score`; it depends only on whether a verdict exists.
  if (audit.currentScore == null || audit.currentGrade == null) {
    return { projectedGrade: null, freeFix: null, prescriptions: null };
  }
  const currentScore = audit.currentScore;
  const currentGrade = audit.currentGrade;
  if (fixes.length === 0) {
    // A zero-fix v2 audit (a no-gap / near-perfect site) persists no fix rows but DOES persist
    // projected_* columns (the engine always runs buildConversionCore on a v2 non-JS audit). Surface a
    // projectedGrade with an EMPTY ledger so the UI can say "already at your achievable grade" rather
    // than nothing. A v1 / JS-rendered audit has no projected columns → projectedScore null → all null.
    if (audit.projectedScore == null) return { projectedGrade: null, freeFix: null, prescriptions: null };
    return {
      projectedGrade: {
        current: { score: currentScore, grade: currentGrade },
        projected: { score: audit.projectedScore, grade: audit.projectedGrade ?? currentGrade },
        ledger: [],
        disclaimer: PROJECTION_DISCLAIMER,
      },
      freeFix: null,
      prescriptions: null,
    };
  }
  const sorted = [...fixes].sort((a, b) => a.rank - b.rank);
  const ledger = sorted.map(toDiagnosis);
  const prescriptions = sorted.map(toPrescription).filter((p): p is FixPrescription => p !== null);
  const freeRow = sorted.find((f) => f.is_free_fix);
  const freePres = freeRow ? toPrescription(freeRow) : null;
  const freeFix: FreeFix | null =
    freeRow && freePres ? { diagnosis: toDiagnosis(freeRow), prescription: freePres, rank: freeRow.rank } : null;
  const projectedGrade: ProjectedGrade = {
    current: { score: currentScore, grade: currentGrade },
    projected: { score: audit.projectedScore ?? currentScore, grade: audit.projectedGrade ?? currentGrade },
    ledger,
    disclaimer: PROJECTION_DISCLAIMER,
  };
  return { projectedGrade, freeFix, prescriptions };
}
