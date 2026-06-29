export type CmsName =
  | 'shopify'
  | 'wordpress'
  | 'webflow'
  | 'wix'
  | 'squarespace'
  | 'framer'
  | 'ghost'
  | 'custom';

export interface AuditOptions {
  url: string;
  pageCap?: number;                    // default: 500 (free), 2000 (pro)
  depthLimit?: number;                 // default: 10
  perHostConcurrency?: number;         // default: 8
  staggerMs?: number;                  // default: 250
  pageTimeoutMs?: number;              // default: 10000
  basicAuth?: { username: string; password: string };   // v1.2 staging
  extraHeaders?: Record<string, string>;                // v1.2 staging
  // Context metadata (v1.2 CI integration; null in v1.0)
  commitSha?: string;
  environment?: string;
  branch?: string;
  deploymentId?: string;
}

export interface Page {
  url: string;
  urlHash: string;                     // sha256 hex
  title?: string;
  statusCode: number;
  depth: number | null;                // null = unreachable
  inDegree: number;
  outDegree: number;
  isOrphan: boolean;
  /**
   * §1 fetch-outcome taxonomy (v2 engine only; undefined on v1). Redirects are followed to the
   * final 200, so a stored node is never 'redirect'.
   */
  fetchOutcome?: 'ok' | 'blocked' | 'dead';
  /**
   * §1/§7 (v2 engine only; undefined on v1): true when this page was NOT a gradeable node — i.e.
   * a blocked/dead fetch excluded from the graph, orphan, depth, PageRank and the grade.
   */
  excludedFromGrade?: boolean;
  /**
   * SPEC 02 v1.2 (v2 engine only; undefined on v1): raw internal PageRank for this node (a 0..1
   * probability over the gradeable graph). Persisted so the live graph can size nodes by authority;
   * max-normalized to a 0..1 node size at graph-assembly time. 0/undefined for non-gradeable pages.
   */
  pagerank?: number;
}

export interface Link {
  fromUrl: string;
  toUrl: string;
  anchorText: string;
  isGenericAnchor: boolean;
}

export type FindingCategory =
  | 'orphan'
  | 'near_orphan'
  | 'deep_page'
  | 'unreachable_page'
  | 'over_optimized_anchor'
  | 'generic_anchor_overuse'
  | 'under_linked_important'
  | 'incomplete_crawl'
  | 'js_rendered';

export interface Finding {
  category: FindingCategory;
  severity: 'critical' | 'medium' | 'minor';
  pageUrl?: string;
  payload?: Record<string, unknown>;
}

export interface GradeBreakdown {
  orphanRatioScore: number;            // 0..1
  depthScore: number;                  // 0..1
  anchorDiversityScore: number;        // 0..1
  structureScore: number;              // 0..1
}

/** Crawl-health confidence in the grade (§6). `low` => present as an estimate, not a verdict. */
export type Confidence = 'low' | 'medium' | 'high';

/**
 * Per-audit crawl-health (§6). Surfaces how much of the site was actually reached and how blocked
 * the crawl was, so the UI can show "we crawled N of ~M pages — confidence: high" and the grade can
 * be caveated when the crawl was poor. Populated by the v2 engine; undefined on the legacy path.
 */
export interface CrawlHealth {
  discovered: number;                  // unique internal URLs seen (fetched ∪ link targets)
  fetchedOk: number;                   // HTTP 200 pages (the gradeable nodes)
  blocked: number;                     // 403/429/503/0 (throttled/blocked/timeout/reset)
  dead: number;                        // other 4xx/5xx (404/410/500…)
  attempted: number;                   // total fetch attempts (= rows with a status)
  coveragePct: number;                 // fetchedOk / discovered (0..1)
  blockRate: number;                   // blocked / attempted (0..1)
  partial: boolean;                    // discovered > attempted (page cap truncated discovery)
  confidence: Confidence;
}

export interface CmsMetadata {
  themeName?: string;
  isPlus?: boolean;                    // Shopify-specific
  detectedApps?: string[];
  currency?: string;
  locale?: string;
  wpVersion?: string;
  [key: string]: unknown;
}

