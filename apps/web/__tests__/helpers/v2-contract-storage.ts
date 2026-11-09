/**
 * How this step stores the v2 contract: which table holds which entity, the one flattened and the one
 * relocated object, which contract rules are CHECKs and which are not, and where enums sit inside
 * jsonb. Declared once, here. v2-contract-guard.test.ts verifies every entry against the contract and
 * the catalog, v2-003-check-tables.test.ts breaks every rule CHECK in each direction, and
 * check-tables-spec.ts renders the lists into docs/specs/v2/06-check-tables.md.
 */

/** Entities this step stores, and their tables. */
export const TABLE_OF: Record<string, string> = {
  Site: 'sites',
  Check: 'checks',
  PageResult: 'page_results',
  LinkEdge: 'link_edges',
  AccessTest: 'access_tests',
  Fix: 'site_fixes',
  FixEvent: 'fix_events',
  Change: 'changes',
  AlertRule: 'alert_rules',
  Report: 'reports',
  MeasurementLineage: 'measurement_lineages',
  UsageEvent: 'usage_events',
};

/** Entities stored elsewhere, and why this guard does not check them. */
export const NOT_THIS_STEP: Record<string, string> = {
  Account: 'CC-01 (accounts); v2-001-entitlement-tables.test.ts',
  Seat: 'CC-01 (seats), except client_scope, which this step stores (checked below)',
  CrawlerRegistryEntry: 'registry seed data; no table',
};

/**
 * Contract fields no column holds yet, each with where it will be stored: none since 006d stored
 * CC-12d's. v2-contract-guard.test.ts leaves each entry out of its column checks, and fails once one
 * is stored under its own name or as flattened columns, so an entry cannot outlive its reason.
 */
export const NOT_STORED_YET: Record<string, string> = {};

/**
 * Values the contract added to an enum that a column's CHECK does not hold yet, by table.column: none
 * since 006d. The guard compares the CHECK with the enum less these, and fails once the CHECK holds
 * one of them.
 */
export const VALUES_NOT_STORED_YET: Record<string, readonly string[]> = {};

/**
 * The same, for the research ledger's enum CHECKs (06b), by table.column in schema `research`: none
 * since 006d. v2-006b-data-foundations.test.ts compares each CHECK with its enum less these, and fails
 * once the CHECK holds one of them.
 */
export const LEDGER_VALUES_NOT_STORED_YET: Record<string, readonly string[]> = {};

/** A contract object stored as `<field>_<key>` columns of the same table. */
export const FLATTENED: Record<string, string> = { 'Site.schedule': 'sites' };
/** A contract object stored as the columns of another table, one row per parent. */
export const RELOCATED: Record<string, string> = { 'Site.client_report': 'report_schedules' };

/**
 * Field shapes of the contract held as CHECKs on page_results (owner ruling 1, 2026-11-02):
 * crawl_worker writes that table straight from the worker, so the database holds the bounds the
 * contract's PageResult states and the column type does not. `exact: true` means the CHECK refuses
 * exactly the values the contract's field schema refuses; otherwise the reason it refuses fewer. A
 * URL CHECK reads the scheme only: it refuses no value the contract accepts, and on values whose URLs
 * all parse it refuses exactly the ones the contract refuses. A field's rules held as their own CHECKs
 * (RULE_CHECKS: redirect_status, robots_verdict and the rest) are not part of its shape.
 * v2-003-rule-agreement.test.ts compares each with the contract over generated values.
 */
export const SHAPE_CHECKS: Record<
  string,
  {
    table: 'page_results';
    field: string;
    exact: true | string;
    /**
     * Set for a database-only column of page_results whose shape is the same-named field of another
     * contract entity: the vantage columns the worker returns on its crawl row and AccessTest
     * declares (CC-06b). The column's writer is the worker's CrawlPage
     * (packages/worker/src/rows/crawl-page.ts), whose fields have AccessTest's shapes today; the step
     * that adds these fields to PageResult replaces the borrowed shape with its own.
     */
    shapeOf?: 'AccessTest';
  }
