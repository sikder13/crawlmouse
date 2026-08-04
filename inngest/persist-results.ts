import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfidenceBand, ProjectedGrade, FixPrescription, FreeFix, AiReadinessScore } from '@crawlmouse/types';
import {
  buildPageRows, buildLinkRows, buildFindingRows, buildFixRows, boundAiReadinessForPersist,
  type ResultPage, type ResultLink, type ResultFinding,
} from './persist-helpers';

/** PostgREST caps a query (and an insert's RETURNING) at ~1000 rows by default. */
const PAGE_READBACK = 1000;
/**
 * Rows per `pages` insert request. At PRO_PAGE_CAP a single body measured 29.67 MB on non-Latin text;
 * 250 rows keeps it around 3 MB even at the per-row worst case, well inside any proxy limit.
 */
const PAGE_INSERT_CHUNK = 250;

export interface AuditResult {
  pages: ResultPage[];
  links: ResultLink[];
  findings: ResultFinding[];
  cms: string | null;
  cmsMetadata: unknown;
  /** NULL when the SPEC 5.1a refusal gate withheld a verdict. The columns are already nullable. */
  score: number | null;
  grade: string | null;
  completedAt: string | number | Date;
  /**
   * §6 per-audit crawl-health (v2 engine only; undefined on v1). When present, its fields are
   * written to the additive `audits` crawl-health columns; when absent the update omits them
   * entirely so the v1 path — and prod until the ENGINE_V2 flip — stays byte-unchanged.
   */
  crawlHealth?: {
    discovered: number;
    fetchedOk: number;
    blocked: number;
    coveragePct: number;
    blockRate: number;
    partial: boolean;
    confidence: string;
  };
  /**
   * SPEC 02 conversion core (v2 engine only; undefined on v1 & jsRendered). When present, the band +
   * projected grade are written to the additive `audits` columns and the ledger/cures into the
   * service-role-only `fixes` table. Absent → those writes are skipped, so the v1 path stays
   * byte-identical (prod unchanged until the ENGINE_V2 flip).
   */
  confidenceBand?: ConfidenceBand;
  projectedGrade?: ProjectedGrade;
  prescriptions?: FixPrescription[];
  freeFix?: FreeFix | null;
  /**
   * SPEC 05 §7 (v2 engine + assembled only; undefined on v1 / when hidden). Written to the additive
   * `audits.ai_readiness` jsonb column when present; absent → the write is skipped (v1 byte-identical).
   */
  aiReadiness?: AiReadinessScore;
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
  // null page_id don't cascade from a pages delete). `fixes` is independent (FK to audits). Keyed
  // on audit_id (indexed).
  for (const table of ['links', 'findings', 'fixes', 'pages'] as const) {
    const { error } = await sb.from(table).delete().eq('audit_id', auditId);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  }

  // CHUNKED. This was one un-chunked request: at PRO_PAGE_CAP with non-Latin text the body measured
  // 29.67 MB, which PostgREST/Kong can reject outright — and the failure mode is a thrown insert, i.e.
  // the whole audit. Chunking bounds the body independently of how well the per-field caps hold, so
  // the two protections do not share a failure mode. The delete-then-insert idempotency above is
  // unaffected: a retry re-deletes every child row before re-inserting.
  const pageRows = buildPageRows(auditId, result.pages);
  for (let i = 0; i < pageRows.length; i += PAGE_INSERT_CHUNK) {
    const { error: pagesErr } = await sb.from('pages').insert(pageRows.slice(i, i + PAGE_INSERT_CHUNK));
    if (pagesErr) throw new Error(`pages insert failed: ${pagesErr.message}`);
  }

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

  // SPEC 02 conversion core (v2 only): persist the gap ledger + cures into the service-role-only
  // `fixes` table. ≤ LEDGER_MAX_FIXES rows (no pagination needed). Absent on v1 → [] → no insert.
  const fixRows = buildFixRows(
    auditId,
    result.projectedGrade?.ledger ?? [],
    result.prescriptions ?? [],
    result.freeFix?.diagnosis.id ?? null,
  );
  if (fixRows.length > 0) {
    const { error } = await sb.from('fixes').insert(fixRows);
    if (error) throw new Error(`fixes insert failed: ${error.message}`);
  }

  // §6 crawl-health (v2 only). When the engine provides it, persist it to the additive audits
  // columns; when absent (v1) the spread is empty, so this completion update is byte-identical to
  // the pre-v2 behavior and prod stays unchanged until the ENGINE_V2 flip.
  const ch = result.crawlHealth;
  const { error: updateErr } = await sb.from('audits').update({
    status: 'completed',
    cms_detected: result.cms,
    cms_metadata: result.cmsMetadata,
    page_count: result.pages.length,
    link_count: result.links.length,
    score: result.score,
    grade: result.grade,
    completed_at: new Date(result.completedAt).toISOString(),
    ...(ch ? {
      discovered_count: ch.discovered,
      fetched_ok_count: ch.fetchedOk,
      blocked_count: ch.blocked,
      coverage_pct: ch.coveragePct,
      block_rate: ch.blockRate,
      confidence: ch.confidence,
      partial: ch.partial,
    } : {}),
    // SPEC 02 §2/§3 (v2 only): the confidence-band snapshot + the projected grade. Absent on v1 → the
    // spread is empty → completion update byte-identical to pre-v2.
    ...(result.confidenceBand ? { confidence_band: result.confidenceBand } : {}),
    ...(result.projectedGrade ? {
      projected_score: result.projectedGrade.projected.score,
      projected_grade: result.projectedGrade.projected.grade,
    } : {}),
    // SPEC 05 §7/§11 (v2 + assembled only): the sibling AI-readiness score snapshot. Absent on v1 / when
    // the feature is hidden (Amendment §2 null-assembly) → the spread is empty → completion write unchanged.
    // BOUNDED at the write. The raw score is unbounded in findings (one per page per issue kind) and
    // each finding carries a raw crawled title — measured 1.90 MB at PRO_PAGE_CAP, 31.54 MB with long
    // titles. See boundAiReadinessForPersist for why the cap reserves one finding of every kind rather
    // than cutting purely by severity.
    ...(result.aiReadiness ? { ai_readiness: boundAiReadinessForPersist(result.aiReadiness) } : {}),
  }).eq('id', auditId).eq('status', 'crawling');
  // `.eq('status', 'crawling')` is the race guard: if the user canceled mid-crawl (status now
  // 'canceled'), this completion write matches 0 rows and the audit stays canceled — a crawl
  // finishing right after a cancel can never un-cancel it. A normal crawl is always 'crawling' here
  // (mark-crawling ran first), so the happy path is unaffected.
  if (updateErr) throw new Error(`audit completion update failed: ${updateErr.message}`);
}
