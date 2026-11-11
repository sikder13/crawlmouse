/**
 * The dashboard (Final-Dashboard-Day0, Final-Dashboard) as data. One model covers both: on the first
 * run there is one audit and nothing to compare; afterwards each site's latest result is compared
 * with the one before it. Every count, date and price below is read from the viewer's records, the
 * gates or lib/billing/prices.ts (D4–D7).
 */
import {
  instant,
  type Change,
  type Check,
  type CrawlerResult,
  type Site,
  type Verdict,
} from '@crawlmouse/types/v2';
import { AGENCY_MONTHLY } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { TRIAL_DAYS } from '../copy/account';
import { DASHBOARD_COPY as COPY, SETUP_COPY } from '../copy/dashboard';
import { fixesAsOf } from '../fixtures';
import {
  calendarDays,
  daysBefore,
  dayDate,
  dayMonth,
  hourMinute,
  listOf,
  weekday,
  weekdayLong,
  weekdayTime,
} from '../format';
import { isAi, isBlocked } from '../sentences';
import { count, plural } from '../words';
import {
  PLAN_NAMES,
  firstRunNow,
  primarySite,
  primarySites,
  resultChecks,
  viewAt,
  type AccountDataset,
  type AccountView,
  type Viewer,
} from './account';
import {
  aiOf,
  axisLabels,
  bothGrades,
  crawlerOrder,
  move,
  nextCheck,
  readRuns,
  scheduleCell,
  seoOf,
  whenAgo,
  zoneOf,
  type GradeCell,
} from './checks';
import { points, type DoorView } from './result';
import { GRADES, PILL, SUBJECTS } from './segment/changes';
import { effortText } from './segment/fixes';
import { action, type ActionView } from './account-actions';
import {
  FREE_SCHEDULE,
  accountShellView,
  isFirstRun,
  siteWindow,
  type ShellView,
} from './account-shell';

export {
  ACCOUNT_ACTIONS,
  ACCOUNT_NAV,
  action,
  type ActionKey,
  type ActionView,
  type RouteSpec,
} from './account-actions';

/** A pill's tone, as the change pills and the door pills name it. */
type PillState = DoorView['pill']['state'];

// ── The view model ──────────────────────────────────────────────────────────────────────────

export interface HeaderView {
  title: string;
  line: string;
  actions: ActionView[];
}

export interface HealthView {
  /** The mean of both grades over the sites that carry both, rounded; "—" when none does. */
  value: string;
  /** "−2 since Thu": the same mean at the primary site's previous check, over the sites graded at both. */
  delta: string | null;
  deltaTone: 'default' | 'bad';
  /** "1 site excluded: AI readability withheld", or null when every site counts (D5). */
  excluded: string | null;
  /**
   * "1 new": the sites graded now that are on a first baseline (no result at the earlier check, or
   * a new baseline since it), which the move leaves out (owner ruling 2026-11-08). Null when none is.
   */
  fresh: string | null;
}

export interface CountView {
  count: number;
  /** What was counted: "crawlers blocked", "orphan pages". */
  noun: string;
  /** The verdicts behind a "blocked" noun, so the copy guard can check the word. */
  verdicts: Verdict[];
}

export interface StripView {
  title: string;
  health: HealthView;
  opened: CountView;
  resolved: CountView;
  other: { count: number; show: ActionView };
}

export interface ChangeRowView {
  key: string;
  pill: { state: PillState; label: string };
  verdicts: Verdict[];
  title: string;
  line: string;
  actions: ActionView[];
}

export interface HistoryPointView {
  /** The axis label: "24 Oct", "26", "Thu 29". */
  label: string;
  /** The check's date in full, for the text alternative. */
  date: string;
  seo: number | null;
  ai: number | null;
}

export interface HistoryView {
  title: string;
  points: HistoryPointView[];
  /** What the chart shows, said in a sentence (its accessible name). */
  summary: string;
  /** A note beside the AI line where it is flat from the first check. */
  flatNote: string | null;
  /** A marked point where the AI grade moved at a check that blocked crawlers, and their verdicts. */
  marker: { index: number; label: string; verdicts: Verdict[] } | null;
}

export interface CrawlerByCheckView {
  ua: string;
  group: CrawlerResult['group'];
  /** The crawler's verdict at each check drawn, null where a check did not test it. */
  verdicts: (Verdict | null)[];
}