> = {
  page_results_url: {
    table: 'page_results',
    field: 'url',
    exact:
      'the scheme only: the contract also parses the URL, which Postgres cannot; exact where its URLs parse, and never stricter than the contract',
  },
  page_results_template_key: { table: 'page_results', field: 'template_key', exact: true },
  page_results_status_code: { table: 'page_results', field: 'status_code', exact: true },
  page_results_depth: { table: 'page_results', field: 'depth', exact: true },
  page_results_links_in: { table: 'page_results', field: 'links_in', exact: true },
  page_results_links_out: { table: 'page_results', field: 'links_out', exact: true },
  page_results_pagerank_share: { table: 'page_results', field: 'pagerank_share', exact: true },
  page_results_identity_sent: {
    table: 'page_results',
    field: 'identity_sent',
    exact: true,
    shapeOf: 'AccessTest',
  },
  page_results_request_headers: {
    table: 'page_results',
    field: 'request_headers',
    exact: true,
    shapeOf: 'AccessTest',
  },
  page_results_headers: {
    table: 'page_results',
    field: 'headers',
    exact: true,
    shapeOf: 'AccessTest',
  },
  page_results_sitemap_lastmod: { table: 'page_results', field: 'sitemap_lastmod', exact: true },
  page_results_suggested_parent_url: {
    table: 'page_results',
    field: 'suggested_parent_url',
    exact:
      'the scheme only: the contract also parses the URL, which Postgres cannot; exact where its URLs parse, and never stricter than the contract',
  },
  page_results_without_js: { table: 'page_results', field: 'without_js', exact: true },
  page_results_crawlers_reached: { table: 'page_results', field: 'crawlers_reached', exact: true },
  page_results_crawlers_reading_text: {
    table: 'page_results',
    field: 'crawlers_reading_text',
    exact: true,
  },
  page_results_final_url: {
    table: 'page_results',
    field: 'final_url',
    exact:
      'the scheme only: the contract also parses the URL, which Postgres cannot; exact where its URLs parse, and never stricter than the contract',
  },
  page_results_redirect: {
    table: 'page_results',
    field: 'redirect',
    exact:
      'the URLs inside by scheme only, as page_results_url; exact where its URLs parse, and never stricter than the contract',
  },
  page_results_canonical_declared: {
    table: 'page_results',
    field: 'canonical_declared',
    exact:
      'the URL inside by scheme only, as page_results_url; exact where its URLs parse, and never stricter than the contract',
  },
  page_results_hreflang: {
    table: 'page_results',
    field: 'hreflang',
    exact:
      'the URLs inside by scheme only, as page_results_url; exact where its URLs parse, and never stricter than the contract',
  },
  page_results_content_simhash: { table: 'page_results', field: 'content_simhash', exact: true },
  page_results_robots_search: { table: 'page_results', field: 'robots_search', exact: true },
  // Its value set is an enum CHECK; this one refuses an array of arrays, which `<@` accepts.
  page_results_content_failures: {
    table: 'page_results',
    field: 'content_failures',
    exact: 'with the column’s enum CHECK, which refuses an unknown value; exact over known values',
  },
  // 006d. Whether text and chars agree is the head_text_absent rule CHECK's.
  page_results_title: { table: 'page_results', field: 'title', exact: true },
  page_results_meta_description: { table: 'page_results', field: 'meta_description', exact: true },
};

