import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPageRows, buildLinkRows, buildFindingRows,
  type ResultPage, type ResultLink, type ResultFinding,
} from './persist-helpers';

/** PostgREST caps a query (and an insert's RETURNING) at ~1000 rows by default. */
const PAGE_READBACK = 1000;

export interface AuditResult {
  pages: ResultPage[];
  links: ResultLink[];
  findings: ResultFinding[];
  cms: string | null;
  cmsMetadata: unknown;
  score: number;
  grade: string;
  completedAt: string | number | Date;
}

/**
 * Persist a finished audit's children and then mark the audit completed — LAST, so the
 * SSE stream never sees 'completed' before the findings exist.
 *
 * Idempotent + fail-loud: Inngest may re-run this step after a transient error, and
 * links/findings have no unique key, so we first delete any children from a prior attempt,
 * and we throw on any insert/update error so a partial write triggers a clean retry rather
 * than silently leaving a "completed" audit with missing or duplicated rows.
 */
export async function persistAuditResults(
  sb: SupabaseClient,
  auditId: string,
  result: AuditResult,
): Promise<void> {
  // Clear children from any prior attempt (findings/links before pages: findings with a
  // null page_id don't cascade from a pages delete). Keyed on audit_id (indexed).
  for (const table of ['links', 'findings', 'pages'] as const) {
    const { error } = await sb.from(table).delete().eq('audit_id', auditId);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  }

  const { error: pagesErr } = await sb.from('pages').insert(buildPageRows(auditId, result.pages));
  if (pagesErr) throw new Error(`pages insert failed: ${pagesErr.message}`);

  // Build url -> page id from a paged read-back (an insert's RETURNING is capped at ~1000).
  const urlToPageId = new Map<string, string>();
  for (let from = 0; ; from += PAGE_READBACK) {
    const { data, error } = await sb.from('pages').select('id, url').eq('audit_id', auditId).range(from, from + PAGE_READBACK - 1);
    if (error) throw new Error(`pages read-back failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const p of data as { id: string; url: string }[]) urlToPageId.set(p.url, p.id);
    if (data.length < PAGE_READBACK) break;
  }

  const linkRows = buildLinkRows(auditId, result.links, urlToPageId);
  if (linkRows.length > 0) {
    const { error } = await sb.from('links').insert(linkRows);
    if (error) throw new Error(`links insert failed: ${error.message}`);
  }

  const findingRows = buildFindingRows(auditId, result.findings, urlToPageId);
  if (findingRows.length > 0) {
    const { error } = await sb.from('findings').insert(findingRows);
    if (error) throw new Error(`findings insert failed: ${error.message}`);
  }

  const { error: updateErr } = await sb.from('audits').update({
    status: 'completed',
    cms_detected: result.cms,
    cms_metadata: result.cmsMetadata,
    page_count: result.pages.length,
    link_count: result.links.length,
    score: result.score,
    grade: result.grade,
    completed_at: new Date(result.completedAt).toISOString(),
  }).eq('id', auditId);
  if (updateErr) throw new Error(`audit completion update failed: ${updateErr.message}`);
}