export interface CrawlerNowView {
  ua: string;
  verdict: Verdict;
  /** FACTS B2: "by robots" after a search engine's verdict. */
  qualifier: string | null;
}

export interface SinceCellView {
  opened: number;
  resolved: number;
  other: number;
  pills: { state: PillState; label: string }[];
  verdicts: Verdict[];
}

export interface SiteRowView {
  key: string;
  host: string;
  href: string;
  seo: GradeCell | null;
  ai: GradeCell | null;
  /** The AI grade is withheld at the site's latest result (I4). */
  aiWithheld: boolean;
  since: SinceCellView;
  /** The cell's words when it has no pills: "first audit · 13 fixes", "no change". */
  sinceLabel: string | null;
  schedule: string;
  lastCheck: string;
}

export interface SitesView {
  note: string;
  upsell: ActionView | null;
  rows: SiteRowView[];
  foot: string | null;
}

export interface TopFixRowView {
  key: string;
  number: number;
  title: string;
  effort: string | null;
  effect: string;
  open: ActionView;
}

export interface TopFixesView {
  title: string;
  rows: TopFixRowView[];
  foot: string;
  run: ActionView;
}

export interface SetupItemView {
  key: string;
  label: string;
  done: boolean;
  action: ActionView | null;
}

export interface SetupView {
  title: string;
  items: SetupItemView[];
  /** "Choose the day and hour …": a link, not counted among the things left (Q8). */
  schedule: SetupItemView | null;
  foot: string | null;
}

export interface DashboardView {
  shell: ShellView;
  /** One result per site and nothing to compare: the day-0 layout. */
  firstRun: boolean;
  header: HeaderView;
  strip: StripView | null;
  changed: ChangeRowView[];
  history: HistoryView | null;
  crawlersByCheck: CrawlerByCheckView[] | null;
  /** The legend under the by-check rows: each verdict they show, once. */
  legend: Verdict[];
  crawlersNow: CrawlerNowView[] | null;
  sites: SitesView;
  topFixes: TopFixesView | null;
  setup: SetupView | null;
  threeKinds: { lead: string; body: string; settings: ActionView } | null;
  startPro: { title: string; body: string; start: ActionView } | null;
}

const HISTORY_CHECKS = 6;
/** The fixes the first-run dashboard starts with, as the locked page lists them. */
const TOP_FIXES = 3;
const RUN_BY_YOU = new Set<Check['trigger']>(['manual', 'fix_recheck']);

const latest = (v: AccountView, siteId: string) => resultChecks(v, siteId).at(-1) ?? null;
const previous = (v: AccountView, siteId: string) => resultChecks(v, siteId).at(-2) ?? null;

/**
 * The check "since" names: the primary site's previous result, or, while the primary has one
 * result, the latest previous result of any site. Null on the first run.
 */
function sinceCheck(v: AccountView): Check | null {
  const own = previous(v, primarySite(v).id);
  if (own) return own;
  return (
    v.d.sites
      .map((s) => previous(v, s.id))
      .filter((c): c is Check => c !== null)
      .sort((a, b) => instant(b.finished_at!) - instant(a.finished_at!))[0] ?? null
  );
}

/** The newest result of any site. */
const newestResult = (v: AccountView) =>
  v.d.sites
    .map((s) => latest(v, s.id))
    .filter((c): c is Check => c !== null)
    .sort((a, b) => instant(b.finished_at!) - instant(a.finished_at!))[0] ?? null;

/**
 * How "since" names the earlier check: its weekday ("Thursday", "Thu"), unless a weekday could be
 * read as another check, when the earlier one is a week or more before now or falls on the same
 * weekday as the latest result; then its date ("Fri 23 Oct").
 */
/**
 * A weekday names the earlier check only when it cannot mean another: the check is under a week
 * before now, and the newest result (when it is a different check) fell on another weekday.
 */
export function weekdayAmbiguous(
  prev: string,
  newest: string | null,
  now: string,
  zone: string,
): boolean {
  return (
    calendarDays(prev, now, zone) >= 7 ||
    (newest !== null && weekday(newest, zone) === weekday(prev, zone))
  );
}

