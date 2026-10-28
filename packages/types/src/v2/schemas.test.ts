/**
 * The rules that live inside one record.
 *
 * Every rule is an entry in rules.ts, and a test below walks every schema the index exports and fails
 * on anything else that could report a problem of its own (see the comment on `checksNotFromRules`).
 * Every rule needs a case, and every two-way rule ("X exactly when Y") cases whose issues report both
 * directions. A case starts from a record that parses (taken from a fixture), breaks the rule, and
 * asserts the parse fails with exactly one issue, from that rule. Rules with several branches have a
 * case per branch; that is checked by the one-sided weakening sweep cited in the pull request, not by
 * a test here. Reusing an existing rule for a new condition is not caught here either.
 *
 * The byte budgets of crawled text, the caps on arrays and strings, and the numeric bounds are pinned
 * in tables at the bottom, and sweeps require the tables to name exactly what the schemas declare.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AccessTestSchema,
  AccountSchema,
  AgencyBrandingSchema,
  AiReadabilitySchema,
  AlertRuleSchema,
  CheckSchema,
  CoverageSchema,
  CRAWLED_TEXT_BUDGETS,
  crawledText,
  CrawlerRegistryEntrySchema,
  CrawlerResultSchema,
  EffectSchema,
  ENTITIES,
  FixEventSchema,
  FixSchema,
  FixtureDatasetSchema,
  ReportSchema,
  SiteSchema,
  TechnicalSeoSchema,
  TimestampSchema,
  RULE_CHECKS,
  RULES,
  UNMEASURED_VERDICTS,
  rules,
  type FixtureDataset,
  type RuleId,
} from './index.js';
import * as contract from './index.js';
import { maxLength, nodes, schemaFormat, schemaType } from './introspect.js';

const load = (name: string): FixtureDataset =>
  FixtureDatasetSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../../../apps/web/lib/fixtures/v2/${name}.json`, import.meta.url),
        'utf8',
      ),
    ),
  );
const bad = load('bad-site');
const clean = load('clean-site');
const challenged = load('challenged-site');
const copy = <T>(v: T): T => structuredClone(v);

const check = (data: FixtureDataset, status: string, nth = 0) =>
  copy(data.checks.filter((c) => c.status === status)[nth]!);
const finished = () => check(bad, 'finished');
const queued = () => check(bad, 'queued');
const running = () => check(clean, 'running');
const partial = () => check(challenged, 'partial', 1);
const withheldAi = () => partial().ai_readability;
const fixNumbered = (data: FixtureDataset, status: string) =>
  copy(data.fixes.find((f) => f.status === status)!);
const northwind = () => copy(challenged.accounts.find((a) => a.state === 'past_due')!);
const kestrel = () => copy(challenged.accounts.find((a) => a.state === 'agency_trial')!);
const report = (data: FixtureDataset, pick: (r: FixtureDataset['reports'][number]) => boolean) =>
  copy(data.reports.find(pick)!);
const rule = (data: FixtureDataset, kind: string) =>
  copy(data.alert_rules.find((r) => r.kind === kind)!);
const registryEntry = () => ({
  token: 'GPTBot',
  group: 'ai_training',
  scored: false,
  operator: 'OpenAI',
  purpose: 'Collects pages for OpenAI model training.',
  robots_token: 'GPTBot',
  ua_string:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
  verification_method: ['ip_list'],
  ip_list_url: 'https://openai.com/gptbot.json',
  testable: true,
  needs_owner_logs: true,
  source_url: 'https://developers.openai.com/api/docs/bots',
  source_notes: [],
  as_of: '2026-10-27',
});

interface RuleCase {
  rule: RuleId;
  /** Which direction or branch of the rule this case breaks. */
  breaks: string;
  schema: z.ZodType;
  input: () => unknown;
}

