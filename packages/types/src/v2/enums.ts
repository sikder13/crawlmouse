/**
 * Every enum in the v2 contract.
 *
 * Every enum is created through `named()`, which records it in ALL_V2_ENUMS. The groups below, and the
 * contract test checks that each entry of ALL_V2_ENUMS belongs to exactly one of them:
 *   - V2_FIXTURE_ENUMS: owned by v2; every value must appear in at least one fixture.
 *   - V1_PINNED_ENUMS: value sets v1 or the engine already define. Reused, pinned to the v1 type
 *     (v1-pins.test.ts) or to the engine (packages/engine/src/v2), and not re-covered by fixtures.
 *   - REGISTRY_ONLY_ENUMS: used only by crawler-registry seed data, which is not fixture data.
 *   - DERIVED_ENUMS: values the contract's functions compute from other fields (measurement.ts); no
 *     field holds them, and the database stores them in generated columns. Every value must be
 *     produced by those functions over the fixtures.
 *   - BATCH_RESULT_ENUMS: values of a worker batch result, which is not fixture data; pinned to the
 *     worker's tests.
 */
import { z } from 'zod';
import { v2Registry } from './registry.js';

const recorded: z.ZodEnum[] = [];

function named<T extends z.ZodEnum>(id: string, schema: T): T {
  (schema as z.ZodEnum).register(v2Registry, { id });
  recorded.push(schema as z.ZodEnum);
  return schema;
}

// ─── The nine enums the CC-11 brief requires, with exactly its values ─────────────────────────

/** FACTS I2. "Blocked" is used only for disallowed_by_robots and blocked_by_ua_rule. */
export const VerdictSchema = named(
  'Verdict',
  z.enum([
    'allowed',
    'allowed_thin',
    'disallowed_by_robots',
    'blocked_by_ua_rule',
    'challenged_ua',
    'refused_unverified',
    'rate_limited',
    'payment_required',
    'edge_blocks_automation',
    'redirected_away',
    'not_measured',
  ]),
);
/** What kind of evidence a verdict rests on: robots.txt, our own request, or the owner's logs. */
export const EvidenceClassSchema = named(
  'EvidenceClass',
  z.enum(['declared', 'simulated', 'observed']),
);
export const CrawlerGroupSchema = named(
  'CrawlerGroup',
  z.enum(['search_engine', 'ai_search', 'ai_training']),
);
export const DetectionStateSchema = named(
  'DetectionState',
  z.enum(['detected', 'not_detected', 'indeterminate']),
);
export const FixStatusSchema = named(
  'FixStatus',
  z.enum(['open', 'marked_done', 'verified_resolved', 'unable_to_verify', 'reopened']),
);
export const RecommendationClassSchema = named(
  'RecommendationClass',
  z.enum(['confirmed_defect', 'documented_requirement', 'best_practice', 'experimental']),
);
export const CheckStatusSchema = named(
  'CheckStatus',
  z.enum(['queued', 'running', 'finished', 'partial', 'failed', 'deferred']),
);
export const AccountStateSchema = named(
  'AccountState',
  z.enum(['free', 'pro_trial', 'pro', 'agency_trial', 'agency', 'past_due']),
);
export const ConfidenceSchema = named(
  'Confidence',
  z.enum(['confirmed', 'likely', 'inconclusive']),
);

// ─── Named by the brief inside an entity ───────────────────────────────────────────────────────

/**
 * Where a request came from. `fly_egress`: a worker on a Fly Machine. `other_egress`: a worker
 * anywhere else (a developer's machine, CI), whose address says nothing about Fly's.
 */
export const SourceIpClassSchema = named(
  'SourceIpClass',
  z.enum(['fly_egress', 'browser_rendering', 'owner_logs', 'other_egress']),
);
export const VerificationMethodSchema = named(
  'VerificationMethod',
  z.enum(['ip_list', 'reverse_dns', 'none_published']),
);