function sinceName(
  v: AccountView,
  prev: Check,
): { weekday: string; short: string } | { date: string } {
  const zone = zoneOf(v);
  const newest = newestResult(v);
  const other = newest !== null && newest.id !== prev.id ? newest.finished_at! : null;
  return weekdayAmbiguous(prev.finished_at!, other, v.now, zone)
    ? { date: dayDate(prev.finished_at!, zone) }
    : { weekday: weekdayLong(prev.finished_at!, zone), short: weekday(prev.finished_at!, zone) };
}

/** The verdict a change's crawler had at the check that found it. */
function verdictOf(v: AccountView, c: Change): Verdict | null {
  if (!c.ua) return null;
  const check = v.d.checks.find((x) => x.id === c.check_id);
  return check?.crawlers.find((x) => x.ua === c.ua)?.verdict ?? null;
}

/** Every change is a crawler newly blocked, by robots.txt or a rule: the only case "blocked" may name. */
function allBlocked(v: AccountView, changes: readonly Change[]): boolean {
  return (
    changes.length > 0 &&
    changes.every((c) => {
      const verdict = verdictOf(v, c);
      return c.subject === 'crawler_access' && verdict !== null && isBlocked(verdict);
    })
  );
}

function countOf(v: AccountView, changes: readonly Change[]): CountView {
  const verdicts = changes.flatMap((c) => verdictOf(v, c) ?? []);
  if (!changes.length) return { count: 0, noun: '', verdicts };
  // One crawler per change, so the count is a count of crawlers only when every one is blocked.
  if (allBlocked(v, changes)) {
    return {
      count: changes.length,
      noun: plural(changes.length, 'crawler blocked', 'crawlers blocked'),
      verdicts,
    };
  }
  const subjects = [...new Set(changes.map((c) => SUBJECTS[c.subject]))];
  return {
    count: changes.length,
    noun: `${plural(changes.length, 'change', 'changes')}: ${listOf(subjects)}`,
    verdicts,
  };
}

function since(v: AccountView, site: Site): SinceCellView {
  const w = siteWindow(v, site);
  const opened = w.filter((c) => c.kind === 'opened');
  const resolved = w.filter((c) => c.kind === 'resolved');
  const pills: SinceCellView['pills'] = [];
  if (opened.length) {
    pills.push({
      state: PILL.opened,
      label: `${opened.length} ${allBlocked(v, opened) ? 'blocked' : 'opened'}`,
    });
  }
  if (resolved.length) pills.push({ state: PILL.resolved, label: `${resolved.length} resolved` });
  return {
    opened: opened.length,
    resolved: resolved.length,
    other: w.length - opened.length - resolved.length,
    pills,
    verdicts: opened.flatMap((c) => verdictOf(v, c) ?? []),
  };
}

function sinceLabel(v: AccountView, site: Site, cell: SinceCellView): string | null {
  if (cell.pills.length) return null;
  const results = resultChecks(v, site.id);
  if (!results.length) return 'no result yet';
  if (results.length === 1) {
    const n = fixesAsOf(v.d, results[0]!).length;
    return `first audit · ${n} ${plural(n, 'fix', 'fixes')}`;
  }
  return cell.other
    ? `${cell.other} other ${plural(cell.other, 'change', 'changes')}`
    : 'no change';
}

/** "Fri 06:01", with what has happened since: "· check queued", "· last check failed". */
function lastCheck(v: AccountView, site: Site): string {
  const result = latest(v, site.id);
  const zone = zoneOf(v);
  const ended = v.d.checks
    .filter((c) => c.site_id === site.id)
    .sort((a, b) => instant(a.finished_at!) - instant(b.finished_at!))
    .at(-1);
  const parts = [result ? weekdayTime(result.finished_at!, zone) : '—'];
  if (ended && ended !== result && ended.status === 'failed') parts.push('latest check failed');
  for (const f of v.inFlight.filter((x) => x.siteId === site.id)) parts.push(`check ${f.status}`);
  return parts.join(' · ');
}

/** Each site's both-grades values at a moment, and why the others were left out (D5). */
function healthAt(v: AccountView) {
  const values = new Map<string, [number, number]>();
  const left: Record<string, number> = {};
  const leave = (why: string) => (left[why] = (left[why] ?? 0) + 1);
  for (const s of v.d.sites) {
    const c = latest(v, s.id);
    if (!c) leave('no finished check yet');
    else if (c.ai_readability?.withheld) leave('AI readability withheld');
    else if (!bothGrades(c)) leave('Technical SEO not graded');
    else values.set(s.id, [seoOf(c)!.score, aiOf(c)!.score]);
  }
  return { values, left };
}

