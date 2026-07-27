import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiReadinessScore, Confidence, ConfidenceBand, PublicReportSnapshot } from '@crawlmouse/types';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { mapFindingRows, type FindingRow } from '@/lib/findings';
import { aggregateGraphStats, type GraphStatPage } from '@/lib/audit-stats';
import { asNumber } from '@/lib/numeric';
import { buildReportSnapshot } from '@/lib/report-snapshot';
import type { FixDbRow } from '@/lib/conversion-from-fixes';

// SPEC 04 §4 — assemble the FROZEN report snapshot at mint from the audit's persisted data. The fixes
// read uses the DIAGNOSIS-ONLY column list below: the gated cure columns (suggested_links,
// action_packet_body) are NEVER fetched, so no prescription data can reach the snapshot even by
// mistake (§11 + SPEC 02 gating, enforced at the read).
export const FIX_DIAGNOSIS_COLS = 'category, target_url, target_title, marginal_delta, effort, rationale, rank';

/**
 * The audit columns needed to build a snapshot. All are present in production: the SPEC 01/02 columns
 * since those specs shipped, and `ai_readiness` since the SPEC 05 migration was applied 2026-07-08 — so
 * there is still no deploy-order risk, though not for the "all present since SPEC 01/02" reason this
 * comment used to claim. `ai_readiness` is nullable BY DESIGN (a v1 audit, or one crawled with the
 * `AI_READINESS_EXTRACTION` kill-switch off), which is why it is optional here.
 */
export interface MintAuditRow {
  grade: string | null;
  score: number | string | null;
  cms_detected: string | null;
  page_count: number | null;
  confidence: string | null;
  coverage_pct: number | string | null;
  confidence_band: unknown;
  projected_score: number | string | null;
  projected_grade: string | null;
  ai_readiness?: unknown;              // SPEC 05 §10 — the persisted AiReadinessScore jsonb, or null
}

export async function buildMintSnapshot(
  admin: SupabaseClient,
  auditId: string,
  audit: MintAuditRow,
  domain: string,
  mintedAt: string,
): Promise<PublicReportSnapshot | null> {
  if (!audit.grade) return null; // an ungradeable / v1 audit has no client-ready report

  const [findings, fixDiagnoses, pages] = await Promise.all([
    fetchAll<FindingRow>(admin, 'findings', 'category, severity, pages(url)', auditId),
    fetchAll<Omit<FixDbRow, 'fix_id' | 'is_free_fix' | 'suggested_links' | 'action_packet_body'>>(admin, 'fixes', FIX_DIAGNOSIS_COLS, auditId),
    fetchAll<GraphStatPage>(admin, 'pages', 'is_orphan, depth', auditId),
  ]);

  const { orphanCount, avgDepth } = aggregateGraphStats(pages);
  const band = (audit.confidence_band as ConfidenceBand | null) ?? null;

  // The ledger builder only reads diagnosis fields; the gated cure fields are absent from the fetch,
  // so pass them as null to satisfy the FixDbRow shape without ever having read them.
  const fixes: FixDbRow[] = fixDiagnoses.map((f) => ({
    ...f,
    fix_id: '',
    is_free_fix: false,
    suggested_links: null,
    action_packet_body: null,
  }));

  return buildReportSnapshot({
    domain,
    grade: audit.grade,
    score: asNumber(audit.score) ?? 0,
    cms: audit.cms_detected,
    mintedAt,
    pageCount: audit.page_count ?? 0,
    orphanCount,
    avgDepth,
    confidence: (audit.confidence as Confidence | null) ?? null,
    coveragePct: asNumber(audit.coverage_pct),
    estimatedTotal: band?.basis?.estimatedTotal ?? null,
    projectedScore: asNumber(audit.projected_score),
    projectedGrade: audit.projected_grade,
    findings: mapFindingRows(findings),
    fixes,
    // SPEC 05 §10 — diagnostic-only, straight from the persisted column. `?? null` normalizes the
    // absent-column / null-column cases to the single null path the builder omits on, so a v1 audit
    // (or one with the extraction kill-switch off) mints a byte-identical pre-SPEC-05 snapshot.
    aiReadiness: (audit.ai_readiness as AiReadinessScore | null | undefined) ?? null,
  });
}