// ─── Added for the screens ─────────────────────────────────────────────────────────────────────

export const GradeNameSchema = named('GradeName', z.enum(['technical_seo', 'ai_readability']));
/** The audit sections a fix belongs to. Signals and Changes add no fixes (FACTS B5). */
export const FixSectionSchema = named(
  'FixSection',
  z.enum(['crawler_access', 'without_js', 'structure', 'content']),
);
export const FixTypeSchema = named(
  'FixType',
  z.enum([
    'robots_txt_blocks_crawler',
    'edge_rule_blocks_crawler',
    'client_rendered_template',
    'orphan_pages',
    'quotable_opening',
    'generic_anchor_text',
    'deep_pages',
    'specs_as_images',
    'missing_author_date',
    'js_only_navigation',
    'redirect_chain',
    'duplicate_pagination',
    'canonical_mismatch',
    'hreflang_gap',
  ]),
);
/** The before/after rows on the fix page. */
export const FixMeasureSchema = named(
  'FixMeasure',
  z.enum(['words_without_js', 'crawlers_reading_text', 'quotable_opening', 'text_share']),
);
/** How an estimated "after" value reads: "4 of 6", "≈ 1,100", "≥ 90%". */
export const EstimateBoundSchema = named('EstimateBound', z.enum(['exact', 'approx', 'at_least']));
/** FACTS I12: the stacks a fix packet is written for. */
export const PacketFrameworkSchema = named(
  'PacketFramework',
  z.enum(['nextjs', 'shopify_liquid', 'shopify_hydrogen', 'wordpress', 'webflow', 'generic']),
);
export const CheckTriggerSchema = named(
  'CheckTrigger',
  z.enum(['first_audit', 'manual', 'scheduled', 'deploy', 'fix_recheck']),
);
/** The steps on the crawl-in-progress screen. */
export const CheckPhaseSchema = named(
  'CheckPhase',
  z.enum(['robots_and_sitemap', 'homepage', 'crawl', 'crawler_tests', 'without_js', 'grading']),
);
export const StepStateSchema = named('StepState', z.enum(['done', 'now', 'next']));
export const SampleMethodSchema = named(
  'SampleMethod',
  z.enum(['stratified_by_template', 'census']),
);
/** Why a crawler got what it got. `cloudflare_1020` is the FACTS Developers JSON value. */
export const AccessCauseSchema = named(
  'AccessCause',
  z.enum([
    'cloudflare_1020',
    'bot_fight_mode',
    'client_rendered_template',
    'robots_txt_disallow',
    'automation_challenge',
    'rate_limit_429',
    'pay_per_crawl_402',
    'cross_host_redirect',
    'verified_bot_only',
  ]),
);
export const SignalKindSchema = named(
  'SignalKind',
  z.enum([
    'schema_org',
    'content_signals',
    'web_bot_auth',
    'llms_txt',
    'mcp_server_card',
    'markdown_negotiation',
    'agent_skills_index',
    // Declarations the worker requests by path (CC-12d): presence only, zero weight.
    'ucp',
    'rsl',
    'agent_card',
    'llms_full',
  ]),
);
export const ContentCheckSchema = named(
  'ContentCheck',
  z.enum([
    'direct_answer_150',
    'question_headings',
    'schema_with_description',
    'author_and_date',
    'specs_as_text',
  ]),
);
export const JsTextStateSchema = named(
  'JsTextState',
  z.enum(['readable', 'partial', 'empty_shell']),
);
export const FoundViaSchema = named('FoundVia', z.enum(['link', 'sitemap', 'javascript']));
export const CadenceSchema = named('Cadence', z.enum(['weekly', 'monthly', 'on_deploy']));
/** `baseline`: grading changed between the two checks, so nothing else was compared. */
export const ChangeKindSchema = named(
  'ChangeKind',
  z.enum(['opened', 'resolved', 'changed', 'baseline']),
);
/** How loud a change is for alerts (ARCH-2 §4.5); the engine's `severityOf` decides it. */
export const SeveritySchema = named('Severity', z.enum(['bad', 'warn', 'info']));
export const ChangeSubjectSchema = named(
  'ChangeSubject',
  z.enum([
    'crawler_access',
    'text_without_js',
    'grade',
    'orphans',
    'content',
    'structure',
    'deploy',
  ]),
);
export const ChannelSchema = named('Channel', z.enum(['email', 'slack']));
/** The six rules on the Alerts and Site screens. */
export const AlertRuleKindSchema = named(
  'AlertRuleKind',
  z.enum([
    'crawler_blocked',
    'text_drop',
    'grade_letter_moved',
    'new_orphans',
    'fix_regressed',
    'any_change',
  ]),
);
export const ReportKindSchema = named(
  'ReportKind',
  z.enum([
    'audit_pdf',
    'compare',
    'raw_export',
    'public_link',
    'client_report',
    'prospect_one_pager',
  ]),
);
export const ReportFormatSchema = named(
  'ReportFormat',
  z.enum(['pdf', 'csv', 'json', 'edge_list', 'html']),
);
export const ReportStatusSchema = named(
  'ReportStatus',
  z.enum(['ready', 'scheduled', 'held', 'sent']),
);
export const ReportMakerSchema = named(
  'ReportMaker',
  z.enum(['user', 'scheduled_check', 'report_schedule']),
);
export const SeatRoleSchema = named('SeatRole', z.enum(['owner', 'account_manager', 'developer']));
export const ThemeSchema = named('Theme', z.enum(['system', 'light', 'dark']));
export const IntegrationKindSchema = named(
  'IntegrationKind',
  z.enum(['slack', 'search_console', 'vercel', 'cloudflare_analytics', 'vercel_drain']),
);
/**
 * What a scored measurement asserts (CC-06b). `measured`: observed and asserted. `not_measurable`: we
 * tried and the site or our method prevented the observation. `unevaluable`: no usable observation
 * exists to decide from. `withheld`: observed, and declined because the evidence cannot support a
 * value. The mapping from the contract's other states is in measurement.ts.
 */
