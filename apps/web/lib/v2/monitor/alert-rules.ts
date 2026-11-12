/**
 * Which of a check's changes each alert rule fires on (CC-28 D5). Pure: the caller reads the check,
 * its changes, the account's rules and what the rules compare against, and sends what this returns.
 *
 * The rule that applies to a kind is the site's own rule of that kind when it has one, else the
 * account's. A disabled rule, a rule with no channel, a site's first check and a `baseline` row fire
 * nothing; every change named is one of `changes` with this check's and this site's ids.
 *
 * What each kind fires on, as the screens describe it (`ALERT_LABELS`, copy/site.ts):
 * - `crawler_blocked`, "A crawler becomes blocked": an `opened` or `changed` crawler-access row whose
 *   crawler's verdict at this check is one of `BLOCKING_VERDICTS`, the pair the Alerts and Site views
 *   name for this rule, and was not one at the check before. A crawler that lost access without being
 *   blocked (challenged, rate limited) is `any_change`'s.
 * - `text_drop`, "Text without JavaScript drops more than N points": an `opened` text-without-JavaScript
 *   row, when the site's share of text without JavaScript fell by more than `threshold_points`
 *   percentage points from the check before (`textDropPoints`).
 * - `grade_letter_moved`, "A grade moves a full letter": a row with a grade delta whose letter moved:
 *   B to C does, B to B+ does not.
 * - `new_orphans`: an `opened` orphan-pages row.
 * - `fix_regressed`, "A fix you marked done regresses": an `opened` row of a fix that was reopened at
 *   this check from `marked_done` or `unable_to_verify` (which only a marked-done fix reaches), the
 *   states the engine's reopen note reads as "Marked done on …".
 * - `any_change`: every row.
 */
import type { AlertRule, Change, FixEvent, GradeLetter, Verdict } from '@crawlmouse/types/v2';

/** The verdicts "blocked" names (FACTS I2): view/alerts.ts and view/site.ts name the same two. */
export const BLOCKING_VERDICTS: readonly Verdict[] = ['disallowed_by_robots', 'blocked_by_ua_rule'];

export type AlertChange = Pick<
  Change,
  'id' | 'site_id' | 'check_id' | 'kind' | 'subject' | 'ua' | 'fix_id' | 'grade_deltas'
>;
export type AlertRuleInput = Pick<
  AlertRule,
  'id' | 'site_id' | 'kind' | 'enabled' | 'threshold_points' | 'channels'
>;
export interface AlertFixEvent {
  fix_id: string;
  kind: FixEvent['kind'];
  at: string;
  /** The check that measured it; marked_done has none. */
  check_id?: string | null;
}

export interface AlertInput {
  siteId: string;
  checkId: string;
  /** The site's first check: it has nothing to compare with, so it alerts nothing. */
  firstCheck: boolean;
  changes: readonly AlertChange[];
  /** The account's rules: account-wide ones and per-site ones, of any site. */
  rules: readonly AlertRuleInput[];
  /** Each crawler's verdict at this check and at the one before (null when there is none). */
  verdicts: {
    now: Readonly<Record<string, Verdict>>;
    before: Readonly<Record<string, Verdict>> | null;
  };
  /** The site's share of text without JavaScript (0 to 1) at the check before and at this one. */
  textShare: { before: number | null; now: number | null };
  /** The events of the fixes the changes name. */
  fixEvents: readonly AlertFixEvent[];
}

export interface FiredAlert {
  ruleId: string;
  kind: AlertRule['kind'];
  channels: AlertRule['channels'];
  changeIds: string[];
}

/** How far the share fell, in percentage points to four places; null without both shares. */
export function textDropPoints(share: AlertInput['textShare']): number | null {
  if (share.before === null || share.now === null) return null;
  return Math.round((share.before - share.now) * 1_000_000) / 10_000;
}

const letterOf = (g: GradeLetter) => g[0];

/** The fixes reopened at this check from a marked-done state. */
function regressedFixes(checkId: string, events: readonly AlertFixEvent[]): Set<string> {
  const byFix = new Map<string, AlertFixEvent[]>();
  for (const e of events) byFix.set(e.fix_id, [...(byFix.get(e.fix_id) ?? []), e]);
  const out = new Set<string>();
  for (const [fixId, list] of byFix) {
    const ordered = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    ordered.forEach((e, k) => {
      if (e.kind !== 'reopened' || e.check_id !== checkId) return;
      const prior = ordered[k - 1]?.kind;
      if (prior === 'marked_done' || prior === 'unable_to_verify') out.add(fixId);
    });
  }
  return out;
}

type Matcher = (c: AlertChange, rule: AlertRuleInput) => boolean;

function matchers(i: AlertInput): Record<AlertRule['kind'], Matcher> {
  const blocking = (v: Verdict | undefined) => v !== undefined && BLOCKING_VERDICTS.includes(v);
  const drop = textDropPoints(i.textShare);
  const regressed = regressedFixes(i.checkId, i.fixEvents);
  return {
    crawler_blocked: (c) =>
      c.subject === 'crawler_access' &&
      c.ua !== null &&
      (c.kind === 'opened' || c.kind === 'changed') &&
      blocking(i.verdicts.now[c.ua]) &&
      !blocking(i.verdicts.before?.[c.ua]),
    text_drop: (c, rule) =>
      c.kind === 'opened' &&
      c.subject === 'text_without_js' &&
      drop !== null &&
      rule.threshold_points !== null &&
      drop > rule.threshold_points,
    grade_letter_moved: (c) =>
      c.grade_deltas.some((g) => letterOf(g.from_grade) !== letterOf(g.to_grade)),
    new_orphans: (c) => c.kind === 'opened' && c.subject === 'orphans',
    fix_regressed: (c) => c.kind === 'opened' && c.fix_id !== null && regressed.has(c.fix_id),
    any_change: () => true,
  };
}

/** The rule of each kind that applies to the site: its own, else the account's. */
function applicableRules(i: AlertInput): AlertRuleInput[] {
  const byKind = new Map<AlertRule['kind'], AlertRuleInput>();
  for (const r of i.rules) if (r.site_id === i.siteId) byKind.set(r.kind, r);
  for (const r of i.rules) if (r.site_id === null && !byKind.has(r.kind)) byKind.set(r.kind, r);
  return [...byKind.values()];
}

export function evaluateAlerts(i: AlertInput): FiredAlert[] {
  if (i.firstCheck) return [];
  const changes = i.changes.filter(
    (c) => c.check_id === i.checkId && c.site_id === i.siteId && c.kind !== 'baseline',
  );
  if (changes.length === 0) return [];
  const match = matchers(i);
  const out: FiredAlert[] = [];
  for (const rule of applicableRules(i)) {
    if (!rule.enabled || rule.channels.length === 0) continue;
    const ids = [...new Set(changes.filter((c) => match[rule.kind](c, rule)).map((c) => c.id))];
    if (ids.length)
      out.push({ ruleId: rule.id, kind: rule.kind, channels: [...rule.channels], changeIds: ids });
  }
  return out;
}
