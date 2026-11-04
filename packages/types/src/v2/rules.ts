/**
 * Every rule the v2 schemas enforce beyond shape, each with its one message.
 *
 * A schema adds a rule as `.check(rules((value, rule) => ...))`. The body is handed `rule.fail`
 * (one-way rules) and `rule.exactlyWhen` ("X exactly when Y" rules, which can break in two
 * directions), never zod's context, so it can only report an entry of RULES. The body reads the value
 * through a read-only view, so a write to it throws instead of changing the parsed output. `rules`
 * records every check it makes.
 *
 * The walk test in schemas.test.ts visits every schema the index exports and fails on: a check that is
 * not a built-in bound, length or format class; a built-in check whose run function is not zod's own,
 * or whose definition holds a function zod did not put there (a custom format or message); and a
 * schema whose definition holds a function. Built-in checks report zod's own issues; they are shape,
 * not rules. The walk compares what zod's API builds, as zod 4 builds it today. It does not compare a
 * schema's own internal parse function, so code written into zod's private fields by hand is outside
 * it. A test beside it lists each way it was shown to catch; a zod upgrade that adds a new way to run
 * code belongs on that list.
 *
 * The same file requires a case for every rule, and for every two-way rule cases that break it in each
 * direction. Whether a rule is one-way or two-way is declared below, not inferred from its condition.
 */
import { z } from 'zod';

interface Rule {
  message: string;
  twoWay: boolean;
}

const one = (message: string) => ({ message, twoWay: false }) as const satisfies Rule;
const two = (message: string) => ({ message, twoWay: true }) as const satisfies Rule;

export const RULES = {
  // Account
  billing_period: one('billing is monthly (1) or annual (12)'),
  history_current: one('the last state_history entry must be the current state'),
  history_forward: one('state_history must move forward in time'),
  trial_consent: two('trial consent is recorded exactly when the account has had an Agency trial'),
  trial_ends: two('trial_ends_at is set exactly while on a trial'),
  // AgencyBranding
  branding_dns: two('dns status exists exactly when a report domain is set'),
  branding_email_auth: two('email checks exist exactly when a sender is set'),
  branding_postal: one('a sender address needs a postal address for the footer'),
  // Shared primitives
  time_zone: one('not an IANA time zone'),
  crawled_text_budget: one('crawled text is over its UTF-8 byte budget'),
  crawled_text_surrogate: one('crawled text has a lone surrogate, which cannot be stored'),
  // CrawlerRegistryEntry
  verification_alone: one('none_published stands alone'),
  verification_unique: one('verification methods are listed once each'),
  ip_list_url: two('ip_list_url is set exactly when an IP list is published'),
  // Fix
  effect_pending: two(
    'an AI effect is either estimated, or not yet estimated because of named fixes or reasons',
  ),
  fix_last_state: one('last_state does not fit the status'),
  fix_rank: two('every live fix has a rank and a resolved fix has none'),
  packet_framework: one('the packet framework must be one of its switch options'),
  packet_bodies: one('each further packet body is for another framework of the switch, once'),
  page_gone_status: one('a gone page answered 404 or 410'),
  fix_gone: one('a fix whose page is gone was last measured indeterminate'),
  // Coverage and crawler results
  coverage_gradeable: one('gradeable and excluded pages cannot exceed the pages crawled'),
  coverage_crawled: one('pages_crawled cannot exceed pages_discovered'),
  coverage_sampled: one('pages_sampled cannot exceed the crawl or the sample cap'),
  coverage_robots: one(
    'pages crawled and pages excluded by robots.txt cannot exceed the pages discovered',
  ),
  crawler_scored: two('exactly the ai_search crawlers are scored (FACTS I6)'),
  // Check
  check_progress: two('progress is present exactly while running'),
  check_not_started: one('not started yet'),
  check_started: one('started_at is required'),
  check_finished_at: two('finished_at is set exactly when the check has ended'),
  check_deferred_until: two('deferred_until is set exactly when deferred'),
  check_failure_reason: two('failure_reason is set exactly when failed'),
  check_coverage: two('coverage is set exactly when the crawl has finished'),
  check_both_grades: one('a finished check carries both grades'),
  check_grades_when_ended: one('only a finished or partial check carries grades'),
  check_result_link: one('the result link expires after it is sent'),
  i4_withheld: one(
    'AI readability is withheld when fewer than two scored crawlers were measured (I4)',
  ),
  // Grades
  score_grade_pair: two('score and grade are both present or both null'),
  refusal_score: two('a refused grade has no score; a given one has'),
  total_sum: one('total is not the sum of its components'),
  withheld_reasons: two('a withheld grade names why, and a given one names no reason'),
  component_range: two(
    'a component without a score carries the range it could take, and a scored one none',
  ),
  range_order: one("a component range's min must not exceed its max"),
  access_range_mirror: one("access_range is the Access component's range"),
  withheld_unmeasured: one('a withheld grade has at least one component without a score'),
  withheld_reasons_match: one(
    'withheld_reasons names each unscored component once: one Access reason, and readable_unmeasured, quotable_unmeasured or signals_unmeasured for the others',
  ),
  // Site
  schedule_timed: two('a timed schedule has a weekday; on_deploy has none'),
  schedule_pair: two('a schedule sets its weekday and its hour together'),
  unkept_audit: one('an unkept audit has no schedule, client report or owner'),
  client_report_cadence: one('client reports go out weekly or monthly'),
  // AlertRule
  alert_threshold: two('only the text-drop rule has a threshold, and it always has one'),
  alert_fired_pair: two('a firing records both when and which check'),
  // Report
  report_sent: two('sent_at is set exactly when sent'),
  report_send_time: one('a scheduled or held report has a send time'),
  report_slug: two('only a public link has a slug'),
  report_open_tracking: one('an open is known only with tracking on'),
  // AccessTest
  observed_owner_logs: two('observed evidence comes from owner logs, and only it does'),
  access_request_line: two('the request method and HTTP version are recorded together'),
  // UsageEvent
  usage_billable: one('only a delivered result is billable'),
  // Change
  change_severity: two('severity is set exactly on an opened or resolved change'),
  change_resolved_info: one('a resolved change is info'),
  change_baseline: one('a baseline row is about the grade, compares no scores and names no fix'),
  // Page facts (PageResult and the crawl worker's row)
  redirect_status: one('a redirect hop answers 301, 302, 303, 307 or 308'),
  redirect_loop: one('a redirect loop has at least one hop'),
  canonical_href: one('a resolved canonical needs the href it was resolved from'),
  robots_verdict: one('a robots.txt verdict is allowed, disallowed_by_robots or not_measured'),
  robots_ua_unique: one('each search engine has one robots.txt verdict'),
  links_read_html: one('only an HTML response has its links read'),
} as const;