export const MeasurementStatusSchema = named(
  'MeasurementStatus',
  z.enum(['measured', 'not_measurable', 'unevaluable', 'withheld']),
);
/** What a usage event records the delivery of. */
export const UsageKindSchema = named('UsageKind', z.enum(['check_finished', 'export', 'api_call']));
/** How a metered request ended; only `delivered` can be billable. */
export const UsageResultSchema = named(
  'UsageResult',
  z.enum(['delivered', 'refused', 'withheld', 'failed']),
);
/** Which collection a fixture's `withheld` entry describes. */
export const WithheldCollectionSchema = named(
  'WithheldCollection',
  z.enum(['page_results', 'link_edges', 'access_tests']),
);

// ─── The identity and vantage of a request (CC-12d) ────────────────────────────────────────────

/**
 * Who an access row is: the browser control, a crawler the verdict is about, the tagged Googlebot
 * canary, or a browser render of the page (CC-14). Only a `crawler` row names a crawler (`ua`).
 */
export const IdentityRoleSchema = named(
  'IdentityRole',
  z.enum(['control', 'crawler', 'canary', 'render']),
);
/** The identity whose being served on the same page made a refusal a user-agent rule. */
export const WitnessRoleSchema = named('WitnessRole', z.enum(['crawler', 'canary']));
/** Whether the request was signed (Web Bot Auth). Every request is unsigned today. */
export const RequestSigningSchema = named('RequestSigning', z.enum(['unsigned']));
/** Whether the site verified a signature. Not observable from outside today. */
export const SignatureVerificationSchema = named(
  'SignatureVerification',
  z.enum(['not_observable']),
);
/** Cloudflare's own categories for a crawler (Radar's bots directory); a crawler may have several. */
export const CloudflareCategorySchema = named(
  'CloudflareCategory',
  z.enum(['search', 'agent', 'training']),
);
/** Why a worker batch did less than it was asked (the batch result's `partial.reasons`). */
export const BatchPartialReasonSchema = named(
  'BatchPartialReason',
  z.enum([
    'budget_requests',
    'budget_bytes',
    'budget_seconds',
    'site_stopped',
    'robots_unreachable',
    'robots_too_large',
    'site_refused',
    'crawl_delay_over_limit',
    'crawl_delay_10s_or_more',
    'result_size',
  ]),
);
/** The declaration files a crawl batch requests, once per site (CC-12d; CC-15's follow-up list). */
export const DeclarationPathSchema = named(
  'DeclarationPath',
  z.enum([
    '/llms.txt',
    '/llms-full.txt',
    '/.well-known/ucp',
    '/.well-known/mcp',
    '/.well-known/agent-card.json',
    '/rsl.xml',
    '/sitemap.xml',
  ]),
);
/** What became of one declaration request: an answer, none (the request failed), or not made. */
export const DeclarationStateSchema = named(
  'DeclarationState',
  z.enum(['answered', 'no_response', 'not_requested']),
);
/** Why a declaration was not requested. */
export const DeclarationNotRequestedSchema = named(
  'DeclarationNotRequested',
  z.enum(['robots_disallowed', 'budget', 'site_stopped', 'site_blocked']),
);