const CASES: RuleCase[] = [
  // ── Account ──────────────────────────────────────────────────────────────────────────────────
  {
    rule: 'billing_period',
    breaks: 'a three-month period',
    schema: AccountSchema,
    input: () => ({ ...northwind(), billing_period_months: 3 }),
  },
  {
    rule: 'history_current',
    breaks: 'state moved without a history entry',
    schema: AccountSchema,
    input: () => ({ ...copy(bad.accounts[0]!), state: 'pro', trial_ends_at: null }),
  },
  {
    rule: 'history_forward',
    breaks: 'two entries at the same instant',
    schema: AccountSchema,
    input: () => {
      const a = northwind();
      a.state_history[1]!.since = a.state_history[0]!.since;
      return a;
    },
  },
  {
    rule: 'trial_ends',
    breaks: 'a trial end outside a trial',
    schema: AccountSchema,
    input: () => ({ ...northwind(), trial_ends_at: '2026-11-08T02:41:00Z' }),
  },
  {
    rule: 'trial_ends',
    breaks: 'a trial with no end',
    schema: AccountSchema,
    input: () => ({ ...copy(bad.accounts[0]!), trial_ends_at: null }),
  },
  {
    rule: 'time_zone',
    breaks: 'an unknown zone of the right shape',
    schema: AccountSchema,
    input: () => ({ ...copy(bad.accounts[0]!), timezone: 'Mars/Olympus_Mons' }),
  },
  {
    rule: 'time_zone',
    breaks: 'an offset, which is not a zone',
    schema: AccountSchema,
    input: () => ({ ...copy(bad.accounts[0]!), timezone: '+05:00' }),
  },
  {
    rule: 'time_zone',
    breaks: 'a lowercase spelling the runtime would accept',
    schema: AccountSchema,
    input: () => ({ ...copy(bad.accounts[0]!), timezone: 'america/new_york' }),
  },
  {
    rule: 'trial_consent',
    breaks: 'an Agency trial with no consent',
    schema: AccountSchema,
    input: () => ({ ...northwind(), agency_trial_consent: null }),
  },
  {
    rule: 'trial_consent',
    breaks: 'consent on an account that never had an Agency trial',
    schema: AccountSchema,
    input: () => ({
      ...copy(bad.accounts[0]!),
      agency_trial_consent: { recorded_at: '2026-10-25T02:40:00Z' },
    }),
  },
  // ── AgencyBranding ──────────────────────────────────────────────────────────────────────────
  {
    rule: 'branding_dns',
    breaks: 'a domain without DNS status',
    schema: AgencyBrandingSchema,
    input: () => ({ ...northwind().branding!, dns: null }),
  },
  {
    rule: 'branding_dns',
    breaks: 'DNS status without a domain',
    schema: AgencyBrandingSchema,
    input: () => ({
      ...kestrel().branding!,
      dns: { txt_found: false, cname_found: false, certificate_issued_at: null },
    }),
  },
  {
    rule: 'branding_email_auth',
    breaks: 'a sender without email checks',
    schema: AgencyBrandingSchema,
    input: () => ({ ...northwind().branding!, email_auth: null }),
  },
  {
    rule: 'branding_email_auth',
    breaks: 'email checks without a sender',
    schema: AgencyBrandingSchema,
    input: () => ({
      ...kestrel().branding!,
      email_auth: { spf_passes: false, dkim_passes: false, dmarc_policy: null },
    }),
  },
  {
    rule: 'branding_postal',
    breaks: 'a sender with no postal address',
    schema: AgencyBrandingSchema,
    input: () => ({ ...northwind().branding!, postal_address: null }),
  },
  // ── Crawled text (every budget is also pinned in CRAWLED_BUDGETS below) ──────────────────────
  {
    rule: 'crawled_text_budget',
    breaks: '1,001 "é": 1,001 characters, 2,002 bytes, over a 2,000-byte budget',
    schema: AccessTestSchema,
    input: () => ({ ...copy(bad.access_tests[0]!), body_excerpt: 'é'.repeat(1001) }),
  },
  {
    rule: 'crawled_text_surrogate',
    breaks: 'a high surrogate with no low half, which UTF-8 cannot encode',
    schema: AccessTestSchema,
    input: () => ({ ...copy(bad.access_tests[0]!), body_excerpt: 'a\ud800b' }),
  },
  {
    rule: 'crawled_text_surrogate',
    breaks: 'a low surrogate with no high half',
    schema: AccessTestSchema,
    input: () => ({ ...copy(bad.access_tests[0]!), body_excerpt: 'a\udc00b' }),
  },
  {
    rule: 'crawled_text_surrogate',
    breaks: 'a pair in the wrong order, low then high',
    schema: AccessTestSchema,
    input: () => ({ ...copy(bad.access_tests[0]!), body_excerpt: 'a\udc00\ud800b' }),
  },
  // ── CrawlerRegistryEntry ────────────────────────────────────────────────────────────────────
  {
    rule: 'verification_alone',
    breaks: 'none_published listed with a method',
    schema: CrawlerRegistryEntrySchema,
    input: () => ({ ...registryEntry(), verification_method: ['ip_list', 'none_published'] }),
  },
  {
    rule: 'verification_unique',
    breaks: 'a method listed twice',
    schema: CrawlerRegistryEntrySchema,
    input: () => ({ ...registryEntry(), verification_method: ['ip_list', 'ip_list'] }),
  },
  {
    rule: 'ip_list_url',
    breaks: 'an IP list without its URL',
    schema: CrawlerRegistryEntrySchema,
    input: () => ({ ...registryEntry(), ip_list_url: null }),
  },
  {
    rule: 'ip_list_url',
    breaks: 'a URL with no IP list method',
    schema: CrawlerRegistryEntrySchema,
    input: () => ({ ...registryEntry(), verification_method: ['reverse_dns'] }),
  },
  // ── Fix ─────────────────────────────────────────────────────────────────────────────────────
  {
    rule: 'effect_pending',
    breaks: 'not estimated, and waiting on nothing',
    schema: EffectSchema,
    input: () => ({ ...fixNumbered(bad, 'open').effect, ai_readability: null }),
  },
  {
    rule: 'effect_pending',
    breaks: 'estimated, and also waiting on other fixes',
    schema: EffectSchema,
    input: () => ({
      ...fixNumbered(bad, 'open').effect,
      ai_readability_pending_on: ['0f1e000000000001'],
    }),
  },
  {
    rule: 'fix_last_state',
    breaks: 'open, but last found absent',
    schema: FixSchema,
    input: () => ({ ...fixNumbered(bad, 'open'), last_state: 'not_detected' }),
  },
  {
    rule: 'fix_last_state',
    breaks: 'reopened, but last found absent',
    schema: FixSchema,
    input: () => ({ ...fixNumbered(bad, 'reopened'), last_state: 'not_detected' }),
  },
  {
    rule: 'fix_last_state',
    breaks: 'resolved, but last found present',
    schema: FixSchema,
    input: () => ({ ...fixNumbered(bad, 'verified_resolved'), last_state: 'detected' }),
  },
  {
    rule: 'fix_last_state',
    breaks: 'unable to verify, but last found present',
    schema: FixSchema,
    input: () => ({ ...fixNumbered(challenged, 'unable_to_verify'), last_state: 'detected' }),
  },
  {
    rule: 'fix_rank',
    breaks: 'a live fix with no rank',
    schema: FixSchema,
    input: () => ({ ...fixNumbered(bad, 'open'), rank: null }),
  },
  {
    rule: 'fix_rank',
    breaks: 'a resolved fix with a rank',
    schema: FixSchema,
    input: () => ({ ...fixNumbered(bad, 'verified_resolved'), rank: 1 }),
  },
  {
    rule: 'packet_framework',
    breaks: 'the framework missing from the switch',
    schema: FixSchema,
    input: () => {
      const f = fixNumbered(bad, 'open');
      f.packet!.frameworks = f.packet!.frameworks.filter((x) => x !== f.packet!.framework);
      return f;
    },
  },
  // ── Coverage and crawler results ────────────────────────────────────────────────────────────
  {
    rule: 'coverage_gradeable',
    breaks: 'too many gradeable pages',
    schema: CoverageSchema,
    input: () => {
      const c = finished().coverage!;
      return { ...c, gradeable: c.pages_crawled + 1 };
    },
  },
  {
    rule: 'coverage_gradeable',
    breaks: 'too many excluded pages',
    schema: CoverageSchema,
    input: () => {
      const c = partial().coverage!;
      return { ...c, excluded: [{ kind: 'pagination', count: c.pages_crawled }] };
    },
  },
  {
    rule: 'coverage_crawled',
    breaks: 'more crawled than discovered',
    schema: CoverageSchema,
    input: () => {
      const c = finished().coverage!;
      return { ...c, pages_discovered: c.pages_crawled - 1 };
    },
  },
  {
    rule: 'coverage_sampled',
    breaks: 'more sampled than the cap',
    schema: CoverageSchema,
    input: () => {
      const c = finished().coverage!;
      return { ...c, pages_sampled: c.sample_strategy.max_pages + 1 };
    },
  },
  {
    rule: 'coverage_sampled',
    breaks: 'more sampled than crawled, under the cap',
    schema: CoverageSchema,
    input: () => {
      const c = check(clean, 'finished').coverage!;
      return { ...c, pages_sampled: c.pages_crawled + 1 };
    },
  },
  {
    rule: 'crawler_scored',
    breaks: 'a training crawler scored',
    schema: CrawlerResultSchema,
    input: () => ({ ...finished().crawlers.find((r) => r.ua === 'GPTBot')!, scored: true }),
  },
  {
    rule: 'crawler_scored',
    breaks: 'a search crawler not scored',
    schema: CrawlerResultSchema,
    input: () => ({ ...finished().crawlers.find((r) => r.ua === 'OAI-SearchBot')!, scored: false }),
  },
  // ── Check status ────────────────────────────────────────────────────────────────────────────
  {
    rule: 'check_progress',
    breaks: 'progress on a finished check',
    schema: CheckSchema,
    input: () => ({ ...finished(), progress: running().progress }),
  },
  {
    rule: 'check_progress',
    breaks: 'a running check without progress',
    schema: CheckSchema,
    input: () => ({ ...running(), progress: null }),
  },
  {
    rule: 'check_not_started',
    breaks: 'a queued check that started',
    schema: CheckSchema,
    input: () => {
      const c = queued();
      return { ...c, started_at: c.queued_at };
    },
  },
  {
    rule: 'check_not_started',
    breaks: 'a deferred check that started',
    schema: CheckSchema,
    input: () => {
      const c = check(challenged, 'deferred');
      return { ...c, started_at: c.queued_at };
    },
  },
  {
    rule: 'check_started',
    breaks: 'a finished check never started',
    schema: CheckSchema,
    input: () => ({ ...finished(), started_at: null }),
  },
  {
    rule: 'check_started',
    breaks: 'a running check never started',
    schema: CheckSchema,
    input: () => ({ ...running(), started_at: null }),
  },
  {
    rule: 'check_finished_at',
    breaks: 'a finished check with no end',
    schema: CheckSchema,
    input: () => ({ ...finished(), finished_at: null }),
  },
  {
    rule: 'check_finished_at',
    breaks: 'a running check with an end',
    schema: CheckSchema,
    input: () => ({ ...running(), finished_at: '2026-10-27T15:43:00Z' }),
  },
  {
    rule: 'check_deferred_until',
    breaks: 'a finished check deferred',
    schema: CheckSchema,
    input: () => ({ ...finished(), deferred_until: '2026-11-01T00:00:00Z' }),
  },
  {
    rule: 'check_deferred_until',
    breaks: 'a deferred check with no date',
    schema: CheckSchema,
    input: () => ({ ...check(challenged, 'deferred'), deferred_until: null }),
  },
  {
    rule: 'check_failure_reason',
    breaks: 'a finished check with a failure',
    schema: CheckSchema,
    input: () => ({ ...finished(), failure_reason: 'timed out' }),
  },
  {
    rule: 'check_failure_reason',
    breaks: 'a failed check with no reason',
    schema: CheckSchema,
    input: () => ({ ...check(challenged, 'failed'), failure_reason: null }),
  },
  {
    rule: 'check_coverage',
    breaks: 'a finished check with no coverage',
    schema: CheckSchema,
    input: () => ({ ...finished(), coverage: null }),
  },
  {
    rule: 'check_coverage',
    breaks: 'a partial check with no coverage',
    schema: CheckSchema,
    input: () => ({ ...partial(), coverage: null }),
  },
  {
    rule: 'check_coverage',
    breaks: 'a queued check with coverage',
    schema: CheckSchema,
    input: () => ({ ...queued(), coverage: finished().coverage }),
  },
  {
    rule: 'check_result_link',
    breaks: 'a link that expires at the instant it was sent',
    schema: CheckSchema,
    input: () => {
      const c = check(clean, 'finished');
      return {
        ...c,
        result_email: { ...c.result_email!, link_expires_at: c.result_email!.sent_at },
      };
    },
  },
  {
    rule: 'check_both_grades',
    breaks: 'no AI readability',
    schema: CheckSchema,
    input: () => ({ ...finished(), ai_readability: null }),
  },
  {
    rule: 'check_both_grades',
    breaks: 'no Technical SEO',
    schema: CheckSchema,
    input: () => ({ ...finished(), technical_seo: null }),
  },
  {
    rule: 'check_grades_when_ended',
    breaks: 'Technical SEO on a queued check',
    schema: CheckSchema,
    input: () => ({ ...queued(), technical_seo: finished().technical_seo }),
  },
  {
    rule: 'check_grades_when_ended',
    breaks: 'AI readability on a queued check',
    schema: CheckSchema,
    input: () => ({ ...queued(), ai_readability: withheldAi() }),
  },
  {
    rule: 'i4_withheld',
    breaks: 'a measured grade on the withheld site',
    schema: CheckSchema,
    input: () => ({ ...partial(), ai_readability: finished().ai_readability }),
  },
  {
    rule: 'i4_given',
    breaks: 'a withheld grade on a measured site',
    schema: CheckSchema,
    input: () => ({ ...finished(), ai_readability: withheldAi() }),
  },
  // ── Grades ──────────────────────────────────────────────────────────────────────────────────
  {
    rule: 'score_grade_pair',
    breaks: 'a score without a letter',
    schema: TechnicalSeoSchema,
    input: () => ({ ...finished().technical_seo!, grade: null }),
  },
  {
    rule: 'score_grade_pair',
    breaks: 'a letter without a score, on a refused grade',
    schema: TechnicalSeoSchema,
    input: () => {
      const t = finished().technical_seo!;
      return {
        ...t,
        score: null,
        refusal: { ...t.refusal, refused: true, triggers: ['nothing_read'] },
      };
    },
  },
  {
    rule: 'refusal_score',
    breaks: 'refused, with a score',
    schema: TechnicalSeoSchema,
    input: () => {
      const t = finished().technical_seo!;
      return { ...t, refusal: { ...t.refusal, refused: true, triggers: ['nothing_read'] } };
    },
  },
  {
    rule: 'refusal_score',
    breaks: 'not refused, with no score',
    schema: TechnicalSeoSchema,
    input: () => ({ ...finished().technical_seo!, score: null, grade: null }),
  },
  {
    rule: 'access_range_order',
    breaks: 'min above max',
    schema: AiReadabilitySchema,
    input: () => ({ ...withheldAi()!, access_range: { min: 30, max: 10 } }),
  },
  {
    rule: 'total_sum',
    breaks: 'a total three points off',
    schema: AiReadabilitySchema,
    input: () => {
      const g = finished().ai_readability as { total: number };
      return { ...g, total: g.total + 3 };
    },
  },
  // ── Site ────────────────────────────────────────────────────────────────────────────────────
  {
    rule: 'schedule_timed',
    breaks: 'weekly with neither weekday nor hour',
    schema: SiteSchema,
    input: () => {
      const s = copy(bad.sites[0]!);
      s.schedule = { cadence: 'weekly', iso_weekday: null, hour_local: null };
      return s;
    },
  },
  {
    rule: 'schedule_timed',
    breaks: 'on_deploy with a weekday and hour',
    schema: SiteSchema,
    input: () => {
      const s = copy(bad.sites.find((x) => x.schedule?.cadence === 'on_deploy')!);
      s.schedule = { cadence: 'on_deploy', iso_weekday: 5, hour_local: 6 };
      return s;
    },
  },
  {
    rule: 'schedule_pair',
    breaks: 'weekly with a weekday and no hour',
    schema: SiteSchema,
    input: () => {
      const s = copy(bad.sites[0]!);
      s.schedule!.hour_local = null;
      return s;
    },
  },
  {
    rule: 'schedule_pair',
    breaks: 'on_deploy with an hour and no weekday',
    schema: SiteSchema,
    input: () => {
      const s = copy(bad.sites.find((x) => x.schedule?.cadence === 'on_deploy')!);
      s.schedule = { cadence: 'on_deploy', iso_weekday: null, hour_local: 6 };
      return s;
    },
  },
  {
    rule: 'unkept_audit',
    breaks: 'a schedule',
    schema: SiteSchema,
    input: () => ({
      ...copy(clean.sites[0]!),
      schedule: { cadence: 'weekly', iso_weekday: 5, hour_local: 6 },
    }),
  },
  {
    rule: 'unkept_audit',
    breaks: 'a client report',
    schema: SiteSchema,
    input: () => ({
      ...copy(clean.sites[0]!),
      client_report: copy(challenged.sites[0]!.client_report),
    }),
  },
  {
    rule: 'unkept_audit',
    breaks: 'an owner',
    schema: SiteSchema,
    input: () => ({ ...copy(clean.sites[0]!), owner_seat_id: challenged.seats[0]!.id }),
  },
  {
    rule: 'client_report_cadence',
    breaks: 'a report on each deploy',
    schema: SiteSchema,
    input: () => {
      const s = copy(challenged.sites[0]!);
      s.client_report!.cadence = 'on_deploy';
      return s;
    },
  },
  // ── AlertRule ───────────────────────────────────────────────────────────────────────────────
  {
    rule: 'alert_threshold',
    breaks: 'a text-drop rule with no threshold',
    schema: AlertRuleSchema,
    input: () => ({ ...rule(bad, 'text_drop'), threshold_points: null }),
  },
  {
    rule: 'alert_threshold',
    breaks: 'another rule with a threshold',
    schema: AlertRuleSchema,
    input: () => ({ ...rule(bad, 'crawler_blocked'), threshold_points: 10 }),
  },
  {
    rule: 'alert_fired_pair',
    breaks: 'when, without which check',
    schema: AlertRuleSchema,
    input: () => ({ ...rule(bad, 'crawler_blocked'), last_fired_check_id: null }),
  },
  {
    rule: 'alert_fired_pair',
    breaks: 'which check, without when',
    schema: AlertRuleSchema,
    input: () => ({ ...rule(bad, 'text_drop'), last_fired_check_id: bad.checks[0]!.id }),
  },
  // ── Report ──────────────────────────────────────────────────────────────────────────────────
  {
    rule: 'report_sent',
    breaks: 'a ready report with a send time',
    schema: ReportSchema,
    input: () => ({ ...report(bad, (r) => r.status === 'ready'), sent_at: '2026-10-30T10:05:00Z' }),
  },
  {
    rule: 'report_sent',
    breaks: 'a sent report with no send time',
    schema: ReportSchema,
    input: () => ({ ...report(challenged, (r) => r.status === 'sent'), sent_at: null }),
  },
  {
    rule: 'report_send_time',
    breaks: 'held, with no time',
    schema: ReportSchema,
    input: () => ({ ...report(challenged, (r) => r.status === 'held'), scheduled_for: null }),
  },
  {
    rule: 'report_send_time',
    breaks: 'scheduled, with no time',
    schema: ReportSchema,
    input: () => ({ ...report(challenged, (r) => r.status === 'scheduled'), scheduled_for: null }),
  },
  {
    rule: 'report_slug',
    breaks: 'a public link with no slug',
    schema: ReportSchema,
    input: () => ({ ...report(bad, (r) => r.kind === 'public_link'), public_slug: null }),
  },
  {
    rule: 'report_slug',
    breaks: 'a PDF with a slug',
    schema: ReportSchema,
    input: () => ({ ...report(bad, (r) => r.kind === 'audit_pdf'), public_slug: 'audit' }),
  },
  {
    rule: 'report_open_tracking',
    breaks: 'an open with tracking off',
    schema: ReportSchema,
    input: () => ({ ...report(challenged, (r) => r.opened_at !== null), open_tracking: false }),
  },
  // ── AccessTest ──────────────────────────────────────────────────────────────────────────────
  {
    rule: 'observed_owner_logs',
    breaks: 'observed, from our own egress',
    schema: AccessTestSchema,
    input: () => ({ ...copy(bad.access_tests[0]!), evidence_class: 'observed' }),
  },
  {
    rule: 'observed_owner_logs',
    breaks: 'owner logs, classed as simulated',
    schema: AccessTestSchema,
    input: () => ({ ...copy(bad.access_tests[0]!), source_ip_class: 'owner_logs' }),
  },
];