const meanOf = (pairs: Iterable<[number, number]>) => {
  const all = [...pairs].flat();
  return all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;
};

/**
 * The health move compares like with like: the mean of the sites graded at both moments, then and
 * now. A site graded at only one of them is left out of both means, and so is a site on a first
 * baseline (`fresh`), whose earlier result does not compare with its latest (owner ruling 2026-11-08).
 */
export function moveOver(
  then: ReadonlyMap<string, [number, number]>,
  now: ReadonlyMap<string, [number, number]>,
  fresh: ReadonlySet<string> = new Set(),
) {
  const both = [...now.keys()].filter((id) => then.has(id) && !fresh.has(id));
  return {
    both,
    a: meanOf(both.map((id) => then.get(id)!)),
    b: meanOf(both.map((id) => now.get(id)!)),
  };
}

/**
 * The sites graded now that are on a first baseline at `at`: no result yet when `then` was read,
 * or a `baseline` change recorded after it (the grading changed, and earlier results are not
 * compared). Read from the records, so the "N new" beside the move is counted, never typed.
 */
export function firstBaselines(
  v: AccountView,
  then: AccountView,
  graded: Iterable<string>,
  at: number,
): Set<string> {
  const out = new Set<string>();
  for (const id of graded) {
    const rebased = v.d.changes.some(
      (c) => c.site_id === id && c.kind === 'baseline' && instant(c.detected_at) > at,
    );
    if (latest(then, id) === null || rebased) out.add(id);
  }
  return out;
}

function health(d: AccountDataset, viewer: Viewer, v: AccountView): HealthView {
  const now = healthAt(v);
  const value = meanOf(now.values.values());
  // withheld first: it is the reason D5 names
  const reasons = Object.entries(now.left).sort(([a], [b]) =>
    a === 'AI readability withheld' ? -1 : b === 'AI readability withheld' ? 1 : a.localeCompare(b),
  );
  const excluded = reasons.length
    ? reasons.map(([why, n]) => `${n} ${plural(n, 'site', 'sites')} excluded: ${why}`).join('; ')
    : null;

  const prev = sinceCheck(v);
  let delta: string | null = null;
  let deltaTone: HealthView['deltaTone'] = 'default';
  let fresh: string | null = null;
  if (prev && value !== null) {
    // The account may have begun after that check finished (its first audit runs before sign-up):
    // read the sites as they stood then, from the moment the account can be read at all.
    const at = Math.max(instant(prev.finished_at!), instant(firstRunNow(d, viewer)));
    const vThen = viewAt(d, { ...viewer, now: new Date(at).toISOString() });
    const then = healthAt(vThen);
    const newOnes = firstBaselines(v, vThen, now.values.keys(), at);
    const { both, a, b } = moveOver(then.values, now.values, newOnes);
    if (a !== null && b !== null) {
      // Sites left out for another reason than a first baseline (graded then, withheld now) are
      // said with the count the move is taken over.
      const over =
        both.length === now.values.size - newOnes.size
          ? ''
          : `, over the ${both.length} ${plural(both.length, 'site', 'sites')} graded at both`;
      const name = sinceName(v, prev);
      delta = `${move(a, b)} since ${'weekday' in name ? name.short : name.date}${over}`;
      deltaTone = b < a ? 'bad' : 'default';
      fresh = newOnes.size ? `${newOnes.size} new` : null;
    }
  }
  return { value: value === null ? '—' : String(value), delta, deltaTone, excluded, fresh };
}

/** The grade moves recorded at a check, as "AI readability D → F" (FACTS row 98, Q12). */
function gradeMoves(v: AccountView, checkId: string): string[] {
  return v.d.changes
    .filter((c) => c.check_id === checkId && c.subject === 'grade')
    .flatMap((c) => c.grade_deltas)
    .map((g) => `${GRADES[g.grade]} ${g.from_grade} → ${g.to_grade}`);
}