/** Rules that are CHECK constraints: the table and the constraint. */
export const RULE_CHECKS: Record<string, { table: string; constraint: string }> = {
  schedule_timed: { table: 'sites', constraint: 'sites_schedule_timed' },
  schedule_pair: { table: 'sites', constraint: 'sites_schedule_pair' },
  unkept_audit: { table: 'sites', constraint: 'sites_unkept_audit' },
  client_report_cadence: {
    table: 'report_schedules',
    constraint: 'report_schedules_client_report_cadence',
  },
  check_progress: { table: 'checks', constraint: 'checks_progress' },
  check_not_started: { table: 'checks', constraint: 'checks_not_started' },
  check_started: { table: 'checks', constraint: 'checks_started' },
  check_finished_at: { table: 'checks', constraint: 'checks_finished_at' },
  check_deferred_until: { table: 'checks', constraint: 'checks_deferred_until' },
  check_failure_reason: { table: 'checks', constraint: 'checks_failure_reason' },
  check_coverage: { table: 'checks', constraint: 'checks_coverage' },
  check_both_grades: { table: 'checks', constraint: 'checks_both_grades' },
  check_grades_when_ended: { table: 'checks', constraint: 'checks_grades_when_ended' },
  observed_owner_logs: { table: 'access_tests', constraint: 'access_tests_observed_owner_logs' },
  fix_last_state: { table: 'site_fixes', constraint: 'site_fixes_last_state' },
  fix_rank: { table: 'site_fixes', constraint: 'site_fixes_rank' },
  packet_framework: { table: 'site_fixes', constraint: 'site_fixes_packet_framework' },
  effect_pending: { table: 'site_fixes', constraint: 'site_fixes_effect_pending' },
  alert_threshold: { table: 'alert_rules', constraint: 'alert_rules_threshold' },
  alert_fired_pair: { table: 'alert_rules', constraint: 'alert_rules_fired_pair' },
  report_sent: { table: 'reports', constraint: 'reports_sent' },
  report_send_time: { table: 'reports', constraint: 'reports_send_time' },
  report_slug: { table: 'reports', constraint: 'reports_slug' },
  report_open_tracking: { table: 'reports', constraint: 'reports_open_tracking' },
  fix_gone: { table: 'site_fixes', constraint: 'site_fixes_gone' },
  // CC-17's two effect rules, CHECKs since 006c.
  effect_seo_pending: { table: 'site_fixes', constraint: 'site_fixes_effect_seo_pending' },
  effect_absorbed: { table: 'site_fixes', constraint: 'site_fixes_effect_absorbed' },
  access_request_line: { table: 'access_tests', constraint: 'access_tests_request_line' },
  change_severity: { table: 'changes', constraint: 'changes_severity' },
  change_resolved_info: { table: 'changes', constraint: 'changes_resolved_info' },
  // page_results' rules, inside jsonb included: crawl_worker writes that table (owner ruling 1).
  links_read_html: { table: 'page_results', constraint: 'page_results_links_read_html' },
  redirect_status: { table: 'page_results', constraint: 'page_results_redirect_status' },
  redirect_loop: { table: 'page_results', constraint: 'page_results_redirect_loop' },
  canonical_href: { table: 'page_results', constraint: 'page_results_canonical_href' },
  robots_verdict: { table: 'page_results', constraint: 'page_results_robots_verdict' },
  robots_ua_unique: { table: 'page_results', constraint: 'page_results_robots_ua_unique' },
  head_text_absent: { table: 'page_results', constraint: 'page_results_head_text_absent' },
  usage_billable: { table: 'usage_events', constraint: 'usage_events_billable' },
};

/**
 * Database-only columns the database computes with the contract's status functions
 * (packages/types/src/v2/measurement.ts), so no writer can store a value that disagrees.
 * v2-006b-data-foundations.test.ts compares each expression with its function over every input that
 * decides it, and v2-003-contract-fixtures.test.ts over the fixtures.
 */
export const GENERATED_STATUS: Record<string, string> = {
  'checks.technical_seo_status': 'technicalSeoStatus',
  'checks.ai_readability_status': 'aiReadabilityStatus',
  'access_tests.measurement_status': 'verdictStatus',
};

const ACCESS_ROW_AT_WRITE =
  'an access_tests row: only the server writes that table, through persist_built_check after the pipeline parses the row with AccessTestSchema; a CHECK only where the owner rules one (2026-11-08)';

/**
 * Rules the database does not check, with the reason: those reading inside a jsonb document of a table
 * only the server writes (owner ruling 1, 2026-11-02), the value shapes (a reason that starts "a value
 * shape"), and the rules of an access_tests row (a reason that starts "an access_tests row"). A writer
 * must parse the row with the contract's schema before inserting it.
 */
export const RULES_AT_WRITE: Record<string, string> = {
  check_result_link: 'compares two timestamps inside checks.result_email',
  i4_withheld: 'counts measured crawlers across checks.crawlers',
  coverage_gradeable: 'sums an array inside checks.coverage',
  coverage_crawled: 'compares two counts inside checks.coverage',
  coverage_sampled: 'compares counts inside checks.coverage',
  crawler_scored: 'per element of checks.crawlers',
  score_grade_pair: 'inside checks.technical_seo and checks.ai_readability',
  refusal_score: 'inside checks.technical_seo',
  total_sum: 'sums inside checks.ai_readability',
  withheld_reasons: 'inside checks.ai_readability',
  component_range: 'per component inside checks.ai_readability',
  range_order: 'per component inside checks.ai_readability',
  access_range_mirror: 'compares two objects inside checks.ai_readability',
  withheld_unmeasured: 'reads every component inside checks.ai_readability',
  withheld_reasons_match: 'compares the reasons with the components inside checks.ai_readability',
  fewer_crawlers: 'reads the Access component inside checks.ai_readability',
  content_score_withheld: 'compares two fields inside checks.content',
  time_zone:
    'a value shape: report_schedules.timezone is text; Postgres cannot check a name against the Intl zone list the contract uses',
  coverage_robots: 'compares counts inside checks.coverage',
  packet_bodies: 'per element of site_fixes.packet.packets',
  page_gone_status: 'inside site_fixes.gone',
  change_baseline: 'reads changes.grade_deltas, a jsonb array, with subject and fix_id',
  crawled_text_budget:
    'a value shape: the UTF-8 byte budget of crawled text (link_edges.anchor_text, access_tests.identity_sent and body_excerpt, and inside jsonb; inside page_results’ jsonb, the shape CHECKs hold it)',
  crawled_text_surrogate:
    'a value shape on crawled text; the writer cuts text with the engine’s toPersistableText (packages/engine/src/text-safety.ts)',
  // AccessTest's CC-12d rules (006d). access_tests is written only by persist_built_check (008),
  // after the pipeline parses each row with AccessTestSchema (apps/web/lib/v2/pipeline/persist.ts).
  access_identity_ua: ACCESS_ROW_AT_WRITE,
  control_untagged: ACCESS_ROW_AT_WRITE,
  access_witness: ACCESS_ROW_AT_WRITE,
  witness_other: ACCESS_ROW_AT_WRITE,
  fly_region: ACCESS_ROW_AT_WRITE,
  timing_order: ACCESS_ROW_AT_WRITE,
  worker_request: ACCESS_ROW_AT_WRITE,
  worker_request_whole: ACCESS_ROW_AT_WRITE,
};