// ── Every rule goes through rules.ts ───────────────────────────────────────────────────────────

type Schema = z.core.$ZodType;
type Check = z.core.$ZodCheck;
const checksOf = (schema: Schema): Check[] =>
  (schema._zod.def as { checks?: Check[] }).checks ?? [];
const kindOf = (check: Check) => check._zod.def.check;

/**
 * Built-in zod checks, matched by class rather than by the kind name a check reports about itself:
 * bounds, lengths and formats, which report zod's own issues.
 */
const BUILT_IN_CHECKS = [
  z.core.$ZodCheckStringFormat,
  z.core.$ZodCheckStartsWith,
  z.core.$ZodCheckGreaterThan,
  z.core.$ZodCheckLessThan,
  z.core.$ZodCheckMinLength,
  z.core.$ZodCheckMaxLength,
];

const isZod = (v: unknown) => typeof v === 'object' && v !== null && '_zod' in v;

/** Every function in a definition, by key, without descending into the schemas and checks it holds. */
function functionsIn(
  def: object,
  at = '',
  seen = new Set<object>(),
): { key: string; fn: string }[] {
  if (seen.has(def)) return [];
  seen.add(def);
  return Object.entries(def).flatMap(([key, value]) => {
    const here = at ? `${at}.${key}` : key;
    if (typeof value === 'function') return [{ key: here, fn: String(value) }];
    if (typeof value !== 'object' || value === null || isZod(value) || value instanceof RegExp) {
      return [];
    }
    return functionsIn(value as object, here, seen);
  });
}

