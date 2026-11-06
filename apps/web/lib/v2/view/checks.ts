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
  dayOfMonth,
  hourMinute,
  nextWeekly,
  weekday,
  weekdayTime,
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

/** "−1", "+3", "no change": a score's move, with the minus sign the locked screens print. */
export function move(from: number, to: number): string {
  const n = to - from;
  return n === 0 ? 'no change' : n > 0 ? `+${n}` : `−${-n}`;
}

/**
 * The history axis: the first label carries its month ("24 Oct"), as does a label in a new month
 * ("1 Nov"); the others are the day ("26"). The last two carry their weekday ("Thu 29", "Fri 30")
 * unless they carry their month.
 */
export function axisLabels(checks: readonly Check[], zone: string): string[] {
  return checks.map((c, i) => {
    const ts = c.finished_at!;
    const prev = checks[i - 1]?.finished_at;
    const newMonth =
      !prev || dayMonth(prev, zone).split(' ')[1] !== dayMonth(ts, zone).split(' ')[1];
    const day = newMonth ? dayMonth(ts, zone) : dayOfMonth(ts, zone);
    return i >= checks.length - 2 && checks.length > 1 && !newMonth
      ? `${weekday(ts, zone)} ${day}`
      : day;
  });
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

/** "weekly, Fri", "on each deploy", "not scheduled", "paused". */
export function scheduleCell(s: Site): string {
  if (s.paused) return 'paused';
  if (!s.schedule) return 'not scheduled';
  if (s.schedule.cadence === 'on_deploy') return 'on each deploy';
  return `${s.schedule.cadence}, ${WEEKDAYS[s.schedule.iso_weekday!]}`;
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
  return `${dayDateOf(at)} around ${hourMinute(at, zoneOf(v))}`;
}

/** "today 06:02", or "Thu 18:23" for an earlier day. */
export function whenAgo(ts: string, v: AccountView): string {
  const zone = zoneOf(v);
  return calendarDays(ts, v.now, zone) === 0
    ? `today ${hourMinute(ts, zone)}`
    : weekdayTime(ts, zone);
}

export const byFinish = (a: Check, b: Check) => instant(a.finished_at!) - instant(b.finished_at!);