export type RuleId = keyof typeof RULES;
type TwoWayRuleId = { [K in RuleId]: (typeof RULES)[K]['twoWay'] extends true ? K : never }[RuleId];
type OneWayRuleId = Exclude<RuleId, TwoWayRuleId>;

/** Which side held when a two-way rule broke: the first condition without the second, or the reverse. */
export type Direction = 'first_without_second' | 'second_without_first';

export interface RuleReporter {
  /** Report a one-way rule as broken. */
  fail(rule: OneWayRuleId): void;
  /** Report a two-way rule as broken when `first` and `second` disagree, in either direction. */
  exactlyWhen(rule: TwoWayRuleId, first: boolean, second: boolean): void;
}

const made = new WeakSet<object>();

/** The checks `rules` made. Weakly held, so a schema built at run time is not kept alive by it. */
export const RULE_CHECKS: Pick<WeakSet<object>, 'has'> = made;

function refuse(): never {
  throw new TypeError('a rule may not change the value it checks');
}

const views = new WeakMap<object, object>();
const READ_ONLY: ProxyHandler<object> = {
  get: (target, key, receiver) => readOnly(Reflect.get(target, key, receiver)),
  // Reading a property's descriptor hands out its value too, so that value is wrapped as well.
  getOwnPropertyDescriptor: (target, key) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    return descriptor && 'value' in descriptor
      ? { ...descriptor, value: readOnly(descriptor.value) }
      : descriptor;
  },
  set: refuse,
  defineProperty: refuse,
  deleteProperty: refuse,
  setPrototypeOf: refuse,
  preventExtensions: refuse,
};

/**
 * A read-only view of the value a rule checks, made lazily as the body reads it, by property or by
 * descriptor. A parsed value is plain data (no getters or setters), so a write anywhere in it throws
 * and a rule body cannot change what the parse returns.
 */
function readOnly<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  let view = views.get(value);
  if (!view) {
    view = new Proxy(value, READ_ONLY);
    views.set(value, view);
  }
  return view as T;
}

/** How a v2 schema adds a rule beyond its shape: `.check(rules((value, rule) => ...))`. */
export function rules<T>(body: (value: T, rule: RuleReporter) => void) {
  const check = z.superRefine<T>((value, ctx) => {
    body(readOnly(value), {
      fail(rule) {
        ctx.addIssue({ code: 'custom', message: RULES[rule].message, params: { rule } });
      },
      exactlyWhen(rule, first, second) {
        if (first === second) return;
        const direction: Direction = first ? 'first_without_second' : 'second_without_first';
        ctx.addIssue({ code: 'custom', message: RULES[rule].message, params: { rule, direction } });
      },
    });
  });
  made.add(check);
  return check;
}
