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