/** Rules of entities or primitives this step does not store. */
export const RULES_NOT_THIS_STEP: Record<string, string> = {
  cloudflare_unique: 'crawler registry (no table)',
  declaration_answer: 'worker batch result (no table)',
  declaration_bytes: 'worker batch result (no table)',
  declaration_media_type: 'worker batch result (no table)',
  declaration_cache_answer: 'worker batch result (no table)',
  declaration_not_requested: 'worker batch result (no table)',
  robots_body: 'worker batch result (no table)',
  billing_period: 'Account (CC-01)',
  history_current: 'Account (CC-01)',
  history_forward: 'Account (CC-01)',
  trial_consent: 'Account (CC-01)',
  trial_ends: 'Account (CC-01)',
  branding_dns: 'Account branding (CC-01)',
  branding_email_auth: 'Account branding (CC-01)',
  branding_postal: 'Account branding (CC-01)',
  verification_alone: 'crawler registry (no table)',
  verification_unique: 'crawler registry (no table)',
  ip_list_url: 'crawler registry (no table)',
};

/** Enums that occur inside a jsonb column, by enum id: the columns, sorted. Enforced at write. */
export const NESTED: Record<string, string[]> = {
  AccessCause: ['checks.crawlers'],
  CheckPhase: ['checks.progress'],
  Channel: ['changes.notified'],
  CmsName: ['checks.stack'],
  Confidence: ['checks.crawlers'],
  ContentCheck: ['checks.content'],
  ContentScoreWithheld: ['checks.content'],
  CrawlerGroup: ['checks.crawlers'],
  DetectionState: ['checks.signals'],
  EstimateBound: ['site_fixes.before_after'],
  EvidenceClass: ['checks.crawlers'],
  FixMeasure: ['site_fixes.before_after'],
  GradeLetter: [
    'changes.grade_deltas',
    'checks.ai_readability',
    'checks.competitors',
    'checks.technical_seo',
  ],
  GradeName: ['changes.grade_deltas'],
  JsTextState: ['page_results.without_js'],
  PacketFramework: ['checks.stack', 'site_fixes.packet'],
  PageKind: ['checks.coverage'],
  RecommendationClass: ['checks.signals'],
  RefusalTrigger: ['checks.technical_seo'],
  SampleMethod: ['checks.coverage'],
  SignalKind: ['checks.signals'],
  StepState: ['checks.progress'],
  TechnicalSeoPending: ['site_fixes.effect'],
  Verdict: ['checks.crawlers', 'page_results.robots_search'],
  WithheldReason: ['checks.ai_readability', 'site_fixes.effect'],
  WitnessRole: ['access_tests.witness'],
};

/** Enums no table of this step holds, and where they live. */
export const NOT_STORED_HERE: Record<string, string> = {
  CloudflareCategory: 'crawler registry seed data',
  BatchPartialReason: 'worker batch result (no table)',
  DeclarationPath: 'worker batch result (no table)',
  DeclarationState: 'worker batch result (no table)',
  DeclarationNotRequested: 'worker batch result (no table)',
  AccountState: 'accounts.state (CC-01)',
  SeatRole: 'seats.role (CC-01)',
  Theme: 'seats.theme (CC-01)',
  IntegrationKind: 'Account.integrations; the integrations table is a later step',
  VerificationMethod: 'crawler registry seed data',
  WithheldCollection: 'fixture metadata',
  MeasurementStatus:
    'no contract field holds it; computed into database-only generated columns (GENERATED_STATUS, 06b)',
};