/** The functions zod itself puts in a built-in check: the default `when` of the length checks. */
const ZOD_OWN_FUNCTIONS = new Set(
  [z.string().min(1), z.string().max(1), z.array(z.string()).min(1), z.array(z.string()).max(1)]
    .flatMap((s) => checksOf(s))
    .flatMap((check) => functionsIn(check._zod.def))
    .map(({ key, fn }) => `${key}=${fn}`),
);

/** A function's source, read so that a function's own `toString` cannot change the answer. */
const sourceOf = (fn: unknown) => Function.prototype.toString.call(fn);

/** The run function of each built-in check class, from fresh checks made through zod's API. */
const ZOD_OWN_RUNS = new Set(
  [
    z.string().regex(/a/),
    z.string().startsWith('a'),
    z.number().min(0).max(1),
    z.string().min(1).max(1),
    z.array(z.string()).min(1).max(1),
  ]
    .flatMap((s) => checksOf(s))
    .map((check) => sourceOf(check._zod.check)),
);

/**
 * Everything under `root` that could report a problem of its own, other than a check `rules` made:
 * a check that is not a built-in class; a built-in check whose run function is not zod's own, or that
 * holds a function zod did not put there (a custom format, a custom message, an overwrite); and a
 * schema whose definition holds a function at all (z.stringFormat, z.custom, a catch). `nodes` throws on a schema kind it does not know, which
 * includes transforms and preprocess (type "pipe") and z.lazy.
 */