function changeRow(v: AccountView, site: Site, c: Change): ChangeRowView {
  const zone = zoneOf(v);
  const verdict = verdictOf(v, c);
  const blocked = allBlocked(v, [c]);
  const fix = c.fix_id ? v.d.fixes.find((f) => f.id === c.fix_id) : undefined;
  const parts =
    c.kind === 'resolved'
      ? [
          weekdayTime(c.detected_at, zone),
          ...c.grade_deltas.map((g) => `${GRADES[g.grade]} ${g.from_grade} → ${g.to_grade}`),
          fix && v.d.fix_events.some((e) => e.fix_id === fix.id && e.kind === 'marked_done')
            ? 'from your fix list'
            : null,
        ]
      : [
          `Detected ${weekdayTime(c.detected_at, zone)}`,
          c.cause?.changed_at
            ? `${c.where} changed ${weekdayTime(c.cause.changed_at, zone)}`
            : null,
          `${count(c.pages_affected)} ${plural(c.pages_affected, 'page', 'pages')}`,
          ...gradeMoves(v, c.check_id).map((m) => `this check: ${m}`),
          c.notified?.channels.includes('slack')
            ? `sent to Slack${c.notified.slack_channel ? ` ${c.notified.slack_channel}` : ''}`
            : c.notified
              ? 'sent by email'
              : null,
        ];
  const openFix = fix && fix.status !== 'verified_resolved';
  return {
    key: c.id,
    pill: { state: PILL[c.kind], label: blocked ? 'blocked' : c.kind },
    verdicts: verdict ? [verdict] : [],
    title: c.summary,
    line: parts.filter(Boolean).join(' · '),
    actions: [
      action(
        'changeLog',
        'Diff',
        {},
        {
          query: `?site=${site.id}&change=${c.id}`,
          context: `for: ${c.summary}`,
        },
      ),
      ...(openFix
        ? [
            action(
              'copyFix',
              'Copy fix',
              { id: fix.id },
              { context: `for: ${c.summary}`, copy: true },
            ),
            action(
              'emailDeveloper',
              'Email to my developer',
              { id: fix.id },
              {
                context: `about: ${c.summary}`,
                input: { name: 'email', type: 'email', ...COPY.developerField },
              },
            ),
          ]
        : []),
    ],
  };
}

function history(v: AccountView, site: Site): HistoryView | null {
  const all = resultChecks(v, site.id);
  if (all.length < 2) return null;
  const zone = zoneOf(v);
  const shown = all.slice(-HISTORY_CHECKS);
  const labels = axisLabels(shown, zone);
  const points = shown.map((c, i) => ({
    label: labels[i]!,
    date: dayDate(c.finished_at!, zone),
    seo: seoOf(c)?.score ?? null,
    ai: aiOf(c)?.score ?? null,
  }));
  const byYou = all.filter((c) => RUN_BY_YOU.has(c.trigger)).length;
  const say = (xs: (number | null)[]) =>
    readRuns(xs.map((x) => (x === null ? 'not graded' : String(x))));
  const ai = points.map((p) => p.ai);
  const flat = ai.findIndex((x) => x !== ai[0]);
  const flatRun = flat === -1 ? ai.length : flat;
  // the first point where the AI grade moves, at a check that newly blocked crawlers
  const markAt = flat === -1 ? -1 : flat;
  const blockedThere =
    markAt >= 0
      ? v.d.changes.filter(
          (c) => c.check_id === shown[markAt]!.id && c.kind === 'opened' && allBlocked(v, [c]),
        )
      : [];
  return {
    title: `${site.host} · ${all.length} checks since ${dayMonth(all[0]!.finished_at!, zone)}${
      byYou ? `, ${byYou} of them run by you` : ''
    }`,
    points,
    summary: `Technical SEO ${say(points.map((p) => p.seo))}; AI readability ${say(ai)}`,
    flatNote:
      flatRun >= 2 && ai[0] !== null ? `AI readability · ${ai[0]} since the first audit` : null,
    marker: blockedThere.length
      ? {
          index: markAt,
          label: `${listOf(blockedThere.map((c) => c.ua!))} blocked · ${ai[markAt]}`,
          verdicts: blockedThere.flatMap((c) => verdictOf(v, c) ?? []),
        }
      : null,
  };
}