// ─── Reused value sets (pinned, not re-covered) ────────────────────────────────────────────────

/** The engine's letter scale, `scoreToLetter` in packages/engine/src/grade.ts. Pinned by the engine. */
export const GradeLetterSchema = named(
  'GradeLetter',
  z.enum(['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']),
);
/** v1 `PageKind` (packages/types/src/audit.ts). */
export const PageKindSchema = named(
  'PageKind',
  z.enum([
    'content',
    'auth',
    'search',
    'pagination',
    'archive',
    'feed',
    'status',
    'utility',
    'duplicate',
    'thin',
  ]),
);
/** v1 `CmsName`. */
export const CmsNameSchema = named(
  'CmsName',
  z.enum(['shopify', 'wordpress', 'webflow', 'wix', 'squarespace', 'framer', 'ghost', 'custom']),
);
/** v1 `RefusalTrigger`. */
export const RefusalTriggerSchema = named(
  'RefusalTrigger',
  z.enum([
    'too_few_gradeable_pages',
    'site_too_small_to_measure',
    'too_few_gradeable_after_exclusion',
    'nothing_read',
    'no_observed_links',
  ]),
);

export const V2_FIXTURE_ENUMS = {
  Verdict: VerdictSchema,
  EvidenceClass: EvidenceClassSchema,
  CrawlerGroup: CrawlerGroupSchema,
  DetectionState: DetectionStateSchema,
  FixStatus: FixStatusSchema,
  RecommendationClass: RecommendationClassSchema,
  CheckStatus: CheckStatusSchema,
  AccountState: AccountStateSchema,
  Confidence: ConfidenceSchema,
  SourceIpClass: SourceIpClassSchema,
  GradeName: GradeNameSchema,
  FixSection: FixSectionSchema,
  FixType: FixTypeSchema,
  FixMeasure: FixMeasureSchema,
  EstimateBound: EstimateBoundSchema,
  PacketFramework: PacketFrameworkSchema,
  CheckTrigger: CheckTriggerSchema,
  CheckPhase: CheckPhaseSchema,
  StepState: StepStateSchema,
  SampleMethod: SampleMethodSchema,
  AccessCause: AccessCauseSchema,
  SignalKind: SignalKindSchema,
  ContentCheck: ContentCheckSchema,
  JsTextState: JsTextStateSchema,
  FoundVia: FoundViaSchema,
  Cadence: CadenceSchema,
  ChangeKind: ChangeKindSchema,
  ChangeSubject: ChangeSubjectSchema,
  Severity: SeveritySchema,
  Channel: ChannelSchema,
  AlertRuleKind: AlertRuleKindSchema,
  ReportKind: ReportKindSchema,
  ReportFormat: ReportFormatSchema,
  ReportStatus: ReportStatusSchema,
  ReportMaker: ReportMakerSchema,
  SeatRole: SeatRoleSchema,
  Theme: ThemeSchema,
  IntegrationKind: IntegrationKindSchema,
  WithheldCollection: WithheldCollectionSchema,
  UsageKind: UsageKindSchema,
  UsageResult: UsageResultSchema,
  IdentityRole: IdentityRoleSchema,
  WitnessRole: WitnessRoleSchema,
  RequestSigning: RequestSigningSchema,
  SignatureVerification: SignatureVerificationSchema,
} as const;

