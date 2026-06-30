import { asNumber } from './numeric';
import { classifyFailure, type FailureCategory } from './failure-classification';
import type {
  Entitlement,
  ConfidenceBand,
  ProjectedGrade,
  FreeFix,
  FixPrescription,
  MonitoringDelta,
  Finding,
  GraphData,
} from '@crawlmouse/types';

/**
 * The audit row as read SERVER-SIDE by the SSE route (service-role). It carries `user_id` (for the
 * owner/Pro gate) and the raw `failure_reason` (error.message) — NEITHER of which may reach the
 * client. `projectAuditForClient` is the single chokepoint that strips them.
 */
export interface AuditRow {
  id: string;
  /** The audited start URL — read server-side to anchor the graph's homepage; NOT emitted to the client. */
  url: string;
  status: string;
  grade: string | null;
  score: number | string | null;
  page_count: number | null;
  link_count: number | null;
  cms_detected: string | null;
  user_id: string | null;
  settings: { pageCap?: number } | null;
  failure_reason: string | null;
  // §6 crawl-health columns (v2; NULL on v1/legacy rows). coverage_pct/block_rate are Postgres
  // `numeric`, so PostgREST serializes them as strings — coerced to numbers in the projection.
  confidence: string | null;
  coverage_pct: number | string | null;
  block_rate: number | string | null;
  partial: boolean | null;
}

/** Client-safe projection: `user_id` and the raw `failure_reason` are never present. */
export interface ClientAudit {
  id: string;
  status: string;
  grade: string | null;
  score: number | null;
  page_count: number | null;
  link_count: number | null;
  cms_detected: string | null;
  settings: { pageCap?: number } | null;
  failureCategory: FailureCategory | null;
  // §6/§10 per-audit crawl-health (v2). null on a v1 row, so the client emits no crawl-health props.
  crawlHealth: { confidence: string; coveragePct: number; blockRate: number; partial: boolean } | null;
}

/**
 * SPEC 02 — Conversion Core client payload (frozen contract §1, amended v1.1; identical in SPEC 03).
 * EXTENDS `ClientAudit`. Produced by `projectAuditForClient` (the single chokepoint).
 *
 * Gating (OWNER-SCOPED): `prescriptions` and `monitoring` are the gated paid cure — populated ONLY
 * when the viewer is the authenticated OWNER of this audit AND that owner is Pro; otherwise `null`
 * and NEVER serialized (UI hiding is not gating). `entitlement` is the viewer's EFFECTIVE entitlement
 * for THIS audit (a non-owner viewer gets free-equivalent gates), so the UI locks always match the
 * data present. `confidenceBand`, `projectedGrade` (full ledger), `freeFix`, `findings`, `orphanCount`
 * and `avgDepth` are FREE. Conversion-core data is v2-only → null/empty on a v1 row.
 */
export interface ClientAuditV2 extends ClientAudit {
  entitlement: Entitlement;                       // viewer's effective (owner-scoped) entitlement — drives UI locks
  confidenceBand: ConfidenceBand | null;          // FREE (transparency builds trust)
  projectedGrade: ProjectedGrade | null;          // FREE: the full ledger (diagnosis + impact)
  freeFix: FreeFix | null;                         // FREE: the one complete cure (always present when one exists)
  prescriptions: FixPrescription[] | null;        // GATED (owner+Pro): null otherwise — never serialized
  monitoring: MonitoringDelta | null;             // GATED (owner+Pro): the delta; null otherwise
  hasMorePrescriptions: boolean;                   // UI signal: cures exist behind the wall
  // ── Amendment v1.1 — FREE. The full diagnosis (no per-category cap). `payload` is omitted on the
  // wire (lean): ship only category/severity/pageUrl; a needed datum becomes a TYPED field, never the Record.
  findings: Finding[];
  orphanCount: number;
  avgDepth: number | null;
  // ── Amendment v1.2 — FREE. NEITHER gates the cure (the cure stays owner+Pro via `entitlement`).
  viewerSignedIn: boolean;                         // auth signal ONLY (drives the STAY beat); signed-in ≠ owner ≠ Pro
  graph: GraphData | null;                         // the wow (capped per tier); null while building / on error
}

/**
 * Conversion-core inputs to the projection (sourced from the audit row + the `fixes` table by the SSE
 * route; null/empty until Step E lights them up, and only on a v2 row). The projection applies the
 * OWNER-SCOPED cure gate: `prescriptions`/`monitoring` survive only when the viewer OWNS the audit AND
 * is Pro. The free taste (`confidenceBand`, `projectedGrade` ledger, `freeFix`, `findings`) is always
 * present. `findings` is already scoped to v2 by the caller (empty on v1 → no new exposure).
 */