function crawlersByCheck(v: AccountView, site: Site): CrawlerByCheckView[] | null {
  const shown = resultChecks(v, site.id).slice(-HISTORY_CHECKS);
  const last = shown.at(-1);
  if (!last || shown.length < 2) return null;
  return crawlerOrder(last)
    .filter(isAi)
    .map((r) => ({
      ua: r.ua,
      group: r.group,
      verdicts: shown.map((c) => c.crawlers.find((x) => x.ua === r.ua)?.verdict ?? null),
    }));
}

function setup(v: AccountView, site: Site, firstRun: boolean, trial: boolean): SetupView | null {
  const g = v.gates;
  if (v.tier === 'free') return null;
  const connected = (...kinds: string[]) =>
    v.account.integrations.some((i) => kinds.includes(i.kind) && i.connected);
  const competitors = v.account.limits.competitors_per_site;
  const items: SetupItemView[] = [];
  // Two rows can share a control's label ("Connect", "Add"), and the table has no row header, so
  // each control is named for its row's subject, taken from the row's own words.
  const item = (
    key: string,
    done: boolean,
    subject: string,
    todo: string,
    doneLabel: string,
    act: ActionView,
  ) => {
    if (!todo.includes(subject)) {
      throw new Error(`set-up item ${key}: its row does not name its subject "${subject}"`);
    }
    items.push({
      key,
      label: done ? doneLabel : todo,
      done,
      action: done ? null : { ...act, context: `for ${subject}` },
    });
  };
  const settings = (label: string) =>
    action('sitePage', label, { id: site.id }, { query: '#settings' });
  if (g.slack) {
    item(
      'slack',
      connected('slack'),
      SETUP_COPY.slack.subject,
      SETUP_COPY.slack.todo,
      SETUP_COPY.slack.done,
      action('integrations', 'Connect'),
    );
  }
  if (g.competitorsPerSite > 0) {
    const n = site.competitor_hosts.length;
    item(
      'competitor',
      n > 0,
      SETUP_COPY.competitor.subject(competitors),
      SETUP_COPY.competitor.todo(competitors),
      SETUP_COPY.competitor.done(n),
      settings('Add'),
    );
  }
  if (g.searchConsole) {
    item(
      'search_console',
      connected('search_console'),
      SETUP_COPY.searchConsole.subject,
      SETUP_COPY.searchConsole.todo,
      SETUP_COPY.searchConsole.done,
      action('integrations', 'Connect'),
    );
  }
  if (g.stagingAndDeployHooks) {
    const done = v.d.sites.some((s) => s.staging_of_site_id === site.id);
    item(
      'staging',
      done,
      SETUP_COPY.staging.subject,
      SETUP_COPY.staging.todo,
      SETUP_COPY.staging.done,
      settings('Add'),
    );
  }
  if (g.observedCrawlerActivity) {
    item(
      'observed',
      connected('cloudflare_analytics', 'vercel_drain'),
      SETUP_COPY.observed.subject,
      SETUP_COPY.observed.todo,
      SETUP_COPY.observed.done,
      action('integrations', 'Connect'),
    );
  }
  const left = items.filter((i) => !i.done).length;
  const sch = site.schedule;
  const schedule =
    !firstRun && sch?.cadence === 'weekly'
      ? {
          key: 'schedule',
          label: SETUP_COPY.schedule(
            `${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][sch.iso_weekday!]} around ${String(sch.hour_local).padStart(2, '0')}:00`,
          ),
          done: false,
          action: settings('Set the day'),
        }
      : null;
  return {
    title: firstRun && trial ? COPY.setupTrialTitle : COPY.setupLeftTitle(left),
    items,
    schedule,
    foot: firstRun && trial ? COPY.setupTrialFoot(items.length) : null,
  };
}

/** The add-site action: the slots left, or the plans when none is. */
function addSiteAction(v: AccountView, primaryAction = false): ActionView {
  const slots = primarySites(v).length;
  const limit = v.account.limits.sites;
  const label = `Add a site · ${slots} of ${limit} on ${PLAN_NAMES[v.tier]}`;
  return slots >= limit
    ? action('pricing', label, {}, { context: '(see the plans with more sites)' })
    : action(
        'addSite',
        label,
        {},
        {
          primary: primaryAction,
          input: { name: 'host', type: 'text', ...COPY.siteField },
        },
      );
}

