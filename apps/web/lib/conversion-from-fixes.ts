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
  currentScore: number;
  currentGrade: string;
  projectedScore: number | null;
  projectedGrade: string | null;
}

export interface ReconstructedConversion {
  projectedGrade: ProjectedGrade | null;
  freeFix: FreeFix | null;
  prescriptions: FixPrescription[] | null;
}

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
  if (fixes.length === 0) return { projectedGrade: null, freeFix: null, prescriptions: null };
  const sorted = [...fixes].sort((a, b) => a.rank - b.rank);
  const ledger = sorted.map(toDiagnosis);
  const prescriptions = sorted.map(toPrescription).filter((p): p is FixPrescription => p !== null);
  const freeRow = sorted.find((f) => f.is_free_fix);
  const freePres = freeRow ? toPrescription(freeRow) : null;
  const freeFix: FreeFix | null =
    freeRow && freePres ? { diagnosis: toDiagnosis(freeRow), prescription: freePres, rank: freeRow.rank } : null;
  const projectedGrade: ProjectedGrade = {
    current: { score: audit.currentScore, grade: audit.currentGrade },
    projected: { score: audit.projectedScore ?? audit.currentScore, grade: audit.projectedGrade ?? audit.currentGrade },
    ledger,
    disclaimer: PROJECTION_DISCLAIMER,
  };
  return { projectedGrade, freeFix, prescriptions };
}