export interface ConversionProjectionInput {
  entitlement: Entitlement;
  isOwner: boolean;
  confidenceBand: ConfidenceBand | null;     // FREE
  projectedGrade: ProjectedGrade | null;     // FREE (the ledger is diagnoses only — no suggestedLinks)
  freeFix: FreeFix | null;                   // FREE (the one complete cure)
  prescriptions: FixPrescription[] | null;   // GATED — the FULL cure set (incl. the free one)
  monitoring: MonitoringDelta | null;        // GATED — the re-audit delta
  findings: Finding[];                       // FREE — full diagnosis
  orphanCount: number;
  avgDepth: number | null;
  viewerSignedIn: boolean;                   // FREE (v1.2) — auth signal only, never gates the cure
  graph: GraphData | null;                   // FREE (v1.2) — the capped live graph (caller assembles per tier)
}

/** Omit `payload` on the wire — ship only category/severity/pageUrl. */
function stripFindingPayload(f: Finding): Finding {
  return { category: f.category, severity: f.severity, pageUrl: f.pageUrl };
}

/**
 * Project a server-side audit row to the client-safe shape: drop `user_id`, coerce the
 * PostgREST-numeric-string score to a number, and replace the raw `failure_reason` with a coarse,
 * classified `failureCategory`. The category is set ONLY for a genuinely failed audit — a stray
 * reason on a non-failed row is ignored — so a transient/incidental value can never surface failure
 * copy on a running or completed audit.
 *
 * With a second `conversion` argument (the terminal `done` event), it emits the SPEC 02 `ClientAuditV2`
 * with OWNER-SCOPED cure gating; without it (snapshot/progress/v1), it returns the legacy `ClientAudit`
 * byte-identical to before — so no conversion keys ever appear on a non-conversion payload.
 */
export function projectAuditForClient(row: AuditRow): ClientAudit;
export function projectAuditForClient(row: AuditRow, conversion: ConversionProjectionInput): ClientAuditV2;
export function projectAuditForClient(
  row: AuditRow,
  conversion?: ConversionProjectionInput,
): ClientAudit | ClientAuditV2 {
  const base: ClientAudit = {
    id: row.id,
    status: row.status,
    grade: row.grade,
    score: asNumber(row.score),
    page_count: row.page_count,
    link_count: row.link_count,
    cms_detected: row.cms_detected,
    settings: row.settings,
    failureCategory: row.status === 'failed' ? classifyFailure(row.failure_reason) : null,
    // Carry crawl-health only when present (v2): `confidence` is set together with the rest, so its
    // presence gates the whole object. numeric strings are coerced like `score`; null on v1.
    crawlHealth:
      row.confidence != null
        ? {
            confidence: row.confidence,
            coveragePct: asNumber(row.coverage_pct) ?? 0,
            blockRate: asNumber(row.block_rate) ?? 0,
            partial: row.partial ?? false,
          }
        : null,
  };
  if (!conversion) return base;

  // OWNER-SCOPED cure gate: the paid cure is served ONLY to the authenticated owner who is Pro. A
  // non-owner viewer (even Pro) and a free owner both get the free view; gated fields become null and
  // are therefore never serialized.
  const canCure = conversion.isOwner && conversion.entitlement.canSeeAllPrescriptions;
  const canMonitor = conversion.isOwner && conversion.entitlement.canMonitor;
  const totalCures = conversion.prescriptions?.length ?? 0;
  return {
    ...base,
    entitlement: conversion.entitlement,
    confidenceBand: conversion.confidenceBand,
    projectedGrade: conversion.projectedGrade,
    freeFix: conversion.freeFix,
    prescriptions: canCure ? conversion.prescriptions : null,
    monitoring: canMonitor ? conversion.monitoring : null,
    // A cure exists beyond the single free one → signal the wall. Computed from the FULL set,
    // independent of whether THIS viewer is entitled to read it.
    hasMorePrescriptions: totalCures > (conversion.freeFix ? 1 : 0),
    findings: conversion.findings.map(stripFindingPayload),
    orphanCount: conversion.orphanCount,
    avgDepth: conversion.avgDepth,
    // v1.2 — FREE: never gated. viewerSignedIn is the auth signal (STAY beat); the graph is the wow.
    viewerSignedIn: conversion.viewerSignedIn,
    graph: conversion.graph,
  };
}
