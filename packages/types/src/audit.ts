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
  /**
   * SPEC 04 §2 — optional, additive progress-emission listener (the ONE sanctioned engine seam).
   * Invoked on real pipeline events only (a fetched page, a discovered sitemap, a phase change);
   * emission is best-effort: a throwing listener is swallowed and an ABSENT listener leaves the
   * audit byte-identical to the pre-seam behavior. Never used for control flow.
   */
  onProgress?: (activity: CrawlActivity) => void;
}

/** SPEC 04 §2 — real pipeline phases only (never synthetic/timer states). */
export type CrawlPhase = 'crawling' | 'analyzing' | 'grading' | 'persisting';

export type CrawlActivityKind =
  | 'fetch_ok'
  | 'fetch_blocked'
  | 'fetch_dead'
  | 'sitemap_seeded'
  | 'cms_detected'
  | 'finding_preview'
  | 'phase';

/**
 * SPEC 04 §2 — one raw activity emission from the pipeline (engine or worker side). `label` is a
 * plain-language line for the activity feed; it can embed crawled URL paths, so consumers treat it
 * as attacker-controlled text (render inert, bound length).
 */
export interface CrawlActivity {
  kind: CrawlActivityKind;
  label: string;
  /** Real count of pages stored so far (fetch events) — drives the determinate progress. */
  pagesFetched?: number;
  /** Honest sitemap-derived site total (sitemap_seeded only); null/absent = not derivable. */
  estimatedTotal?: number | null;
  /** The phase being entered (kind='phase' only). */
  phase?: CrawlPhase;
}

/**
 * A persisted/streamed activity event: the raw emission stamped by the worker with an ISO time and
 * a per-audit monotonic `seq` — the SSE client's dedup watermark across poll ticks and reconnects.
 */