export const V1_PINNED_ENUMS = {
  GradeLetter: GradeLetterSchema,
  PageKind: PageKindSchema,
  CmsName: CmsNameSchema,
  RefusalTrigger: RefusalTriggerSchema,
} as const;

export const REGISTRY_ONLY_ENUMS = {
  VerificationMethod: VerificationMethodSchema,
  CloudflareCategory: CloudflareCategorySchema,
} as const;

/**
 * Values of a worker batch result, which is not fixture data. Each is pinned to the worker
 * (packages/worker/src/batch/partial-reasons.test.ts, declarations.test.ts).
 */
export const BATCH_RESULT_ENUMS = {
  BatchPartialReason: BatchPartialReasonSchema,
  DeclarationPath: DeclarationPathSchema,
  DeclarationState: DeclarationStateSchema,
  DeclarationNotRequested: DeclarationNotRequestedSchema,
} as const;

export const DERIVED_ENUMS = {
  MeasurementStatus: MeasurementStatusSchema,
} as const;

export type Verdict = z.infer<typeof VerdictSchema>;
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;
export type CrawlerGroup = z.infer<typeof CrawlerGroupSchema>;
export type DetectionState = z.infer<typeof DetectionStateSchema>;
export type FixStatus = z.infer<typeof FixStatusSchema>;
export type RecommendationClass = z.infer<typeof RecommendationClassSchema>;
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type AccountState = z.infer<typeof AccountStateSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type SourceIpClass = z.infer<typeof SourceIpClassSchema>;
export type IdentityRole = z.infer<typeof IdentityRoleSchema>;
export type WitnessRole = z.infer<typeof WitnessRoleSchema>;
export type CloudflareCategory = z.infer<typeof CloudflareCategorySchema>;
export type BatchPartialReason = z.infer<typeof BatchPartialReasonSchema>;
export type DeclarationPath = z.infer<typeof DeclarationPathSchema>;
export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;
export type GradeName = z.infer<typeof GradeNameSchema>;
export type GradeLetter = z.infer<typeof GradeLetterSchema>;
export type FixSection = z.infer<typeof FixSectionSchema>;
export type FixType = z.infer<typeof FixTypeSchema>;
export type AccessCause = z.infer<typeof AccessCauseSchema>;
export type SignalKind = z.infer<typeof SignalKindSchema>;
export type ContentCheck = z.infer<typeof ContentCheckSchema>;
export type AlertRuleKind = z.infer<typeof AlertRuleKindSchema>;
export type ReportKind = z.infer<typeof ReportKindSchema>;
export type SeatRole = z.infer<typeof SeatRoleSchema>;
export type ChangeKind = z.infer<typeof ChangeKindSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type MeasurementStatus = z.infer<typeof MeasurementStatusSchema>;
export type UsageKind = z.infer<typeof UsageKindSchema>;
export type UsageResult = z.infer<typeof UsageResultSchema>;

/** Every enum this module defined, in definition order, whichever group it was put in. */
export const ALL_V2_ENUMS: readonly z.ZodEnum[] = recorded;