/** The one-time offer of a Pro trial: a Free account that never had a trial (H5). */
function startPro(v: AccountView): DashboardView['startPro'] {
  return v.account.state === 'free' &&
    !v.account.state_history.some((h) => h.state.endsWith('_trial'))
    ? {
        title: COPY.startProHeading,
        body: COPY.startProBody(TRIAL_DAYS, GATES.pro.competitorsPerSite, GATES.pro.sites),
        start: action(
          'startTrial',
          COPY.startProTitle(TRIAL_DAYS),
          {},
          {
            fields: { accountId: v.account.id },
          },
        ),
      }
    : null;
}

/** Day 0 before any site: the header asks for one, and nothing else is measured yet. */
function noSiteView(v: AccountView): DashboardView {
  const zone = zoneOf(v);
  const trial = v.account.state === 'pro_trial' || v.account.state === 'agency_trial';
  return {
    shell: accountShellView(v, 'Sites'),
    firstRun: true,
    header: {
      title: COPY.noSiteTitle,
      line: [
        dayDate(v.now, zone),
        '0 sites',
        trial ? `trial ends ${dayDate(v.account.trial_ends_at!, zone)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      actions: [addSiteAction(v, true)],
    },
    strip: null,
    changed: [],
    history: null,
    crawlersByCheck: null,
    legend: [],
    crawlersNow: null,
    sites: {
      note: `0 of ${v.account.limits.sites} on ${PLAN_NAMES[v.tier]}`,
      upsell: null,
      rows: [],
      foot: COPY.noSiteNote,
    },
    topFixes: null,
    setup: null,
    threeKinds: null,
    startPro: startPro(v),
  };
}

export function dashboardView(d: AccountDataset, viewer: Viewer): DashboardView {
  const v = viewAt(d, viewer);
  if (primarySites(v).length === 0) return noSiteView(v);
  const zone = zoneOf(v);
  const primary = primarySite(v);
  const result = latest(v, primary.id);
  const firstRun = isFirstRun(v);
  const trial = v.account.state === 'pro_trial' || v.account.state === 'agency_trial';
  const slots = primarySites(v).length;
  const limit = v.account.limits.sites;
  const plan = PLAN_NAMES[v.tier];

  const changed = firstRun
    ? []
    : v.d.sites.flatMap((s) =>
        siteWindow(v, s)
          .filter((c) => c.kind === 'opened' || c.kind === 'resolved')
          .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'opened' ? -1 : 1))
          .map((c) => changeRow(v, s, c)),
      );

  const fixes = result ? fixesAsOf(v.d, result) : [];
  const first = fixes[0];
  const next = nextCheck(primary, v, (ts) => dayDate(ts, zone));
  const trialEnds = trial ? `trial ends ${dayDate(v.account.trial_ends_at!, zone)}` : null;
  const flight = v.inFlight.filter((f) => f.siteId === primary.id).map((f) => `check ${f.status}`);
  const sitesWord = `${v.d.sites.length} ${plural(v.d.sites.length, 'site', 'sites')}`;
  const prev = sinceCheck(v);

  const addSite = addSiteAction(v);
  const openAudit = (label: string, primaryAction = false) =>
    action('openAudit', label, { checkId: result!.id }, { primary: primaryAction });
  const runCheck = (primaryAction: boolean) =>
    action('runCheck', 'Run a check now', { id: primary.id }, { primary: primaryAction });

  const header: HeaderView = firstRun
    ? {
        title: COPY.kept(primary.host),
        line: [
          dayDate(v.now, zone),
          sitesWord,
          result ? `audited ${hourMinute(result.finished_at!, zone)}` : null,
          ...flight,
          next ? `next weekly check ${next}` : null,
          trialEnds,
        ]
          .filter(Boolean)
          .join(' · '),
        actions: first
          ? [
              addSite,
              openAudit('Open the audit'),
              action(
                'packet',
                `Start with fix ${first.number}${effortText(first) ? ` · ${effortText(first)}` : ''}`,
                { checkId: result!.id, fixId: first.id },
                { primary: true },
              ),
            ]
          : result
            ? [addSite, openAudit('Open the audit', true)]
            : [addSite],
      }
    : {
        title: COPY.since(sinceName(v, prev!)),
        line: [
          dayDate(v.now, zone),
          sitesWord,
          `last check ${whenAgo((result ?? newestResult(v))!.finished_at!, v)}`,
          ...flight,
          next ? `next weekly check ${next}` : null,
          trialEnds,
        ]
          .filter(Boolean)
          .join(' · '),
        actions: [addSite, runCheck(true)],
      };

  const rows = v.d.sites.map((s): SiteRowView => {
    const c = latest(v, s.id);
    const cell = since(v, s);
    return {
      key: s.id,
      host: s.host,
      href: action('sitePage', s.host, { id: s.id }).href,
      seo: c ? seoOf(c) : null,
      ai: c ? aiOf(c) : null,
      aiWithheld: c?.ai_readability?.withheld ?? false,
      since: cell,
      sinceLabel: sinceLabel(v, s, cell),
      schedule: scheduleCell(s),
      lastCheck: lastCheck(v, s),
    };
  });

  const window = v.d.sites.flatMap((s) => siteWindow(v, s));
  const strip: StripView | null = firstRun
    ? null
    : {
        title: COPY.since(sinceName(v, prev!)),
        health: health(d, viewer, v),
        opened: countOf(
          v,
          window.filter((c) => c.kind === 'opened'),
        ),
        resolved: countOf(
          v,
          window.filter((c) => c.kind === 'resolved'),
        ),
        other: {
          count: window.filter((c) => c.kind !== 'opened' && c.kind !== 'resolved').length,
          show: action('changeLog', 'Show', {}, { context: 'the other changes' }),
        },
      };

  const now = result && !firstRun ? crawlerOrder(result) : null;
  const byCheck = firstRun ? null : crawlersByCheck(v, primary);
  const legendVerdicts = [
    ...new Set((byCheck ?? []).flatMap((r) => r.verdicts).filter((x): x is Verdict => x !== null)),
  ];
  const free = FREE_SCHEDULE[GATES.free.schedule];
  const kinds = COPY.emailKinds(
    v.account.email_prefs.change_notes,
    trial && v.account.email_prefs.trial_reminder
      ? dayDate(daysBefore(v.account.trial_ends_at!, 3, zone), zone)
      : null,
  );
  const daysLeft = trial ? calendarDays(v.now, v.account.trial_ends_at!, zone) : null;

  return {
    shell: accountShellView(v, 'Sites'),
    firstRun,
    header,
    strip,
    changed,
    history: firstRun ? null : history(v, primary),
    crawlersByCheck: byCheck,
    legend: legendVerdicts,
    crawlersNow: now
      ? now.map((r) => ({
          ua: r.ua,
          verdict: r.verdict,
          qualifier: r.group === 'search_engine' && r.verdict === 'allowed' ? 'by robots' : null,
        }))
      : null,
    sites: {
      note: firstRun && trial ? COPY.sitesFirstRun(free) : `${slots} of ${limit} on ${plan}`,
      upsell:
        v.tier === 'pro' && slots >= limit
          ? action(
              'pricing',
              `Need more? Agency watches ${GATES.agency.sites}, $${AGENCY_MONTHLY} a month`,
            )
          : null,
      rows,
      foot: firstRun ? COPY.firstRunNote(primary.schedule?.cadence ?? null) : null,
    },
    topFixes:
      firstRun && result && fixes.length
        ? {
            title: COPY.topFixesTitle,
            rows: fixes.slice(0, TOP_FIXES).map((f) => ({
              key: f.id,
              number: f.number,
              title: f.title,
              effort: effortText(f),
              effect: points(f, fixes),
              open: action('packet', 'Open', { checkId: result.id, fixId: f.id }),
            })),
            foot: COPY.topFixesFoot(
              Math.max(0, fixes.length - TOP_FIXES),
              daysLeft !== null
                ? `open for ${daysLeft} ${plural(daysLeft, 'day', 'days')}`
                : v.tier === 'free'
                  ? 'on Pro'
                  : 'open',
            ),
            run: runCheck(false),
          }
        : null,
    setup: setup(v, primary, firstRun, trial),
    threeKinds:
      firstRun && trial
        ? {
            lead: COPY.threeKindsLead(kinds.length),
            body: COPY.threeKinds(kinds),
            settings: action('emailSettings', 'Email settings'),
          }
        : null,
    startPro: startPro(v),
  };
}
