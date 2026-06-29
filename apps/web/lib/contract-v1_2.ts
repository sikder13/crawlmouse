import type { Confidence, FindingCategory, MonitoringDelta } from '@crawlmouse/types';

// ─────────────────────────────────────────────────────────────────────────────
// Contract amendment v1.2 — SPEC 03's LOCAL SHIM of the value types.
//
// The amendment's canonical home for these types is `packages/types/src/` (SPEC 02 owns and
// implements them in Step E). SPEC 02 merges to main FIRST; at Phase G this file is DELETED and the
// imports below re-point from `@/lib/contract-v1_2` to `@crawlmouse/types` — a pure re-point with NO
// shape change. To keep that swap trivial, these definitions are STRUCTURALLY IDENTICAL to
// docs/specs/contract-amendment-v1.2.md §2 (same field names, types, nullability). Do not drift.
// ─────────────────────────────────────────────────────────────────────────────

// ── Live link graph (D3, the signature visual). Derived from the static crawl + deterministic grade. ──
export interface GraphNode {
  id: string; // stable node id = the canonical URL (matches FixDiagnosis targeting)
  url: string;
  title: string | null;
  depth: number | null; // BFS click-depth from homepage over the eligible graph; null if unreachable
  isHomepage: boolean;
  isOrphan: boolean; // zero inbound internal links (the flash-on-find node)
  pagerank: number; // 0..1 normalized internal PageRank (node size)
  jsOnly: boolean; // links to/from this node appear only via JS → "an AI crawler can't see this"
  inboundCount: number; // inbound internal links (for hover detail)
  outboundCount: number;
}

export interface GraphEdge {
  from: string; // GraphNode.id (source)
  to: string; // GraphNode.id (target)
  nofollow: boolean; // rendered neutrally / zero PageRank weight (always false in v1.2 — engine doesn't parse it yet)
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number; // the REAL total (pre-cap) so the UI can say "showing N of totalNodes"
  totalEdges: number;
  capped: boolean; // true when nodes/edges were truncated for readability/performance
  capReason: 'none' | 'readability' | 'free_tier' | 'performance';
}

// ── Re-audit endpoint (SPEC 02 §8 manual monitoring). POST /api/audits/[id]/reaudit ──
export interface ReauditRequest {
  turnstileToken?: string; // re-audit goes through the SAME rate-limit/abuse path as a normal audit
}
export interface ReauditResponse {
  newAuditId: string; // the freshly-created audit → client redirects to /audit/<id>
  previousAuditId: string; // the audit this re-audits (for the monitoring delta linkage)
  status: 'queued'; // the audit pipeline runs async; the client navigates and streams as usual
}

// ── Dashboard data (SPEC 03 §5 the "what-changed" retention engine). ──
export interface DashboardSiteHistoryPoint {
  auditId: string;
  score: number;
  grade: string;
  ranAt: string; // ISO
}
export interface DashboardFixChecklistItem {
  fixId: string; // FixDiagnosis.id (stable across re-audits)
  label: string; // the diagnosis headline (plain language)
  category: FindingCategory;
  resolved: boolean; // computed by comparing the latest audit to the prior
  marginalDelta: number; // relative impact (for ordering; never summed)
}
export interface DashboardSite {
  siteUrl: string;
  latestAuditId: string;
  currentGrade: string;
  currentScore: number;
  confidence: Confidence; // so the dashboard gauge can show estimate vs verdict
  // The "what changed since last visit" payoff — null when there's no previous audit (first audit):
  delta: MonitoringDelta | null; // (MonitoringDelta is the v1.1 type — reused here)
  history: DashboardSiteHistoryPoint[]; // for the grade-over-time sparkline (oldest → newest)
  // GATED (Pro owner only): the open-loop fix checklist. null for free/non-owner.
  fixChecklist: DashboardFixChecklistItem[] | null;
  fixChecklistDoneCount: number | null; // "3 of 7 done" → done = N; total = fixChecklist.length
}
