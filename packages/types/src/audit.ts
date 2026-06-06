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
  | 'incomplete_crawl';

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
  startedAt: Date;
  completedAt: Date;
}