export interface CrawlActivityEvent extends CrawlActivity {
  at: string;
  seq: number;
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
  /**
   * SPEC 05 (§4): per-page AI-legibility signals extracted at parse time inside the single cheerio
   * parse (main-content class + bounded "What AI Sees" excerpt + machine-legibility signals). Additive
   * observation — never affects the A–F grade. Undefined on pages crawled before SPEC 05.
   */
  aiSignals?: PageAiSignals;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §5 — page classification. Additive: nothing existing changes shape.
// ─────────────────────────────────────────────────────────────────────────────

/** What KIND of page this is. Only `content` is gradeable; everything else is real, just not a page
 *  whose internal-linking quality the grade is entitled to claim it measured. */
export type PageKind =
  | 'content'        // gradeable
  | 'auth'           // login/register/account
  | 'search'         // search-result pages
  | 'pagination'     // /page/2, ?page=
  | 'archive'        // tag/category/date archives
  | 'feed'           // rss/atom/json feeds
  | 'status'         // status/permalink stubs (tweets, short posts)
  | 'utility'        // cart/checkout/print/preview
  | 'duplicate'      // near-duplicate of a representative (§5.4)
  | 'thin';          // real page, too little content to grade

export interface PageClassification {
  kind: PageKind;
  /** `kind === 'content'` and no directive excluded it. THE gradeable-population predicate. */
  gradeable: boolean;
  /** Deterministic, human-readable cause, e.g. 'url_rule:auth' or 'directive:noindex'. Never empty:
   *  an exclusion the user cannot see the reason for is indistinguishable from a bug. */
  reason: string;
  /** §6 stratum key, e.g. '/event/{slug}'. Present from Stage 3; empty string before it. */
  templateKey: string;
  /** 64-bit hex SimHash of the main-content text; null when the text is below the hashing threshold. */
  simhash: string | null;
  /** urlHash of the representative this page duplicates, when `kind === 'duplicate'`. */
  duplicateOf: string | null;
}

/**
 * SPEC 5.1a §7 — COVERAGE ACCOUNTING. Three counts about three different sets, always distinguished.
 *
 * One production report showed 550 / 796 / ~878 side by side with no labelling, which reads as
 * inconsistency to anyone who checks and is indistinguishable from a bug. They were never in
 * conflict — they were answers to three different questions — but nothing said so.
 */
export interface CoverageAccounting {
  /** Every URL fetched, ANY status. Includes blocked and dead fetches: they cost a request. */
  fetched: number;
  /** The graded population: `content` kind, 200, same-origin. The denominator of every grade ratio. */
  gradeable: number;
  /** §7.3 — what was excluded and why, biggest first. Surfaced, never hidden: silently shrinking the
   *  denominator is how a coverage number flatters itself. */
  excluded: { kind: PageKind; count: number }[];
  /** Distinct same-origin URLs the sitemap declared, pre-filter. NULL when no usable sitemap. */
  sitemapDeclared: number | null;
  /**
   * §7.2 — declared in the sitemap, NOT reachable by following links. The orphan signal crawl-only
   * detection cannot see, because sitemap seeding means we fetched the page: it is not missing, it
   * simply has no inbound link. NULL when there is no sitemap — 0 would assert that every declared
   * page is reachable, about a declaration we never received.
   */
  sitemapUnreached: number | null;
  /**
   * §7.2 — declared but disallowed by the owner's own robots.txt. Counted SEPARATELY and never folded
   * into `sitemapUnreached`: the owner chose these, we never fetched them, and so we can claim nothing
   * about their inbound links. Conflating the two turns an ordinary `Disallow: /cart` into a finding
   * against the site.
   */
  sitemapRobotsExcluded: number | null;
  /** Best estimate of site size. NULL when unknowable — never a stand-in figure. */
  estimatedTotal: number | null;
  /** Where `estimatedTotal` came from. A number nobody can check is a number nobody should trust. */
  estimateSource: 'sitemap' | 'frontier' | 'none';
  /** `gradeable / estimatedTotal`, clamped to 1. NULL when the total is unknowable — NOT 1.0, which
   *  would report full coverage on the strength of not being able to see past our own crawl. */
  coverageRatio: number | null;
}

/**
 * SPEC 5.1a §6.7 — the per-audit crawl fingerprint. The artifact that separates "the site changed"
 * from "we sampled differently": identical digest + different grade is an engine defect; a different
 * digest is an explained input change, and the strata table names which sections moved.
 */
export interface CrawlFingerprint {
  version: 1;
  /** URLs discovered, before selection. */
  discoveredCount: number;
  /** URLs actually selected for crawling. */
  selectedCount: number;
  /** Stable hash over the sorted canonical URL set. */
  digest: string;
  strata: { templateKey: string; discovered: number; selected: number }[];
  /** The fixed sampling salt used. Recorded so a future salt change is visible in old audits. */
  seed: string;
  /**
   * SPEC 5.1a §12 — how many strata EXISTED, when the persisted `strata` array was capped at
   * `FINGERPRINT_PERSIST_MAX_STRATA`. Absent on an uncapped fingerprint.
   *
   * Present so a bounded report always states what it withheld: "12 strata moved" read off a silently
   * truncated table is a different claim from the truth, and a table that prints 100 of 4 000 rows
   * without saying so reads as "there were 100".
   */
  strataTotal?: number;
  /** Strata omitted by the persist cap. Absent (not 0) when nothing was withheld. */
  strataWithheld?: number;
  /**
   * SPEC 5.1a §8 — TRUE when discovery hit `MAX_DISCOVERED_URLS` and the discovered set was reduced.
   *
   * SELF-DECLARING BY DESIGN. A capped crawl sampled a different site than an uncapped one would have,
   * and the only dishonest version of that is a silent one: this flag is what lets a reader tell "we
   * saw the whole frontier" from "we saw as much of it as we allow ourselves to". Absent, never false,
   * on an uncapped crawl — so an old fingerprint cannot masquerade as a capped one, or vice versa.
   */
  discoveryCapped?: true;
  /** How many URLs were discovered BEFORE the cap applied. Absent when uncapped. */
  discoveredAtCap?: number;
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
  | 'js_rendered'
  /**
   * SPEC 5.1a §7.2 / D4 — URLs the owner DECLARED in their sitemap that nothing links to. An orphan
   * by the industry-standard definition, and invisible to crawl-only orphan detection: we seed from
   * the sitemap, so the page was fetched and is not "missing" — it simply has no inbound link.
   *
   * This is a LEADING finding, not a caveat. On the acceptance case (freepltn: 1 of 821 declared
   * pages reachable) "820 of the 821 pages in your sitemap can't be reached by following links" is
   * the most useful thing we can tell the owner, and it stays true even when no grade follows.
   */
  | 'sitemap_unreached';

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

/**
 * SPEC 5.1a Stage 4 — the refusal contract.
 *
 * Lives here rather than in the engine because it crosses every boundary the engine does not own: the
 * persisted row, the SSE payload, the minted snapshot, the export. A surface that has to decide whether
 * it may print a letter needs this type, and none of them may depend on the engine.
 */
export type RefusalTrigger =
  /** Below the floor AND the crawl was truncated: we did not read enough of a larger site. */
  | 'too_few_gradeable_pages'
  /**
   * Below the floor AND the crawl COMPLETED: we have the whole site and it is simply too small for
   * an internal-linking measurement to mean anything. Same refusal, different truth — telling a
   * legitimate three-page brochure "we couldn't read enough of your site" is false, and a falsehood
   * in the honesty gate is the worst possible place for one.
   */
  | 'site_too_small_to_measure'
  | 'nothing_read'
  | 'no_observed_links';

export interface RefusalDecision {
  /** True when no letter may be asserted. NOT a failing grade — an absence of one. */
  refused: boolean;
  /** Every trigger that fired, so the explanation is complete rather than first-match. */
  triggers: RefusalTrigger[];
  /**
   * Coverage is unknowable, so confidence may not honestly be reported as high.
   *
   * ⚠ COMPUTED AND PERSISTED, BUT CONSUMED BY NOTHING TODAY. `classifyConfidence` does not read
   * `estimateSource`, so an audit with unknowable coverage still ships `confidence: 'high'` — which
   * is the defect this field names. Acting on it is SPEC 5.1b §9 ("confidence governs, it does not
   * decorate"); recorded here so the field is not mistaken for shipped behaviour, and so the
   * branch's 30.2%-of-audits figure is read correctly: 24.1% change verdict in the shipped product,
   * and the remaining 6.1% is this cap, which does not yet act.
   */
  confidenceCapped: boolean;
  /** Checks that could not be run because the evidence itself is missing. Surfaced, never silent. */
  unevaluable: RefusalTrigger[];
}

export interface AuditResult {
  url: string;
  cms: CmsName;
  cmsConfidence: number;               // 0..1
  cmsMetadata: CmsMetadata;
  pages: Page[];
  links: Link[];
  findings: Finding[];
  score: number | null;                 // 0..100; NULL when the refusal gate withheld a verdict
  grade: string | null;                 // 'A'..'F'; NULL when refused — an ABSENCE, never an F
  breakdown: GradeBreakdown;
  /**
   * SPEC 5.1a Stage 4 — why no letter was asserted. Present on the v2 path; `refused: false` when a
   * verdict was given. When `refused` is true, `score` and `grade` are BOTH null: refusal is an
   * absence of a verdict, never a failing one.
   */
  refusal?: RefusalDecision;
  /** §6 crawl-health/confidence. Present on the v2 engine path; undefined on v1. */
  crawlHealth?: CrawlHealth;
  /**
   * SPEC 5.1a §7 coverage accounting. Present on the v2 path; undefined on v1.
   *
   * SURVIVES A REFUSAL. It describes the evidence we hold, not a verdict about the site, so a refused
   * audit keeps it — on those audits it is most of what we have to offer.
   */
  coverage?: CoverageAccounting;
  /** SPEC 02 §2 confidence band around the point estimate. Present on v2; undefined on v1. */
  confidenceBand?: ConfidenceBand;
  /** SPEC 02 §3 projected-grade ledger (the gap). Present on v2 & not jsRendered; undefined otherwise. */
  projectedGrade?: ProjectedGrade;
  /** SPEC 02 §3-§5 ALL cures (each fix's links + action-packet); the web gates them. Same gating as projectedGrade. */
  prescriptions?: FixPrescription[];
  /** SPEC 02 §4 the one complete free cure (rank-1); null when no prescribable fix exists. Same gating. */
  freeFix?: FreeFix | null;
  /**
   * SPEC 05 §7: the sibling AI/agent-readiness score, assembled additively on the v2 path. A SIBLING of
   * the A–F grade — never blended into it, never re-weighted. Undefined on the legacy v1 path.
   */
  aiReadiness?: AiReadinessScore;
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
  canWhiteLabel: boolean;             // paid (pro or agency): brand your own report (SPEC 04 §5)
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

// ── SPEC 04 §4 — the report snapshot: the FROZEN, FREE artifact the public report renders forever ──
// Written once at mint so a report outlives its audit's 30-day TTL. FREE data ONLY — the ledger is
// diagnosis-only and this shape has NO field for prescriptions / action packets / monitoring (SPEC 02
// gating is STRUCTURAL here, not a runtime filter). Additive; SPEC 05 extends it with its own optional
// section, never mutating these fields.
export interface ReportSnapshotFinding {
  category: FindingCategory;
  severity: Finding['severity'];
  pageUrl?: string;                    // crawled URL — escaped at render (attacker-controlled)
}
export interface ReportSnapshotLedgerItem {
  category: FindingCategory;
  targetUrl: string;
  targetTitle: string | null;
  marginalDelta: number;               // rendered standalone — NEVER summed
  effort: 'low' | 'medium' | 'high';
  rationale: string;
}
export interface PublicReportSnapshot {
  version: number;
  domain: string;
  grade: string;
  score: number;
  cms: string | null;
  mintedAt: string;                    // ISO — the report's "as of" + disclaimer timestamp
  pageCount: number;                   // gradeable pages
  orphanCount: number;
  avgDepth: number | null;
  confidence: Confidence | null;       // crawl-health confidence (null on a v1/legacy audit)
  coveragePct: number | null;
  estimatedTotal: number | null;       // honest "of ~M pages" site total (sitemap/frontier-derived)
  findings: ReportSnapshotFinding[];   // capped per category, payload-stripped
  ledger: ReportSnapshotLedgerItem[];  // the FREE gap ledger — diagnosis only, sorted marginalDelta desc
  ledgerDisclaimer: string;            // "impacts are individual estimates, not additive"
  projected: { grade: string; score: number } | null;  // the achievable grade (null on v1/JS/no-gap)
  /**
   * SPEC 05 §10 (amendment v1.3) — the diagnostic-only AI-readiness projection, denormalized at mint.
   *
   * NOT the raw `AiReadinessScore`: that type's `findings` array is emitted PER PAGE by the assembler, so
   * a 500-page site yields thousands of entries. `public_reports` rows are PERMANENT (they outlive the
   * audit's 30-day TTL) and immutable once minted, so an uncapped copy would freeze a multi-hundred-KB
   * artifact forever — breaking this snapshot's "bounded jsonb" contract and pushing the row past the
   * data-cache ceiling on the viral `/r/` surface. `ReportSnapshotAiReadiness` is therefore a capped,
   * field-whitelisted projection, exactly as `ledger`/`findings` above are rebuilt rather than copied.
   *
   * OPTIONAL, and OMITTED from the object entirely when the audit has no AI data — an explicit `null` is
   * never emitted. That is what keeps a no-AI mint BYTE-IDENTICAL to pre-SPEC-05 output, so SPEC 04's V7
   * determinism pin holds unchanged and `REPORT_SNAPSHOT_VERSION` stays at 1. Reports minted before
   * SPEC 05 simply lack the key, so the report section renders nothing (null-safe, A13).
   */
  aiReadiness?: ReportSnapshotAiReadiness;
}

/**
 * SPEC 05 §10 — one AI finding as frozen into a public report. Field-whitelisted: `id` (an internal
 * diffing hash) and `targetTitle` (never rendered by the report section) are deliberately dropped, so
 * the permanent artifact carries only what a reader actually sees.
 */
export interface ReportSnapshotAiFinding {
  kind: AiFindingKind;
  severity: AiFinding['severity'];
  evidence: AiFinding['evidence'];
  plainLanguage: string;
  targetUrl: string | null;
}

/** SPEC 05 §10 — the bounded AI-readiness projection frozen into `report_snapshot`. */
export interface ReportSnapshotAiReadiness {
  score: number;
  band: AiReadinessScore['band'];
  components: AiReadinessScore['components'];
  confidence: Confidence;
  isEstimate: boolean;
  basis: AiReadinessScore['basis'];
  /** Capped + whitelisted; severity-ordered so the survivors are the ones that matter. */
  findings: ReportSnapshotAiFinding[];
  /**
   * PRE-cap total. The section renders a handful and says how many more exist — deriving that from the
   * capped array would silently under-report, so the honest count is carried explicitly.
   */
  totalFindings: number;
  accessMatrix: AiAccessMatrix;
  llmsTxt: LlmsTxtStatus;
  asOf: string;
}

/**
 * SPEC 04 §5 — white-label branding for a claimed Pro report. Replaces the "Crawlmouse" wordmark on the
 * report page, print/PDF, and OG card with the owner's own brand. `null` on `public_reports.white_label`
 * is the Crawlmouse-branded default (the viral vector). This is owner-mutable PRESENTATION metadata, NOT
 * part of the immutable audit snapshot (§4/§12). The optional logo is a validated image in a
 * service-role storage bucket (§10); `brandName` renders as inert text (never HTML).
 */
export interface WhiteLabelConfig {
  brandName: string;                   // ≤ 60 chars; replaces the Crawlmouse wordmark
  logoPath: string | null;             // storage path of the validated logo; null = text-only brand
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
  /**
   * current − previous. NULL when there is no previous audit, AND whenever either side has no score
   * — SPEC 5.1a Stage 4. A refusal is not a zero, so the difference between a measurement and a
   * withheld verdict is not a decline; computing one printed "Down 81 points since your last visit"
   * for a site we simply stopped grading.
   */
  scoreDelta: number | null;
  gradeFrom: string | null;
  /** NULL when the refusal gate withheld a verdict on the CURRENT audit — an absence, never an F. */
  gradeTo: string | null;
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
  /**
   * NULL when the refusal gate withheld a verdict (SPEC 5.1a Stage 4). A history point is a
   * measurement OR the recorded absence of one — never a 0, which would draw the sparkline diving to
   * the floor and read as a catastrophic decline we never observed.
   */
  score: number | null;
  grade: string | null;
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
  /** NULL when the refusal gate withheld a verdict — never '' and never 0 (SPEC 5.1a Stage 4). */
  currentGrade: string | null;
  currentScore: number | null;
  confidence: Confidence;             // so the dashboard gauge can show estimate vs verdict
  // The "what changed since last visit" payoff — null when there's no previous audit (first audit):
  delta: MonitoringDelta | null;
  history: DashboardSiteHistoryPoint[];  // grade-over-time sparkline (prev→current now; full series = SPEC 06)
  // GATED (Pro owner only): the open-loop fix checklist. null for free/non-owner.
  fixChecklist: DashboardFixChecklistItem[] | null;
  fixChecklistDoneCount: number | null;  // "3 of 7 done" → done = N; total = fixChecklist.length
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 05 — AI / Agent-Readiness Score (Phase 4). A sibling 0–100 score on the SAME static crawl;
// never blended into the A–F linking grade or its weights (§13.1). Value types shared engine↔web
// (§1 "SHARED DATA CONTRACT"). We sell machine-legibility & discoverability, never AI rankings (§2).
// The web-side composite (`ClientAuditV2.aiReadiness`) lives in apps/web/lib/audit-stream-projection.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-page AI-legibility class (§4). The extracted main-content TEXT is the verdict; markers explain. */
export type AiPageClass = 'readable' | 'partial' | 'js_blind' | 'thin';

/** Per-page AI-legibility signals (§4). Extracted at parse time inside the single existing cheerio parse. */
export interface PageAiSignals {
  pageClass: AiPageClass;
  mainTextChars: number;            // main-content text length AFTER density filtering
  /**
   * The page title, BOUNDED at the source (AI_TITLE_MAX_BYTES). The AI feature keeps its own capped
   * copy rather than reading `pages.title`, which is raw crawled text feeding the GRADE path and must
   * not be touched (FU-6). Every AI surface — the simulator, the packets — reads this one.
   */
  title: string | null;
  excerpt: string;                  // bounded (§4.4) post-filter main-content text — the "What AI Sees" view
  csrSignals: string[];             // which affirmative CSR signals fired (annotation, e.g. 'empty_mount:#__next')
  frameworkMarker: string | null;   // 'nextjs' | 'nuxt' | 'react' | ... — EXPLANATION, never a verdict
  hasTitle: boolean;
  hasMetaDescription: boolean;
  h1Count: number;
  headingLevelsSkipped: boolean;
  hasMainLandmark: boolean;         // <main> | <article> | [role="main"]
  /**
   * `types` is the bounded, deduped `@type` list kept for STORAGE. `hasEntityType` is decided by its
   * own unbounded-by-the-storage-cap scan BEFORE truncation, and is the ONLY thing the homepage-entity
   * finding may read — computing it from `types` let a storage cap emit a factually false finding.
   */
  jsonLd: { present: boolean; valid: boolean; types: string[]; hasEntityType: boolean };
}

/** AI crawler class (§3). Opt-out tokens are policy tokens on the operator's crawler, not crawlers. */
export type AiBotClass = 'retrieval' | 'training' | 'opt_out_token';

export interface AiBotAccess {
  token: string;                    // e.g. 'GPTBot'
  operator: string;                 // e.g. 'OpenAI'
  botClass: AiBotClass;
  allowedPageRatio: number;         // 0..1 — fraction of eligible pages this token may fetch per robots
  fullyBlocked: boolean;            // wildcard/site-wide disallow
  note: string;                     // precise plain-language description (opt-out tokens described exactly)
}

export interface AiAccessMatrix {
  bots: AiBotAccess[];
  robotsTxtFound: boolean;          // absent robots ⇒ all allowed, noted
  wafDetected: boolean;             // Cloudflare/known-WAF headers seen — DISCLOSURE ONLY, never scored
  wafNote: string | null;           // "robots.txt allows these bots, but edge-level blocking may override…"
}

/** llms.txt (§8). Informational, ZERO score weight. */
export interface LlmsTxtStatus {
  present: boolean;
  parseable: boolean;               // basic markdown-spec shape check (H1 + link lists)
  note: string;                     // "Not consumed by AI search engines as of 2026; read by coding agents."
}

/** AI findings (§7). Self-contained — NOT FindingCategory entries; zero risk to existing renderers. */
export type AiFindingKind =
  | 'js_blind_page' | 'partial_js_page'
  | 'retrieval_bot_blocked' | 'training_bot_blocked'
  | 'readable_but_orphaned' | 'readable_but_deep'
  | 'missing_structured_data' | 'invalid_structured_data'
  | 'heading_structure' | 'missing_metadata' | 'missing_entity_link'
  | 'thin_page' | 'llms_txt_absent';

export interface AiFinding {
  id: string;                       // STABLE deterministic id: hash(kind + canonical target) — history-ready
  kind: AiFindingKind;
  severity: 'high' | 'medium' | 'info';
  targetUrl: string | null;         // null for site-level findings
  targetTitle: string | null;
  plainLanguage: string;            // client-explainable "what this means / why it matters" (escaped at render)
  evidence: 'strong' | 'moderate' | 'contested' | 'informational';  // the honesty label, rendered
}

/** The score (§7). A SIBLING of the grade — never blended, never re-weighted into it. */
export interface AiReadinessScore {
  score: number;                    // 0..100, deterministic
  band: 'ready' | 'partial' | 'at_risk';   // thresholds in constants (§7)
  components: {
    access: { score: number; weight: 25 };
    contentWithoutJs: { score: number; weight: 40 };
    machineLegibility: { score: number; weight: 20 };
    retrievalPath: { score: number; weight: 15 };
  };
  confidence: Confidence;           // mirrored from crawl-health; low/medium ⇒ estimate framing
  isEstimate: boolean;
  basis: { pagesAnalyzed: number; siteJsRendered: boolean; retrievalPathBasis: 'full' | 'depth_only' };
  findings: AiFinding[];            // the ledger — FREE (diagnosis is never gated). BOUNDED at the write.
  /**
   * Honest PRE-cap finding count. The assembler emits findings per page per issue kind, so this is
   * `basis.pagesAnalyzed`-scaled and the persisted `findings` array above is a bounded slice of it (see
   * AI_PERSIST_MAX_FINDINGS). Optional because the `audits.ai_readiness` jsonb read path is
   * deliberately unvalidated — a row persisted before this field existed must stay null-safe (A13).
   */
  totalFindings?: number;
  accessMatrix: AiAccessMatrix;
  llmsTxt: LlmsTxtStatus;
  asOf: string;                     // ISO — evidence table snapshot date, rendered ("crawler behavior as of…")
}

/**
 * Bound on the findings persisted into `audits.ai_readiness`. THE SOURCE OF TRUTH, and the one that
 * was missed: the mint snapshot (25), the client ledger (100), the packets and the simulator were each
 * capped downstream while the row every one of them reads from stayed unbounded.
 *
 * Measured on the raw score at PRO_PAGE_CAP: 2000 pages ⇒ **6002 findings, 1.90 MB** of jsonb with
 * ordinary 60-char titles, and **31.54 MB** with 5000-char titles — and `targetTitle` is raw crawled
 * text, so that axis is attacker-chosen. (500 pages ⇒ 0.48 MB.)
 *
 * The cut is severity-ordered BUT reserves one finding of every distinct (kind, targeted) class first.
 * That reservation is what keeps the Pro wall honest: packet-buildability is a function of kind plus
 * targetUrl presence, so preserving one representative of each class makes
 * `countBuildablePackets(persisted) > 0` exactly equivalent to the same test on the full ledger. A
 * plain severity cut would silently drop every `missing_structured_data` (severity `info`, and
 * packetable) on a site with 500+ medium findings, and the wall would advertise nothing.
 */
export const AI_PERSIST_MAX_FINDINGS = 500;

/**
 * SPEC 5.1a §6.7/§12 — cap on the strata rows written to `audits.fingerprint`.
 *
 * The strata table is one row per distinct `templateKey`, and NOTHING bounded it. Its size therefore
 * tracked `discoveredCount`, which is the PRE-SELECTION discovered set and so is not bounded by the
 * page cap at all. Measured on the live corpus (2026-08-04): max `discovered_count` = **100 684**, so
 * a site whose URLs share no path structure would have written a ~6 MB jsonb onto ONE audit row.
 *
 * That is the same defect the AI-readiness ledger had, and it is why the cap sits at the WRITE rather
 * than in the engine: the in-memory fingerprint stays complete for the backtest harness's attribution,
 * and only the stored copy is bounded.
 *
 * 100 rows is chosen for the job the table actually does — naming WHICH SECTIONS of a site moved
 * between two crawls. Real sites have tens of templates, not thousands; a site presenting more than
 * 100 distinct templates is one whose "sections" are not meaningful units anyway, and the withheld
 * count is recorded so the truncation is never silent.
 */
export const FINGERPRINT_PERSIST_MAX_STRATA = 100;

/** A single "What AI Sees" page view (§1) — the bounded per-page simulator row. */
export interface WhatAiSeesPage {
  url: string;
  title: string | null;
  pageClass: AiPageClass;
  excerpt: string;
  mainTextChars: number;
}

/**
 * SPEC 05 §9 — bound on the AI findings delivered to the browser. The assembler emits findings PER PAGE,
 * so a 500-page free crawl can produce thousands (hundreds of KB over SSE and into the DOM on the
 * conversion-critical result page, and an unusable list nobody scrolls). Nothing is GATED by this cap —
 * the diagnosis stays free — the count is simply bounded and `AiReadinessClient.totalFindings` reports
 * the honest pre-cap total. Deliberately far more generous than the permanent snapshot's cap, because
 * this surface is the working diagnostic and is re-fetched rather than frozen forever.
 */
export const AI_CLIENT_MAX_FINDINGS = 100;

/**
 * SPEC 05 §9 — bound on the "What AI Sees" rows delivered to the browser. Each row carries a full
 * `EXCERPT_MAX_BYTES` (2000) excerpt and the builder mapped EVERY crawled page: measured at
 * PRO_PAGE_CAP (2000 pages) the gated payload was 4.03 MB of `whatAiSees` inside a 4.14 MB single
 * `event: done` line, on every result-page load, for a PAYING user — then rendered as 2000
 * un-virtualized blocks. The free tier was unaffected, so the conversion spine was safe and the PAID
 * surface was the broken one.
 *
 * Rows are kept WORST-FIRST (js_blind → partial → thin → readable). The simulator exists to show what
 * AI cannot read, so truncating that list url-alphabetically would drop precisely the evidence the
 * customer is paying to see. `AiReadinessClient.whatAiSeesTotalPages` carries the honest pre-cap
 * count, mirroring `totalFindings`.
 */
export const WHAT_AI_SEES_MAX_PAGES = 100;

/**
 * Worst-first ordering for the capped simulator: lower rank survives the cut. Ties break on url
 * ascending, so the selection is deterministic (R1) rather than dependent on crawl order.
 */
export const AI_PAGE_CLASS_SEVERITY: Record<AiPageClass, number> = {
  js_blind: 0,
  partial: 1,
  thin: 2,
  readable: 3,
};

/**
 * Rank for anything that does not appear in a rank map: sorts LAST, and stays FINITE so subtracting two
 * of them yields 0 rather than NaN.
 *
 * THE FINITENESS IS LOAD-BEARING, and two reviewers disagreed about that, so it is pinned by a test.
 * The argument for `Infinity` being equivalent is that ECMA-262 `SortCompare` normalises a NaN
 * comparator RESULT to `+0` — true, but it does not apply here, because `buildWhatAiSees` branches on
 * the subtraction before returning it:
 *
 *     const sev = rankIn(...) - rankIn(...);
 *     return sev !== 0 ? sev : urlTiebreak;      // NaN !== 0 is TRUE
 *
 * With `Infinity`, two unknown classes give `NaN`, `NaN !== 0` takes the first branch, and the
 * deterministic url tie-break is never reached — measured: `a, m, z` becomes `z, m, a`, i.e. crawl
 * order, losing R1 determinism. `MAX_SAFE_INTEGER` yields a true `0` and falls through to the
 * tie-break. Do not "simplify" this to `Infinity`.
 */
export const UNKNOWN_RANK = Number.MAX_SAFE_INTEGER;

/**
 * ONE own-property rank lookup for every AI cap. There were FOUR copies of this ordering — the SSE
 * projection, the report snapshot, the persist helper and the packet builder — and the prototype
 * hardening had been applied to exactly one of them, which is the "fix the instance, not the class"
 * pattern this branch keeps relapsing into. A shared helper means there is one place to be wrong.
 *
 * The guard is not decorative. `severity` and `pageClass` reach three of the four callers out of the
 * deliberately unvalidated `audits.ai_readiness` / `pages.ai_signals` jsonb. A plain index resolves
 * `__proto__`, `constructor`, `toString` and `valueOf` THROUGH THE PROTOTYPE CHAIN to an object or a
 * function, so a `?? fallback` never fires and the comparator returns NaN.
 *
 * PRECISELY what that does, because an earlier version of this comment overstated it: ECMA-262
 * `SortCompare` normalises a NaN comparator result to `+0`, so the poisoned element compares EQUAL to
 * everything it meets. It does not "degrade the sort to input order" — it corrupts the order AROUND
 * itself, and the damage is not confined to the bad element: a reproduction on the report renderer put
 * `info` findings above `high` ones across the whole list. At a cap, that silently evicts real `high`
 * findings. The consequence is what the guard is for; the mechanism is worth stating correctly.
 *
 * Neither field is attacker-writable today (service-role-only writers, closed enums), so this is
 * defense-in-depth on a forward-compatibility path: a future `AiPageClass`/severity member written by a
 * newer worker and read by an older deployment lands here first.
 */
export function ownProp<V>(map: Record<string, V> | Partial<Record<string, V>>, key: unknown): V | undefined {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key)
    ? (map as Record<string, V>)[key]
    : undefined;
}

/** Own-property rank lookup. Unknown (or prototype-derived) keys sort last instead of NaN-ing the sort. */
export function rankIn<T extends Record<string, number>>(map: T, key: unknown): number {
  return ownProp<number>(map, key) ?? UNKNOWN_RANK;
}

/** Severity order for every AI-readiness cap: keep what matters when we cannot keep it all. */
export const AI_FINDING_SEVERITY_RANK: Record<AiFinding['severity'], number> = { high: 0, medium: 1, info: 2 };

/**
 * Client projection (§1) — additive on ClientAuditV2. `score` (full ledger + matrix + llms.txt) and
 * `homepageView` are FREE; `whatAiSees` (all pages) and `aiPackets` are Pro-owner gated, server-populated
 * only in projectAuditForClient and NEVER serialized to a free viewer (§9/§12; A11).
 */
export interface AiReadinessClient {
  /**
   * FREE — full diagnosis, matrix, llms.txt status. `score.findings` is BOUNDED to
   * AI_CLIENT_MAX_FINDINGS: the assembler emits them per page, so an uncapped ledger is hundreds of KB
   * over SSE and into the DOM on the conversion-critical result page. Nothing is GATED by the cap —
   * diagnosis stays free — and `totalFindings` below keeps the count honest.
   */
  score: AiReadinessScore;
  homepageView: WhatAiSeesPage | null;        // FREE — the wow: what AI sees on the homepage
  /**
   * GATED (Pro owner): the whole-site simulator; null for free. BOUNDED to WHAT_AI_SEES_MAX_PAGES,
   * worst-first — see that constant for the measured payload this cap exists to prevent.
   */
  whatAiSees: WhatAiSeesPage[] | null;
  aiPackets: ActionPacket[] | null;           // GATED (Pro owner): deterministic AI-fix packets; null for free
  hasMoreAiPackets: boolean;                  // the wall's SHAPE without leaking the cure
  /** PRE-cap finding count, so the UI can say "showing N of M" rather than under-reporting. */
  totalFindings: number;
  /**
   * PRE-cap count of pages with AI signals, so the capped simulator can say "showing N of M pages"
   * instead of silently implying the site is 100 pages. Viewer-independent: reported even when
   * `whatAiSees` is null, exactly like `hasMoreAiPackets`, so it never doubles as an entitlement flag.
   */
  whatAiSeesTotalPages: number;
}


/**
 * SPEC 5.1a §4 — fewest GRADEABLE pages before we will publish a letter.
 *
 * INSENSITIVE, NOT TUNED. Over 212 production audits: 4 sites at 0 gradeable pages, 28 at exactly 1,
 * 3/2/3 at 2/3/4, 23 at 5–10, 149 above 10. The full gate refuses 46 audits at a floor of 3, 51 at 5
 * and 60 at 8 — every candidate floor in the plausible range catches substantially the same
 * population, because the real signal is "this site has one page of gradeable content" and every
 * floor sees it. That matters when the number is challenged: "we picked 5" invites an argument about
 * 4 or 6, while "every floor between 3 and 8 gives the same answer" ends it. Do not re-tune this in
 * response to a single site; re-measure the distribution instead.
 *
 * IT LIVES IN `types` SO THE COPY CAN READ IT (gate 4 / R1-NB3). The approved body (a) states the
 * floor as a NUMBER and as OUR rule — "Below 5 pages we don't publish a letter" — and both the
 * sentence and its test used to hard-code the 5 while the gate read this constant. Re-tune it and the
 * honesty gate would state a false rule with its own test agreeing: the SPEC 05 "agreement is not
 * correctness" lesson, inside the module written to prevent it. The web layer cannot import the
 * engine (its barrel pulls the crawler into the client bundle), so the shared value sits here and the
 * engine re-exports it.
 */
export const MIN_GRADEABLE_PAGES = 5;