function checksNotFromRules(root: Schema): string[] {
  return nodes(root).flatMap(({ schema, path }) => {
    const at = path || '(root)';
    const own = functionsIn(schema._zod.def).map(
      ({ key }) => `${at}: the schema runs its own ${key}`,
    );
    const checks = checksOf(schema)
      .filter((check) => !RULE_CHECKS.has(check))
      .flatMap((check) => {
        if (!BUILT_IN_CHECKS.some((C) => check instanceof C)) {
          return [`${at}: ${kindOf(check)} is neither built in nor made by rules()`];
        }
        if (!ZOD_OWN_RUNS.has(sourceOf(check._zod.check))) {
          return [`${at}: ${kindOf(check)} runs a function that is not zod's own`];
        }
        return functionsIn(check._zod.def)
          .filter(({ key, fn }) => !ZOD_OWN_FUNCTIONS.has(`${key}=${fn}`))
          .map(({ key }) => `${at}: ${kindOf(check)} runs its own ${key}`);
      });
    return [...own, ...checks];
  });
}

const exportedSchemas = Object.entries(contract as Record<string, unknown>).filter(
  (entry): entry is [string, Schema] =>
    typeof entry[1] === 'object' && entry[1] !== null && '_zod' in entry[1],
);

/** The rule and direction of each issue a case's parse reports. */
function reported(c: RuleCase): { rule: unknown; direction: unknown }[] {
  const result = c.schema.safeParse(c.input());
  return (result.error?.issues ?? []).map((issue) => {
    const params = (issue as { params?: { rule?: unknown; direction?: unknown } }).params;
    return { rule: params?.rule, direction: params?.direction };
  });
}

/** A genuine built-in check whose run function was replaced by hand. */
function rerun(spoofSource = false): z.core.$ZodCheck<string> {
  const check = z.startsWith('');
  const run = check._zod.check;
  const replaced: typeof run = (payload) => {
    if (payload.value === 'x') payload.issues.push({ code: 'custom', message: 'x', input: 'x' });
    run(payload);
  };
  if (spoofSource) replaced.toString = () => String(run);
  check._zod.check = replaced;
  return check as z.core.$ZodCheck<string>;
}

/** A custom check that claims to be a built-in max-length check, by kind name only. */
function spoofed(): z.core.$ZodCheck<string> {
  const check = z.superRefine<string>(() => {});
  (check._zod.def as { check: string }).check = 'max_length';
  return check;
}

describe('every rule is defined in rules.ts, with a case for each way it breaks', () => {
  it("every check in every exported schema is built in, runs only zod's code, or is made by rules()", () => {
    const found = exportedSchemas.flatMap(([name, schema]) =>
      checksNotFromRules(schema).map((at) => `${name} ${at}`),
    );
    expect(exportedSchemas.length).toBeGreaterThan(80);
    expect(found).toEqual([]);
  });

  it('the walk catches each other way zod lets a schema report a problem of its own', () => {
    const inner = (field: Schema) =>
      z.strictObject({ a: z.array(z.strictObject({ b: field }).nullable()) }) as Schema;
    const found = (schema: Schema) => {
      try {
        return checksNotFromRules(schema).length > 0;
      } catch {
        return true; // a schema kind the walk does not know is refused, not skipped
      }
    };
    const escapes: Record<string, Schema> = {
      superRefine: inner(z.string().superRefine(() => {})),
      refine: inner(z.string().refine(() => true)),
      'with(z.refine)': inner(z.string().with(z.refine(() => true))),
      'check(function)': inner(z.string().check(() => {})),
      'check(z.superRefine)': inner(z.string().check(z.superRefine(() => {}))),
      overwrite: inner(z.string().overwrite((v) => v)),
      'z.custom': inner(z.custom<string>(() => true)),
      transform: inner(z.string().transform((v) => v)),
      preprocess: inner(z.preprocess((v) => v, z.string())),
      'refine on the object itself': z.strictObject({ a: z.string() }).refine(() => true),
      'z.stringFormat as a field': inner(z.stringFormat('x', (v) => v !== 'x')),
      'check(z.stringFormat)': inner(z.string().check(z.stringFormat('x', (v) => v !== 'x'))),
      'a built-in check with its own message': inner(z.string().regex(/a/, 'a business rule')),
      'a length check with its own when': inner(
        z.string().check(z.minLength(1, { when: () => true } as never)),
      ),
      'a custom check reporting a built-in kind': inner(z.string().check(spoofed())),
      'a built-in check whose run function was replaced': inner(z.string().check(rerun())),
      "a replaced run function claiming zod's source": inner(z.string().check(rerun(true))),
      'z.lazy': inner(z.lazy(() => z.string())),
      catch: inner(z.string().catch('x')),
    };
    const missed = Object.keys(escapes).filter((name) => !found(escapes[name]!));
    expect(missed).toEqual([]);
    // ...while the same field built through rules(), and every built-in the contract uses, pass.
    expect(found(inner(z.string().check(rules(() => {}))))).toBe(false);
    const builtIns = z.string().min(1).max(5).regex(/a/).startsWith('a');
    expect(found(inner(builtIns))).toBe(false);
    expect(found(inner(z.array(z.number().min(0).max(1)).max(3)))).toBe(false);
  });

  it('no two rules share a message', () => {
    const messages = Object.values(RULES).map((r) => r.message);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('every rule has a case, and every two-way rule cases that break it in both directions', () => {
    const missing = (Object.keys(RULES) as RuleId[]).flatMap((id) => {
      const cases = CASES.filter((c) => c.rule === id);
      if (cases.length === 0) return [`${id}: no case`];
      if (!RULES[id].twoWay) return [];
      const directions = new Set(cases.flatMap((c) => reported(c).map((r) => r.direction)));
      return ['first_without_second', 'second_without_first']
        .filter((d) => !directions.has(d))
        .map((d) => `${id}: no case breaks it ${d}`);
    });
    expect(Object.keys(RULES).length).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });
});

describe('each rule, broken alone, is the one reason the parse fails', () => {
  it.each(CASES.map((c) => [c.rule, c.breaks, c] as const))('%s (%s)', (_rule, _breaks, c) => {
    const result = c.schema.safeParse(c.input());
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message)).toEqual([RULES[c.rule].message]);
    expect(reported(c).map((r) => r.rule)).toEqual([c.rule]);
  });
});

