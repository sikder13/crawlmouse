// Pure mappers from engine audit results to Supabase row shapes. Kept separate from
// the Inngest function so the link/finding endpoint resolution is unit-testable — this
// is the exact logic that silently dropped rows when the page-id map was incomplete.

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
  fetch_outcome: string | null; excluded_from_grade: boolean;
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
  }));
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
