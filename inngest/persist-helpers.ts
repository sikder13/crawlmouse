// Pure mappers from engine audit results to Supabase row shapes. Kept separate from
// the Inngest function so the link/finding endpoint resolution is unit-testable — this
// is the exact logic that silently dropped rows when the page-id map was incomplete.

import type { FixDiagnosis, FixPrescription } from '@crawlmouse/types';

export interface ResultPage {
  url: string;
  urlHash: string;
  title?: string | null;
  statusCode: number;
  depth: number | null;
  inDegree: number;
  outDegree: number;
  isOrphan: boolean;
  // §1/§7 (v2 engine): per-page fetch outcome + whether the page was excluded from the grade.
  // Optional: the v1 engine path never sets these (rows then persist NULL / default false).
  fetchOutcome?: 'ok' | 'blocked' | 'dead';
  excludedFromGrade?: boolean;
  // SPEC 02 v1.2 (v2 engine): raw internal PageRank for the live graph. Undefined on v1 → NULL.
  pagerank?: number;
}

export interface ResultLink {
  fromUrl: string;
  toUrl: string;
  anchorText: string | null;
  isGenericAnchor: boolean;
}

export interface ResultFinding {
  category: string;
  severity: string;
  pageUrl?: string | null;
  payload?: unknown;
}

export interface PageRow {
  audit_id: string; url: string; url_hash: string; title: string | null;
  status_code: number; depth: number | null; in_degree: number; out_degree: number; is_orphan: boolean;
  fetch_outcome: string | null; excluded_from_grade: boolean; pagerank: number | null;
}
export interface FixRow {
  audit_id: string; fix_id: string; category: string; target_url: string; target_title: string | null;
  marginal_delta: number; effort: string | null; rationale: string | null; rank: number;
  is_free_fix: boolean; suggested_links: unknown; action_packet_body: string | null;
}
export interface LinkRow {
  audit_id: string; from_page_id: string; to_page_id: string; anchor_text: string | null; is_generic_anchor: boolean;
}
export interface FindingRow {
  audit_id: string; category: string; severity: string; page_id: string | null; payload: unknown;
}

export function buildPageRows(auditId: string, pages: ResultPage[]): PageRow[] {
  return pages.map((p) => ({
    audit_id: auditId,
    url: p.url,
    url_hash: p.urlHash,
    title: p.title ?? null,
    status_code: p.statusCode,
    depth: p.depth,
    in_degree: p.inDegree,
    out_degree: p.outDegree,
    is_orphan: p.isOrphan,
    // §1/§7: v2 sets these; v1 leaves them undefined -> NULL / default false (the column defaults),
    // so a v1 page row is persisted identically to before the additive migration.
    fetch_outcome: p.fetchOutcome ?? null,
    excluded_from_grade: p.excludedFromGrade ?? false,
    // SPEC 02 v1.2: raw PageRank for the live graph; v1 leaves it undefined -> NULL.
    pagerank: p.pagerank ?? null,
  }));
}

/**
 * Map the SPEC 02 §3 projection (the gap ledger) + §3–§5 cures into `fixes` rows. Each ledger
 * diagnosis becomes a row, joined to its prescription (suggestedLinks + action-packet body) by fixId;
 * rank is the ledger order (sorted by marginal impact); `is_free_fix` marks the rank-1 free cure. The
 * gated cure columns (suggested_links / action_packet_body) are written here but served ONLY through
 * the owner+Pro API projection (the table is service-role-only). v1 (no projection) → [] → no rows.
 */
export function buildFixRows(
  auditId: string,
  ledger: FixDiagnosis[],
  prescriptions: FixPrescription[],
  freeFixId: string | null,
): FixRow[] {
  const presByFix = new Map(prescriptions.map((p) => [p.fixId, p]));
  return ledger.map((d, i) => {
    const pres = presByFix.get(d.id);
    return {
      audit_id: auditId,
      fix_id: d.id,
      category: d.category,
      target_url: d.targetUrl,
      target_title: d.targetTitle,
      marginal_delta: d.marginalDelta,
      effort: d.effort,
      rationale: d.rationale,
      rank: i + 1,
      is_free_fix: freeFixId === d.id,
      suggested_links: pres ? pres.suggestedLinks : null,
      action_packet_body: pres ? pres.actionPacket.body : null,
    };
  });
}

export function buildLinkRows(auditId: string, links: ResultLink[], urlToPageId: Map<string, string>): LinkRow[] {
  return links
    .map((l) => ({
      audit_id: auditId,
      from_page_id: urlToPageId.get(l.fromUrl),
      to_page_id: urlToPageId.get(l.toUrl),
      anchor_text: l.anchorText,
      is_generic_anchor: l.isGenericAnchor,
    }))
    .filter((r): r is LinkRow => Boolean(r.from_page_id && r.to_page_id));
}

export function buildFindingRows(auditId: string, findings: ResultFinding[], urlToPageId: Map<string, string>): FindingRow[] {
  return findings.map((f) => ({
    audit_id: auditId,
    category: f.category,
    severity: f.severity,
    page_id: f.pageUrl ? urlToPageId.get(f.pageUrl) ?? null : null,
    payload: f.payload ?? null,
  }));
}
