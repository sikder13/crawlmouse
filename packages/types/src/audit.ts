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
  startedAt: Date;
  completedAt: Date;
}