// ── Budgets and caps ───────────────────────────────────────────────────────────────────────────

/** The UTF-8 byte budget of every crawled-text field, by entity and field path. */
const CRAWLED_BUDGETS: Record<string, number> = {
  'AccessTest.identity_sent': 512,
  'AccessTest.request_headers[].name': 128,
  'AccessTest.request_headers[].value': 1024,
  'AccessTest.headers[].name': 128,
  'AccessTest.headers[].value': 1024,
  'AccessTest.body_excerpt': 2000,
  'Change.cause.diff.removed[]': 500,
  'Change.cause.diff.added[]': 500,
  'Check.signals[].evidence': 500,
  'LinkEdge.anchor_text': 2000,
};

/** The most entries every capped array may hold, and the most characters every capped string. */
const CAPS: Record<string, number> = {
  'AccessTest.limitations': 8,
  'AccessTest.limitations[]': 500,
  'AccessTest.request_headers': 32,
  'AccessTest.headers': 32,
  'Change.cause.diff.removed': 50,
  'Change.cause.diff.added': 50,
};

// Built inside each test, not at load, so a schema the walk refuses fails the walk test above by
// name instead of failing this file before any test runs.
// A union option adds "<n>" to the path; drop it, and the dot it leaves at the root of a union.
const fieldKey = (owner: string, path: string) =>
  `${owner}.${path.replace(/<\d+>/g, '').replace(/^\./, '')}`;
const COLLECTIONS = new Set<string>(ENTITIES.flatMap((e) => (e.collection ? [e.collection] : [])));

