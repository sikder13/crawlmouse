// Pure mappers from engine audit results to Supabase row shapes. Kept separate from
// the Inngest function so the link/finding endpoint resolution is unit-testable — this
// is the exact logic that silently dropped rows when the page-id map was incomplete.

import type { AiFinding, AiReadinessScore, FixDiagnosis, FixPrescription, PageAiSignals } from '@crawlmouse/types';
import { FINGERPRINT_PERSIST_MAX_STRATA, type CrawlFingerprint } from '@crawlmouse/types';
import { AI_FINDING_SEVERITY_RANK, AI_PERSIST_MAX_FINDINGS, rankIn } from '@crawlmouse/types';

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
  // SPEC 05 §4 (v2 engine): per-page AI-legibility signals. Undefined on v1 / when disabled → NULL.
  aiSignals?: PageAiSignals;
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
  // SPEC 05 §4/§11: the PageAiSignals payload (jsonb). v2 sets it; v1 / extraction-disabled → NULL.
  ai_signals: unknown | null;
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
    // SPEC 05 §4: the per-page AI-legibility signals (incl. the bounded excerpt). v2 sets it; v1 -> NULL.
    ai_signals: p.aiSignals ?? null,
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

/** Severity order for the persistence cap: keep what matters when we cannot keep it all. */

/** Packet-buildability is a function of kind + whether the finding targets a page — nothing else. */
const findingClass = (f: AiFinding): string => `${f.kind}|${f.targetUrl == null ? 'site' : 'page'}`;

/**
 * SPEC 05 — bound the AI-readiness ledger BEFORE it is written to `audits.ai_readiness`.
 *
 * This column is the source of truth every downstream surface reads: the client projection, the
 * packets, the simulator and the minted snapshot each had their own cap while the row itself had none.
 * Measured on the raw score at PRO_PAGE_CAP: 2000 pages ⇒ 6002 findings ⇒ 1.90 MB of jsonb, and 31.54
 * MB once `targetTitle` (raw crawled text, so attacker-chosen) is long.
 *
 * Two rules, and the second is the one that keeps the product honest:
 *  1. `totalFindings` is preserved untouched, so "showing N of M" never quietly reports the cap.
 *  2. One finding of every distinct (kind, targeted) class is RESERVED before the severity cut. Packet
 *     buildability depends only on that class, so the reservation makes
 *     `countBuildablePackets(persisted) > 0` exactly equivalent to the same test on the full ledger.
 *     Without it, a site with 500+ medium findings would lose every `missing_structured_data` (info,
 *     and packetable) to the cut, and the Pro wall would stop advertising packets that do exist.
 *
 * Deterministic (R1): stable severity sort over an already-deterministic assembler order.
 */
export function boundAiReadinessForPersist(score: AiReadinessScore): AiReadinessScore {
  const all = score.findings ?? [];
  const total = score.totalFindings ?? all.length;
  if (all.length <= AI_PERSIST_MAX_FINDINGS) return { ...score, totalFindings: total };

  const reservedIdx = new Set<number>();
  const seenClass = new Set<string>();
  all.forEach((f, i) => {
    const cls = findingClass(f);
    if (!seenClass.has(cls)) {
      seenClass.add(cls);
      reservedIdx.add(i);
    }
  });

  const rest = all
    .map((f, i) => ({ f, i }))
    .filter(({ i }) => !reservedIdx.has(i))
    // In-run values from a closed enum, so this site is not reachable — routed through the shared
    // helper anyway so the ordering has ONE definition and cannot drift from the three that are.
    .sort((a, b) => rankIn(AI_FINDING_SEVERITY_RANK, a.f.severity) - rankIn(AI_FINDING_SEVERITY_RANK, b.f.severity) || a.i - b.i)
    .slice(0, Math.max(0, AI_PERSIST_MAX_FINDINGS - reservedIdx.size));

  // Re-emit in the assembler's original order so the persisted ledger reads the same way the
  // unbounded one did — the cap changes WHICH findings survive, never how they are ordered.
  const keep = new Set<number>([...reservedIdx, ...rest.map(({ i }) => i)]);
  // Final clamp. The reserved set is not bounded by the cap — it is one entry per distinct (kind,
  // targeted) class — so with more classes than AI_PERSIST_MAX_FINDINGS the union would exceed it.
  // The AiFindingKind enum makes that unreachable today (~26 classes), which is exactly the kind of
  // invariant that stops being true without anyone noticing.
  const kept = all.filter((_, i) => keep.has(i)).slice(0, AI_PERSIST_MAX_FINDINGS);
  return { ...score, findings: kept, totalFindings: total };
}

/**
 * SPEC 5.1a §6.7/§12 — bound the crawl fingerprint's strata table BEFORE it is written to
 * `audits.fingerprint`.
 *
 * THE DEFECT THIS CLOSES, found while sizing the migration rather than by reasoning. The strata table
 * is one row per distinct `templateKey` and nothing bounded it, while its size tracks
 * `discoveredCount` — the PRE-SELECTION discovered set, which the page cap does not bound. Measured on
 * the live corpus (2026-08-04) the maximum `discovered_count` is **100 684**, so a site whose URLs
 * share no path structure would have written roughly 6 MB of jsonb onto a single audit row. The
 * unapplied fingerprint migration's own storage note claimed "~120 KB worst case" because it reasoned
 * from the page cap.
 *
 * WHY AT THE WRITE, not in the engine: the in-memory fingerprint stays complete so the backtest
 * harness can attribute a composition delta across every stratum; only the stored copy is capped.
 * Exactly the placement `boundAiReadinessForPersist` uses, for the same reason.
 *
 * WHAT IS KEPT: the LARGEST strata by discovery. The table's job is naming WHICH SECTIONS of a site
 * moved between two crawls, and a section of one URL is not a section anyone attributes a grade
 * movement to. Ties break on `templateKey` so the result is deterministic (R1).
 *
 * WHAT IS NEVER TOUCHED: `digest`, `discoveredCount`, `selectedCount`, `seed`, `version`. The digest is
 * computed over the selected URL SET (`crawlSetDigest`), not over this table, so the cap cannot change
 * what "the same crawl" means — the one artifact that separates "the site changed" from "we sampled
 * differently" is unaffected by construction.
 *
 * NO SILENT TRUNCATION: `strataTotal` and `strataWithheld` record what was dropped. A table printing
 * 100 of 4 000 rows without saying so reads as "there were 100".
 */
export function boundFingerprintForPersist(fp: CrawlFingerprint): CrawlFingerprint {
  const all = fp.strata ?? [];
  if (all.length <= FINGERPRINT_PERSIST_MAX_STRATA) return fp;
  const kept = [...all]
    .sort((a, b) => b.discovered - a.discovered || (a.templateKey < b.templateKey ? -1 : a.templateKey > b.templateKey ? 1 : 0))
    .slice(0, FINGERPRINT_PERSIST_MAX_STRATA);
  return {
    ...fp,
    strata: kept,
    strataTotal: all.length,
    strataWithheld: all.length - kept.length,
  };
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
