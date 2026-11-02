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
};

/** Entities stored elsewhere, and why this guard does not check them. */
export const NOT_THIS_STEP: Record<string, string> = {
  Account: 'CC-01 (accounts); v2-001-entitlement-tables.test.ts',
  Seat: 'CC-01 (seats), except client_scope, which this step stores (checked below)',
  CrawlerRegistryEntry: 'registry seed data; no table',
};

/** A contract object stored as `<field>_<key>` columns of the same table. */
export const FLATTENED: Record<string, string> = { 'Site.schedule': 'sites' };
/** A contract object stored as the columns of another table, one row per parent. */
export const RELOCATED: Record<string, string> = { 'Site.client_report': 'report_schedules' };

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
};

/**
 * Rules the database does not check, with the reason. Each reads inside a jsonb document whose shape
 * the database does not validate (owner default 1, 2026-11-02, extended from nested enums to these
 * nested rules; see the spec's open questions). A writer must parse the row with the contract's
 * schema before inserting it.
 */
export const RULES_AT_WRITE: Record<string, string> = {
  check_result_link: 'compares two timestamps inside checks.result_email',
  i4_withheld: 'counts measured crawlers across checks.crawlers',
  i4_given: 'counts measured crawlers across checks.crawlers',
  coverage_gradeable: 'sums an array inside checks.coverage',
  coverage_crawled: 'compares two counts inside checks.coverage',
  coverage_sampled: 'compares counts inside checks.coverage',
  crawler_scored: 'per element of checks.crawlers',
  score_grade_pair: 'inside checks.technical_seo and checks.ai_readability',
  refusal_score: 'inside checks.technical_seo',
  access_range_order: 'inside checks.ai_readability',
  total_sum: 'sums inside checks.ai_readability',
};

/** Rules of entities or primitives this step does not store. */
export const RULES_NOT_THIS_STEP: Record<string, string> = {
  billing_period: 'Account (CC-01)',
  history_current: 'Account (CC-01)',
  history_forward: 'Account (CC-01)',
  trial_consent: 'Account (CC-01)',
  trial_ends: 'Account (CC-01)',
  branding_dns: 'Account branding (CC-01)',
  branding_email_auth: 'Account branding (CC-01)',
  branding_postal: 'Account branding (CC-01)',
  time_zone: 'a value shape, enforced at write',
  crawled_text_budget: 'a value shape, enforced at write',
  crawled_text_surrogate: 'a value shape, enforced at write',
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
  PacketFramework: ['site_fixes.packet'],
  PageKind: ['checks.coverage'],
  RefusalTrigger: ['checks.technical_seo'],
  SampleMethod: ['checks.coverage'],
  SignalKind: ['checks.signals'],
  StepState: ['checks.progress'],
  Verdict: ['checks.crawlers'],
};

/** Enums no table of this step holds, and where they live. */
export const NOT_STORED_HERE: Record<string, string> = {
  AccountState: 'accounts.state (CC-01)',
  SeatRole: 'seats.role (CC-01)',
  Theme: 'seats.theme (CC-01)',
  IntegrationKind: 'Account.integrations; the integrations table is a later step',
  VerificationMethod: 'crawler registry seed data',
  WithheldCollection: 'fixture metadata',
};
