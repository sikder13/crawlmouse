/**
 * How the account screens read a site's checks: grades, moves between two checks, the history axis,
 * crawler verdicts by check, and when the next check runs. Shared by the dashboard and the site page
 * so the two cannot disagree about the same check.
 */
import {
  instant,
  type Check,
  type CrawlerResult,
  type Site,
  type Verdict,
} from '@crawlmouse/types/v2';
import {
  calendarDays,
  dayMonth,
  hourMinute,
  hourMinuteZoned,
  nextWeekly,
  weekdayTimeZoned,
} from '../format';
import { toneOf } from '../letters';
import { isAi, isBlocked } from '../sentences';
import { numberWord } from '../words';
import type { AccountView } from './account';

export interface GradeCell {
  letter: string;
  score: number;
  tone: 'default' | 'bad';
}

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The account's zone, the one clock every account screen reads (D4). */
export const zoneOf = (v: AccountView) => v.account.timezone;

export const seoOf = (c: Check): GradeCell | null => {
  const t = c.technical_seo;
  return t?.grade && t.score !== null
    ? { letter: t.grade, score: t.score, tone: toneOf(t.grade) }
    : null;
};

export const aiOf = (c: Check): GradeCell | null => {
  const a = c.ai_readability;
  return a && !a.withheld && a.grade && a.total !== null
    ? { letter: a.grade, score: a.total, tone: toneOf(a.grade) }
    : null;
};

/** Both grades, the condition for a site to count in "Health, all sites" (D5). */
export const bothGrades = (c: Check) => seoOf(c) !== null && aiOf(c) !== null;

/**
 * "−1", "+3", "+0.47", "no change": a score's move, with the minus sign the locked screens print.
 * A score has at most two decimals (the engine's), so the move is given to two: the difference of
 * two such numbers as a float is not (82.24 − 81.77 is 0.46999999999999886).
 */
export function move(from: number, to: number): string {
  const n = Math.round((to - from) * 100) / 100;
  return n === 0 ? 'no change' : n > 0 ? `+${n}` : `−${-n}`;
}

/**
 * A history's labels, one form at every check (QA dashboard walk D-25): the day and month in the
 * account's zone ("24 Oct"), and, where two of the checks fall on one day there, each check's time
 * as well ("24 Nov", "02:39"). Day and time are kept apart so a narrow axis can set them on two
 * lines. What this does not tell apart: two checks in one minute, the hour repeated when clocks go
 * back, and the same day a year apart (no year is shown).
 */
export function checkLabels(
  checks: readonly Check[],
  zone: string,
): { date: string; time: string | null }[] {
  const days = checks.map((c) => dayMonth(c.finished_at!, zone));
  const sameDay = new Set(days).size < days.length;
  return checks.map((c, i) => ({
    date: days[i]!,
    time: sameDay ? hourMinute(c.finished_at!, zone) : null,
  }));
}

/** A history's labels on one line each: "24 Oct", or "24 Nov 02:39" (`checkLabels`). */
export function axisLabels(checks: readonly Check[], zone: string): string[] {
  return checkLabels(checks, zone).map((l) => (l.time ? `${l.date} ${l.time}` : l.date));
}

/** Search engines first, then the AI crawlers, in the order the check lists them. */
export const crawlerOrder = (c: Check): CrawlerResult[] => [
  ...c.crawlers.filter((x) => !isAi(x)),
  ...c.crawlers.filter(isAi),
];

/**
 * Labels for one value per check, read aloud as runs: "41 at checks 1 to 5, then 22 at check 6",
 * "blocked by a rule at all six checks", "allowed at both checks".
 */
export function readRuns(labels: readonly string[]): string {
  const runs: { label: string; n: number }[] = [];
  for (const l of labels) {
    const last = runs.at(-1);
    if (last && last.label === l) last.n++;
    else runs.push({ label: l, n: 1 });
  }
  if (runs.length === 1) {
    const n = labels.length;
    return n === 1
      ? `${runs[0]!.label} at the one check`
      : n === 2
        ? `${runs[0]!.label} at both checks`
        : `${runs[0]!.label} at all ${numberWord(n)} checks`;
  }

  let at = 0;
  return runs
    .map((r) => {
      const from = at + 1;
      at += r.n;
      return r.n === 1 ? `${r.label} at check ${from}` : `${r.label} at checks ${from} to ${at}`;
    })
    .join(', then ');
}

/** The verdicts a crawler had at each check (null where a check did not test it). */
export const verdictsAcross = (ua: string, checks: readonly Check[]): (Verdict | null)[] =>
  checks.map((c) => c.crawlers.find((x) => x.ua === ua)?.verdict ?? null);

/** How many AI crawlers a check found blocked, of how many, and the blocking verdicts it counted. */
export function blockedOf(c: Check) {
  const ai = c.crawlers.filter(isAi);
  const hit = ai.filter((x) => isBlocked(x.verdict));
  return { blocked: hit.length, of: ai.length, verdicts: [...new Set(hit.map((x) => x.verdict))] };
}

/**
 * "weekly, Fri", "monthly, first Fri", "on each deploy", "not scheduled", "paused". A monthly check
 * runs on the first such weekday of the month (`next_check_after`), so the cell says so (F-115).
 */
export function scheduleCell(s: Site): string {
  if (s.paused) return 'paused';
  if (!s.schedule) return 'not scheduled';
  if (s.schedule.cadence === 'on_deploy') return 'on each deploy';
  const day = WEEKDAYS[s.schedule.iso_weekday!];
  return s.schedule.cadence === 'monthly' ? `monthly, first ${day}` : `weekly, ${day}`;
}

/**
 * When the next timed check runs, "Fri 6 Nov around 06:00" (FACTS H4: scheduled checks spread
 * over a window that starts at the chosen hour), or null for a site that is not timed.
 */
export function nextCheck(
  s: Site,
  v: AccountView,
  dayDateOf: (ts: string) => string,
): string | null {
  const sch = s.schedule;
  if (s.paused || !sch || sch.cadence !== 'weekly') return null;
  const at = nextWeekly(
    { iso_weekday: sch.iso_weekday!, hour_local: sch.hour_local! },
    v.now,
    zoneOf(v),
  );
  return `${dayDateOf(at)} around ${hourMinuteZoned(at, zoneOf(v))}`;
}

/** "today 06:02", or "Thu 18:23" for an earlier day. */
export function whenAgo(ts: string, v: AccountView): string {
  const zone = zoneOf(v);
  return calendarDays(ts, v.now, zone) === 0
    ? `today ${hourMinuteZoned(ts, zone)}`
    : weekdayTimeZoned(ts, zone);
}

export const byFinish = (a: Check, b: Check) => instant(a.finished_at!) - instant(b.finished_at!);