export interface AuditResult {
  url: string;
  cms: CmsName;
  cmsConfidence: number;               // 0..1
  cmsMetadata: CmsMetadata;
  pages: Page[];
  links: Link[];
  findings: Finding[];
  score: number;                        // 0..100
  grade: string;                        // 'A' | 'A-' | ... | 'F'
  breakdown: GradeBreakdown;
  /** §6 crawl-health/confidence. Present on the v2 engine path; undefined on v1. */
  crawlHealth?: CrawlHealth;
  /** SPEC 02 §2 confidence band around the point estimate. Present on v2; undefined on v1. */
  confidenceBand?: ConfidenceBand;
  /** SPEC 02 §3 projected-grade ledger (the gap). Present on v2 & not jsRendered; undefined otherwise. */
  projectedGrade?: ProjectedGrade;
  /** SPEC 02 §3-§5 ALL cures (each fix's links + action-packet); the web gates them. Same gating as projectedGrade. */
  prescriptions?: FixPrescription[];
  /** SPEC 02 §4 the one complete free cure (rank-1); null when no prescribable fix exists. Same gating. */
  freeFix?: FreeFix | null;
  startedAt: Date;
  completedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 02 — Conversion Core shared data contract (§1, frozen; identical in SPEC 03 §1).
// Reuses `Confidence` and `FindingCategory` above. The web-side composite that the client
// receives (`ClientAuditV2`) lives in apps/web/lib/audit-stream-projection.ts because it
// extends `ClientAudit`; these are the reusable value types it composes.
// ─────────────────────────────────────────────────────────────────────────────

/** Entitlement / tier — the agency seam. Derived SERVER-SIDE from users.tier + pro_until. */
export type Tier = 'free' | 'pro' | 'agency';

export interface Entitlement {
  tier: Tier;
  proUntil: string | null;            // ISO; the existing pro_until
  // Capability gates — derived from tier, ALWAYS recomputed server-side, never trusted from the client.
  canSeeAllPrescriptions: boolean;    // the cure for every fix (Pro+)
  canUseActionPackets: boolean;       // copy-paste AI artifacts (Pro+)
  canMonitor: boolean;                // re-audit + delta (Pro+)
  canSeeFullSiteGrade: boolean;       // completeness: grade the whole site, not a sampled estimate (Pro+)
  canWhiteLabel: boolean;             // agency only — FALSE for everyone in this phase
}

/** Confidence band (§2). Replaces the blunt low-confidence score cap. */
export interface ConfidenceBand {
  pointEstimate: number;              // the deterministic score (0..100) — unchanged determinism (R1)
  grade: string;                      // letter grade for pointEstimate
  lower: number;                      // band lower bound (0..100)
  upper: number;                      // band upper bound (0..100)
  confidence: Confidence;             // 'low' | 'medium' | 'high' (already defined)
  basis: {
    crawled: number;                  // pages actually graded (fetchedOk)
    estimatedTotal: number | null;    // ~M; null when we can't responsibly estimate (then omit "of ~M")
    method: 'sitemap' | 'frontier' | 'none';  // how estimatedTotal was derived (auditability)
  };
  isEstimate: boolean;                // true when partial/low-confidence → UI renders "estimate", not verdict
}

/** The gap ledger (§3). Deterministic, no LLM (D3). */
export interface FixDiagnosis {       // FREE — part of the full diagnosis. The "what" + "how much".
  id: string;                         // stable, deterministic id (so monitoring can match across re-audits)
  category: FindingCategory;          // ties to the diagnosis taxonomy already in this file
  targetUrl: string;                  // the page being fixed (e.g. the orphan / the deep page)
  targetTitle: string | null;
  marginalDelta: number;              // estimated RELATIVE score gain of THIS fix alone (NOT additive)
  effort: 'low' | 'medium' | 'high';
  rationale: string;                  // plain-language why (escaped at render — XSS, crawled content)
}

export interface FixPrescription {    // GATED (except the one free fix) — the "how". The cure.
  fixId: string;                      // FK to FixDiagnosis.id
  suggestedLinks: Array<{
    fromUrl: string;                  // source page to add the inbound link on
    fromTitle: string | null;
    anchorText: string;               // exact suggested anchor (deterministic; varied; not over-optimized)
    relevanceScore: number;           // 0..1 shared-token/TF-IDF relevance over titles/headings/anchors (D3)
  }>;
  actionPacket: ActionPacket;         // the paste-into-your-AI artifact for this fix
}

export interface ProjectedGrade {
  current: { score: number; grade: string };
  projected: { score: number; grade: string };   // grade of the fully-simulated-fixed graph (single recompute)
  ledger: FixDiagnosis[];             // FREE: the full ledger of problems + per-fix relative impact
  disclaimer: string;                 // "Estimated, not guaranteed. Per-fix impacts are relative and do not sum."
}

/** The free taste of the cure (§4). */
export interface FreeFix {
  diagnosis: FixDiagnosis;
  prescription: FixPrescription;      // the ONE complete, free cure (highest-impact)
  rank: number;                       // 1 = the #1 issue
}

/** Action packet (§5) — the headline. Deterministic markdown; pasteable into the user's own LLM. */
export interface ActionPacket {
  fixId: string;
  format: 'markdown';
  body: string;                       // the structured, deterministic context block (no LLM call on our side)
  copyLabel: string;                  // e.g. "Copy for ChatGPT / Claude"
}

/** Monitoring (§8) — manual re-audit delta now; scheduled engine deferred to SPEC 06. */
export interface MonitoringDelta {
  previousAuditId: string | null;     // null on the first audit of a URL
  currentAuditId: string;
  scoreDelta: number | null;          // current - previous (null when no previous)
  gradeFrom: string | null;
  gradeTo: string;
  resolvedFixIds: string[];           // FixDiagnosis.ids present last time, gone now
  newFixIds: string[];                // FixDiagnosis.ids that appeared
  ranAt: string;                      // ISO
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 02/03 — Contract Amendment v1.2: live graph, re-audit, dashboard, viewer signal.
// Identical in both specs; extends the frozen §1 above. SPEC 02 PRODUCES these (assembles the
// graph from the static crawl, owns the endpoint, persists); SPEC 03 RENDERS them.
// Static-only + deterministic + owner-scoped gating unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/** Live link graph (the signature visual), derived from the static crawl + deterministic grade. */
export interface GraphNode {
  id: string;                         // stable node id = the canonical URL (matches FixDiagnosis targeting)
  url: string;
  title: string | null;
  depth: number | null;               // BFS click-depth from homepage over the eligible graph; null if unreachable
  isHomepage: boolean;
  isOrphan: boolean;                  // zero inbound internal links (the flash-on-find node)
  pagerank: number;                   // 0..1 max-normalized internal PageRank (node size; top hub = 1)
  /**
   * REACHABILITY signal, NOT literal per-node JS detection (we never render JS — static-only). True
   * when the SITE tripped the JS/SPA detector AND the static crawl found NO inbound link path to this
   * page — i.e. "an AI/static crawler likely can't reach this page without running JavaScript." Always
   * false on a normally-rendered site. Render it with that honest meaning, never as "this node is JS".
   */
  jsOnly: boolean;
  inboundCount: number;               // inbound internal links (for hover detail)
  outboundCount: number;
}

export interface GraphEdge {
  from: string;                       // GraphNode.id (source)
  to: string;                         // GraphNode.id (target)
  /**
   * Display-only in v1.2 and currently ALWAYS false: the engine does not parse rel="nofollow"
   * (extract.ts) and PageRank does not weight it. Real nofollow parsing would touch the crawl path +
   * change the grade, so it is deferred to a future grade-gated enhancement. The field is kept so the
   * graph shape is stable for SPEC 03.
   */
  nofollow: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number;                 // the REAL total (pre-cap) so the UI can say "showing N of totalNodes"
  totalEdges: number;
  capped: boolean;                    // true when nodes/edges were truncated for readability/performance
  capReason: 'none' | 'readability' | 'free_tier' | 'performance';
}

// ── Re-audit endpoint (§8 manual monitoring). POST /api/audits/[id]/reaudit ──
export interface ReauditRequest {
  // The audit id is in the path; the body is minimal. Re-audit goes through the SAME
  // rate-limit/Turnstile/abuse path as a normal audit — not an unmetered backdoor.
  turnstileToken?: string;
}
export interface ReauditResponse {
  newAuditId: string;                 // the freshly-created audit → client redirects to /audit/<id>
  previousAuditId: string;            // the audit this re-audits (monitoring delta linkage)
  status: 'queued';                   // the pipeline runs async; the client navigates and streams as usual
}

// ── Dashboard data (the "what-changed" retention engine). ──
export interface DashboardSiteHistoryPoint {
  auditId: string;
  score: number;
  grade: string;
  ranAt: string;                      // ISO
}
export interface DashboardFixChecklistItem {
  fixId: string;                      // FixDiagnosis.id (stable across re-audits)
  label: string;                      // the diagnosis headline (plain language)
  category: FindingCategory;
  resolved: boolean;                  // GATED meaning: latest audit vs the prior (the MonitoringDelta logic)
  marginalDelta: number;              // relative impact (for ordering; never summed)
}
export interface DashboardSite {
  siteUrl: string;
  latestAuditId: string;
  currentGrade: string;
  currentScore: number;
  confidence: Confidence;             // so the dashboard gauge can show estimate vs verdict
  // The "what changed since last visit" payoff — null when there's no previous audit (first audit):
  delta: MonitoringDelta | null;
  history: DashboardSiteHistoryPoint[];  // grade-over-time sparkline (prev→current now; full series = SPEC 06)
  // GATED (Pro owner only): the open-loop fix checklist. null for free/non-owner.
  fixChecklist: DashboardFixChecklistItem[] | null;
  fixChecklistDoneCount: number | null;  // "3 of 7 done" → done = N; total = fixChecklist.length
}