/** Every field of every entity, and of the fixture dataset itself outside its entity collections. */
const entityNodes = () => [
  ...ENTITIES.flatMap((e) =>
    nodes(e.schema).map((n) => ({ key: fieldKey(e.name, n.path), schema: n.schema })),
  ),
  ...nodes(FixtureDatasetSchema)
    .filter((n) => n.path !== '' && !COLLECTIONS.has(n.path.split(/[.[]/)[0]!))
    .map((n) => ({ key: fieldKey('FixtureDataset', n.path), schema: n.schema })),
];

/**
 * The bounds of every number that is not a plain count. Every other number in the contract must be a
 * count, a whole number in [0, inf): a test below requires exactly that, so a bound that moves, or a
 * whole number that stops being one, shows up here.
 */
const BOUNDS: Record<string, string> = {
  // Unbounded here because the billing_period rule allows exactly 1 or 12.
  'Account.billing_period_months': 'int (-inf, inf)',
  'Account.limits.sites': 'int [1, inf)',
  'Account.limits.seats': 'int [1, inf)',
  'Account.limits.pages_per_audit': 'int [1, inf)',
  'Site.schedule.iso_weekday': 'int [1, 7]',
  'Site.schedule.hour_local': 'int [0, 23]',
  'Site.client_report.iso_weekday': 'int [1, 7]',
  'Check.coverage.sample_strategy.max_pages': 'int [1, inf)',
  'Check.technical_seo.score': '[0, 100]',
  'Check.technical_seo.breakdown.orphanRatioScore': '[0, 1]',
  'Check.technical_seo.breakdown.depthScore': '[0, 1]',
  'Check.technical_seo.breakdown.anchorDiversityScore': '[0, 1]',
  'Check.technical_seo.breakdown.structureScore': '[0, 1]',
  'Check.technical_seo.site_structure_score': '[0, 100]',
  'Check.ai_readability.total': '[0, 100]',
  'Check.ai_readability.components.access.score': '[0, 40]',
  'Check.ai_readability.components.readable.score': '[0, 30]',
  'Check.ai_readability.components.quotable.score': '[0, 20]',
  'Check.ai_readability.components.signals.score': '[0, 10]',
  'Check.ai_readability.access_range.min': '[0, 40]',
  'Check.ai_readability.access_range.max': '[0, 40]',
  // A mean, so not a whole number.
  'Check.structure.avg_click_depth': '[0, inf)',
  'Check.structure.hub_pagerank_share': '[0, 1]',
  'Check.structure.generic_anchor_share': '[0, 1]',
  'Check.without_js.site_text_share': '[0, 1]',
  'Check.content.score': '[0, 100]',
  'Check.crawlers[].status': 'int [100, 599]',
  'Check.crawlers[].text_share': '[0, 1]',
  'Check.crawlers[].by_template[].status': 'int [100, 599]',
  'Check.competitors[].text_share': '[0, 1]',
  'Check.competitors[].technical_seo.score': '[0, 100]',
  'Check.competitors[].ai_readability.score': '[0, 100]',
  'Check.progress.recent_fetches[].status': 'int [100, 599]',
  'PageResult.status_code': 'int [100, 599]',
  'PageResult.pagerank_share': '[0, 1]',
  'PageResult.without_js.text_share': '[0, 1]',
  'AccessTest.raw_status': 'int [100, 599]',
  'Fix.rank': 'int [1, inf)',
  // A count or a share (or a yes/no, which is not a number).
  'Fix.before_after[].today': '[0, inf)',
  'Fix.before_after[].after': '[0, inf)',
  'Fix.effect.technical_seo': '[0, 100]',
  'Fix.effect.ai_readability': '[0, 100]',
  'Fix.effort.minutes': 'int [1, inf)',
  'Fix.effort.templates': 'int [1, inf)',
  'Fix.effort.deploys': 'int [1, inf)',
  'Change.grade_deltas[].from_score': '[0, 100]',
  'Change.grade_deltas[].to_score': '[0, 100]',
  'AlertRule.threshold_points': '[0, 100]',
};
const COUNT = 'int [0, inf)';

/** A number's bounds as an interval, from its own checks, marked `int` when it must be whole. */
function interval(schema: Schema): string {
  let lo = '(-inf';
  let hi = 'inf)';
  for (const check of checksOf(schema)) {
    const d = check._zod.def as unknown as { value: number; inclusive: boolean };
    if (check instanceof z.core.$ZodCheckGreaterThan) lo = `${d.inclusive ? '[' : '('}${d.value}`;
    if (check instanceof z.core.$ZodCheckLessThan) hi = `${d.value}${d.inclusive ? ']' : ')'}`;
  }
  return `${schemaFormat(schema) === 'safeint' ? 'int ' : ''}${lo}, ${hi}`;
}

describe('budgets and caps', () => {
  it('the budget table names exactly the fields declared with crawledText, at their budgets', () => {
    const declared = Object.fromEntries(
      entityNodes()
        .filter((n) => CRAWLED_TEXT_BUDGETS.has(n.schema as object))
        .map((n) => [n.key, CRAWLED_TEXT_BUDGETS.get(n.schema as object)]),
    );
    expect(declared).toEqual(CRAWLED_BUDGETS);
  });

  it('the cap table names exactly the capped arrays and strings, at the caps they declare', () => {
    const declared = Object.fromEntries(
      entityNodes()
        .filter((n) => ['array', 'string'].includes(schemaType(n.schema)))
        .filter((n) => maxLength(n.schema) !== undefined)
        .map((n) => [n.key, maxLength(n.schema)]),
    );
    expect(declared).toEqual(CAPS);
  });

  it.each(Object.entries(CRAWLED_BUDGETS))('%s holds %i bytes and not one more', (key, budget) => {
    const node = entityNodes().find(
      (n) => n.key === key && CRAWLED_TEXT_BUDGETS.has(n.schema as object),
    )!;
    const s = node.schema as z.ZodType;
    expect(s.safeParse('a'.repeat(budget)).success).toBe(true);
    expect(s.safeParse('a\u{1F600}b').success).toBe(true); // a well-formed pair is not a lone half
    expect(s.safeParse('a'.repeat(budget + 1)).success).toBe(false);
    expect(s.safeParse('é'.repeat(Math.floor(budget / 2) + 1)).success).toBe(false);
    // Over budget is the one issue reported; the rest of the string is not scanned for surrogates.
    const over = s.safeParse('a'.repeat(budget) + '\ud800');
    expect(over.error!.issues.map((i) => i.message)).toEqual([RULES.crawled_text_budget.message]);
  });
});

describe('numeric bounds', () => {
  const numbers = () => entityNodes().filter((n) => schemaType(n.schema) === 'number');

  it('every number is a whole-number count unless the bounds table names it, at those bounds', () => {
    const declared = Object.fromEntries(numbers().map((n) => [n.key, interval(n.schema)]));
    const expected = Object.fromEntries(Object.keys(declared).map((k) => [k, BOUNDS[k] ?? COUNT]));
    expect(declared).toEqual(expected);
    expect(Object.keys(BOUNDS).filter((k) => !(k in declared))).toEqual([]);
    expect(Object.values(declared).filter((v) => v === COUNT).length).toBeGreaterThan(30);
  });

  it.each(Object.entries(BOUNDS))('%s takes %s and nothing outside it', (key) => {
    for (const node of numbers().filter((n) => n.key === key)) {
      const s = node.schema as z.ZodType;
      const [lo, hi] = interval(node.schema).replace(/^int /, '').split(', ') as [string, string];
      if (lo !== '(-inf') {
        const low = Number(lo.slice(1));
        expect(s.safeParse(low).success).toBe(lo.startsWith('['));
        expect(s.safeParse(low - 1).success).toBe(false);
      }
      if (hi !== 'inf)') {
        const high = Number(hi.slice(0, -1));
        expect(s.safeParse(high).success).toBe(hi.endsWith(']'));
        expect(s.safeParse(high + 1).success).toBe(false);
      }
    }
  });

  it('every count takes 0 and refuses -1', () => {
    const counts = numbers().filter((n) => interval(n.schema) === COUNT);
    const wrong = counts.filter(
      (n) =>
        !(n.schema as z.ZodType).safeParse(0).success ||
        (n.schema as z.ZodType).safeParse(-1).success,
    );
    expect(wrong.map((n) => n.key)).toEqual([]);
  });
});

// ── Code the screens will bundle ───────────────────────────────────────────────────────────────

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    if (statSync(url).isDirectory()) return sourceFiles(new URL(`${name}/`, dir));
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [url] : [];
  });
}

describe('code the screens will bundle', () => {
  it('no source file in the types package uses a regex lookbehind, which Safari before 16.4 cannot parse', () => {
    // Node parses a lookbehind, so no behaviour test would notice one; an old browser fails to load
    // the whole chunk. Test files are excluded: they never ship.
    const found = sourceFiles(new URL('../', import.meta.url)).flatMap((url) => {
      const src = readFileSync(url, 'utf8');
      return [...src.matchAll(/\(\?<[=!]/g)].map(
        (m) => `${url.pathname.split('/src/')[1]}:${src.slice(0, m.index).split('\n').length}`,
      );
    });
    expect(found).toEqual([]);
  });
});

// ── Shapes and definitions ─────────────────────────────────────────────────────────────────────

describe('shapes and definitions', () => {
  it('a rule body reads a read-only view: writing to the value it checks throws', () => {
    const shape = z.strictObject({ a: z.string(), b: z.array(z.strictObject({ c: z.string() })) });
    const writes: Record<string, (v: { a: string; b: { c: string }[] }) => void> = {
      'set a field': (v) => void (v.a = 'x'),
      'set a nested field': (v) => void (v.b[0]!.c = 'x'),
      'push to an array': (v) => void v.b.push({ c: 'x' }),
      'delete a field': (v) => void delete (v as Partial<typeof v>).a,
      'freeze it': (v) => void Object.freeze(v),
      'write through a property descriptor': (v) =>
        void ((Object.getOwnPropertyDescriptor(v, 'b')!.value as { c: string }[])[0]!.c = 'x'),
      'push through all the descriptors': (v) =>
        void (Object.getOwnPropertyDescriptors(v).b.value as { c: string }[]).push({ c: 'x' }),
    };
    const input = { a: 'a', b: [{ c: 'c' }] };
    for (const [name, write] of Object.entries(writes)) {
      const schema = shape.check(rules((v) => write(v)));
      expect(() => schema.parse(structuredClone(input)), name).toThrow(TypeError);
    }
    const reads = shape.check(rules((v) => void [v.a, v.b.map((x) => x.c), Object.keys(v)]));
    expect(reads.parse(structuredClone(input))).toStrictEqual(input);
  });

  it('a withheld access range may be a single point', () => {
    const ai = withheldAi()!;
    if (!ai.withheld) throw new Error('the partial check in challenged-site must be withheld');
    const point = { ...ai, access_range: { min: ai.access_range.min, max: ai.access_range.min } };
    expect(AiReadabilitySchema.safeParse(point).success).toBe(true);
  });

  it('annual billing (12 months) is accepted, as well as monthly', () => {
    expect(AccountSchema.safeParse({ ...northwind(), billing_period_months: 12 }).success).toBe(
      true,
    );
    expect(AccountSchema.safeParse({ ...northwind(), billing_period_months: 1 }).success).toBe(
      true,
    );
  });

  it('a total within rounding (0.005) of its components is accepted', () => {
    const ai = finished().ai_readability!;
    if (ai.withheld) throw new Error('the finished check in bad-site must be graded');
    const total = ai.total <= 99.99 ? ai.total + 0.005 : ai.total - 0.005;
    expect(AiReadabilitySchema.safeParse({ ...ai, total }).success).toBe(true);
  });

  it('crawled text is refused exactly when it is not well-formed UTF-16, over every short string', () => {
    // Every string of up to four code units over plain text and the edges of both surrogate ranges,
    // against the runtime's own String.prototype.isWellFormed as the independent answer.
    const alphabet = ['a', '\ud800', '\udbff', '\udc00', '\udfff'];
    let strings = [''];
    const all: string[] = [''];
    for (let n = 1; n <= 4; n++) {
      strings = strings.flatMap((prefix) => alphabet.map((c) => prefix + c));
      all.push(...strings);
    }
    const text = crawledText(64);
    const wellFormed = (s: string) => (s as string & { isWellFormed(): boolean }).isWellFormed();
    const disagree = all.filter((s) => text.safeParse(s).success !== wellFormed(s));
    expect(all.length).toBe(781);
    expect(disagree.map((s) => JSON.stringify(s))).toEqual([]);
  });

  it('"measured" for I4 is exactly the owner-approved definition', () => {
    expect([...UNMEASURED_VERDICTS].sort()).toEqual(['edge_blocks_automation', 'not_measured']);
  });

  it('an access component above 40 is rejected', () => {
    const g = copy(finished().ai_readability!) as { components: { access: { score: number } } };
    g.components.access.score = 41;
    expect(AiReadabilitySchema.safeParse(g).success).toBe(false);
  });

  it('the quotable component is always flagged heuristic', () => {
    const g = copy(finished().ai_readability!) as {
      components: { quotable: { heuristic: boolean } };
    };
    g.components.quotable.heuristic = false;
    expect(AiReadabilitySchema.safeParse(g).success).toBe(false);
  });

  it('an effect is always labelled an estimate', () => {
    const effect = fixNumbered(bad, 'open').effect;
    expect(EffectSchema.safeParse({ ...effect, estimate: false }).success).toBe(false);
  });

  it('marked_done may come from an audit nobody kept (no seat), but must say so', () => {
    const marked = copy(bad.fix_events.find((e) => e.kind === 'marked_done')!);
    expect(FixEventSchema.safeParse({ ...marked, by_seat_id: null }).success).toBe(true);
    const missing = { ...marked } as Record<string, unknown>;
    delete missing.by_seat_id;
    expect(FixEventSchema.safeParse(missing).success).toBe(false);
  });

  it('a fix event kind outside the lifecycle is rejected', () => {
    const marked = copy(bad.fix_events[0]!);
    expect(FixEventSchema.safeParse({ ...marked, kind: 'deleted' }).success).toBe(false);
  });

  it('an empty state history is an error, not an exception', () => {
    const empty = () => ({ ...copy(bad.accounts[0]!), state_history: [] });
    expect(() => AccountSchema.safeParse(empty())).not.toThrow();
    expect(AccountSchema.safeParse(empty()).success).toBe(false);
  });

  it('history order is by instant, whatever the fractional-second precision', () => {
    const a = northwind();
    const first = a.state_history[0]!.since; // "...T15:00:00Z"
    a.state_history[1]!.since = first.replace('Z', '.500Z');
    expect(TimestampSchema.safeParse(a.state_history[1]!.since).success).toBe(true);
    expect(AccountSchema.safeParse(a).success).toBe(true);
    a.state_history[0]!.since = first.replace(':00Z', ':00.900Z');
    expect(AccountSchema.safeParse(a).success).toBe(false);
  });

  it('accepts IANA zones, including Etc/GMT+5 and UTC', () => {
    const zone = (timezone: string) =>
      AccountSchema.safeParse({ ...copy(bad.accounts[0]!), timezone }).success;
    expect(zone('Etc/GMT+5')).toBe(true);
    expect(zone('UTC')).toBe(true);
    expect(zone('America/Indiana/Indianapolis')).toBe(true);
  });

  it('a new agency on day 1 has a name and nothing else set yet', () => {
    const fresh = kestrel();
    expect(fresh.branding).toMatchObject({ portal_domain: null, sender_email: null, dns: null });
    expect(fresh.agency_trial_consent).not.toBeNull();
  });

  it('an agency logo is served over https', () => {
    const branding = { ...northwind().branding!, logo_url: 'http://audits.example/logo.svg' };
    expect(AgencyBrandingSchema.safeParse(branding).success).toBe(false);
  });

  it('an API key prefix cannot hold a whole key', () => {
    const a = northwind();
    a.api_keys[0]!.prefix = 'cm_ro_0123456789abcdef';
    expect(AccountSchema.safeParse(a).success).toBe(false);
  });

  it('a complete registry entry parses, and one whose page could not be fetched has as_of null', () => {
    expect(CrawlerRegistryEntrySchema.safeParse(registryEntry()).success).toBe(true);
    const unfetched = { ...registryEntry(), as_of: null };
    expect(CrawlerRegistryEntrySchema.safeParse(unfetched).success).toBe(true);
  });
});

describe('strict objects', () => {
  it('rejects an unknown key', () => {
    expect(CheckSchema.safeParse({ ...finished(), extra: 1 }).success).toBe(false);
  });

  it('drops a __proto__ key carried in JSON, so a parsed record never holds one', () => {
    // zod 4 strips an own "__proto__" key rather than rejecting it; the contract test guards the
    // fixtures themselves. This pins the behaviour the parsed output relies on.
    const json = JSON.stringify(finished()).replace(/^\{/, '{"__proto__":{"status":"failed"},');
    const result = CheckSchema.safeParse(JSON.parse(json));
    expect(result.success).toBe(true);
    expect(Object.hasOwn(result.data!, '__proto__')).toBe(false);
    expect(result.data!.status).toBe('finished');
  });

  it('rejects a constructor key', () => {
    expect(CheckSchema.safeParse({ ...finished(), constructor: 1 }).success).toBe(false);
  });
});
