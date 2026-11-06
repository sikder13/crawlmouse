/**
 * The site page (Final-Site) as data: one site's grades over its checks, its crawlers by check, its
 * fixes, its settings and the alert rules that apply to it, all as the viewer's account holds them
 * at `now`.
 */
import {
  instant,
  scoredCrawlersMeasured,
  type Check,
  type CrawlerResult,
  type Fix,
  type FixtureDataset,
  type Site,
  type Verdict,
} from '@crawlmouse/types/v2';
import { TAGGED_UA_LINE, ALERT_LABELS, SITE_COPY } from '../copy/site';
import { fixesAsOf } from '../fixtures';
import {
  calendarDays,
  dayDate,
  dayMonth,
  listOf,
  percent,
  weekday,
  weekdayLong,
  weekdayTime,
  zoneName,
} from '../format';
import { aiWithheldSummary } from '../sentences';
import { capitalise, count, numberWord, plural } from '../words';
import { PLAN_NAMES, resultChecks, viewAt, type AccountView, type Viewer } from './account';
import {
  aiOf,
  axisLabels,
  blockedOf,
  crawlerOrder,
  move,
  nextCheck,
  scheduleCell,
  seoOf,
  whenAgo,
  zoneOf,
} from './checks';
import { action, type ActionView } from './account-actions';
import { isFreeFix } from './free-fixes';
import { points } from './result';
import { CAUSE_SHORT } from './segment/access';
import { groupPoints } from './segment/fixes';
import { SEGMENTS } from './segment/frame';

export interface GradeCardView {
  label: string;
  /** Null when withheld. */
  letter: string | null;
  score: number | null;
  tone: 'default' | 'bad';
  /** "−1 since Thu"; null with no earlier result to compare. */
  move: string | null;
  /** "Structure 74 · Orphans 7 · Depth 2.4". */
  parts: string | null;
  /** Why the grade is withheld (I4), or null. */
  withheld: string | null;
}

export interface CrawlerGridRowView {
  ua: string;
  group: CrawlerResult['group'];
  /** The verdict at each check drawn, null where a check did not test it. */
  verdicts: (Verdict | null)[];
  /** What is in the way now, from the latest result's own fields. */
  cause: string;
  /** The verdict differs from the check before: the row is the news. */
  changedNow: boolean;
}

export interface FixRowView {
  key: string;
  number: number;
  title: string;
  /** First seen at the latest result. */
  isNew: boolean;
  newLabel: string | null;
  /** The recorded diff behind the fix, for a fix a change points to. */
  diff: string | null;
  /** What happened to it: "marked done Wed; the re-check that day did not agree, …". */
  note: string | null;
  section: string;
  effect: string;
  status: string;
  /** Outside the three Free shows (BUILD §3: the three largest open fixes). */
  pro: boolean;
  packet: ActionView;
}

export interface SiteView {
  header: { title: string; line: string; actions: ActionView[] };
  grades: {
    title: string;
    sub: string;
    cards: [GradeCardView, GradeCardView];
    actions: ActionView[];
  };
  crawlers: { columns: string[]; rows: CrawlerGridRowView[]; note: string };
  fixes: {
    title: string;
    sub: string;
    copyAll: string | null;
    rows: FixRowView[];
    rest: {
      numbers: string;
      count: number;
      title: string;
      effect: string;
      status: string;
      show: ActionView;
    } | null;
  };
  settings: {
    rows: {
      label: string;
      value: string;
      mono: boolean;
      muted: boolean;
      action: ActionView | null;
    }[];
  };
  alerts: {
    rows: {
      key: string;
      label: string;
      on: boolean;
      fired: string | null;
      extra: string | null;
      toggle: ActionView;
    }[];
    foot: string;
  };
}

const SHOWN_CHECKS = 6;
const SHOWN_FIXES = 5;
const RUN_BY_YOU = new Set<Check['trigger']>(['manual', 'fix_recheck']);

const SECTION_LABEL = Object.fromEntries(
  Object.values(SEGMENTS).flatMap((s) => (s.section ? [[s.section, s.tab]] : [])),
) as Record<Fix['section'], string>;

const STATUS_LABEL: Record<Fix['status'], string> = {
  open: 'open',
  reopened: 'open',
  marked_done: 'marked done',
  unable_to_verify: 'could not verify',
  verified_resolved: 'resolved',
};

/** "26–29 Oct", "26 Oct", or a list where the dates are not consecutive. */
function dateRange(ts: readonly string[], zone: string): string {
  const days = [...new Set(ts.map((t) => dayMonth(t, zone)))];
  const first = ts[0]!;
  const last = ts.at(-1)!;
  const span = calendarDays(first, last, zone) + 1;
  if (days.length === 1) return days[0]!;
  const [d1, m1] = days[0]!.split(' ');
  const [d2, m2] = days.at(-1)!.split(' ');
  return span === days.length && m1 === m2 ? `${d1}–${d2} ${m2}` : listOf(days);
}

/** "24 Oct the first audit, 26–29 Oct run by you, weekly from Fri 30 Oct around 06:00". */
function checksLine(checks: readonly Check[], site: Site, zone: string): string {
  const parts: string[] = [];
  const firstAudit = checks.find((c) => c.trigger === 'first_audit');
  if (firstAudit) parts.push(`${dayMonth(firstAudit.finished_at!, zone)} the first audit`);
  const byYou = checks.filter((c) => RUN_BY_YOU.has(c.trigger)).map((c) => c.finished_at!);
  if (byYou.length) parts.push(`${dateRange(byYou, zone)} run by you`);
  const deploys = checks.filter((c) => c.trigger === 'deploy').length;
  if (deploys) parts.push(`${deploys} on ${plural(deploys, 'a deploy', 'deploys')}`);
  const scheduled = checks.find((c) => c.trigger === 'scheduled');
  if (scheduled && site.schedule && site.schedule.cadence !== 'on_deploy') {
    parts.push(
      `${site.schedule.cadence} from ${dayDate(scheduled.finished_at!, zone)} around ${String(site.schedule.hour_local).padStart(2, '0')}:00`,
    );
  }
  return parts.join(', ');
}

function seoCard(c: Check, prev: Check | null, zone: string): GradeCardView {
  const g = seoOf(c);
  const was = prev ? seoOf(prev) : null;
  const t = c.technical_seo;
  const s = c.structure;
  const parts = [
    t?.site_structure_score != null ? `Structure ${Math.round(t.site_structure_score)}` : null,
    s ? `Orphans ${s.orphan_pages}` : null,
    s ? `Depth ${s.avg_click_depth}` : null,
  ].filter(Boolean);
  return {
    label: 'Technical SEO',
    letter: g?.letter ?? null,
    score: g?.score ?? null,
    tone: g?.tone ?? 'default',
    move:
      g && was ? `${move(was.score, g.score)} since ${weekday(prev!.finished_at!, zone)}` : null,
    parts: parts.length ? parts.join(' · ') : null,
    withheld: g ? null : 'Technical SEO was not graded at this check.',
  };
}

function aiCard(c: Check, prev: Check | null, zone: string): GradeCardView {
  const g = aiOf(c);
  const was = prev ? aiOf(prev) : null;
  const { blocked, of } = blockedOf(c);
  const parts = [
    `Crawlers blocked ${blocked} of ${of}`,
    c.without_js ? `Text without JS ${percent(c.without_js.site_text_share)}%` : null,
    c.content?.score != null ? `Quotable ${c.content.score}` : null,
  ].filter(Boolean);
  return {
    label: 'AI readability',
    letter: g?.letter ?? null,
    score: g?.score ?? null,
    tone: g?.tone ?? 'default',
    move:
      g && was ? `${move(was.score, g.score)} since ${weekday(prev!.finished_at!, zone)}` : null,
    parts: parts.join(' · '),
    withheld: c.ai_readability?.withheld
      ? aiWithheldSummary(c, scoredCrawlersMeasured(c.crawlers))
      : null,
  };
}

/** What is in the way of a crawler now, from the result's cause and the change that recorded it. */
function causeNow(r: CrawlerResult, v: AccountView): string {
  if (r.group === 'search_engine' && r.verdict === 'allowed') return SITE_COPY.searchEngineCause;
  if (!r.cause) return '—';
  if (r.cause === 'client_rendered_template' && r.text_share !== null)
    return `client-rendered template, ${percent(r.text_share)}%`;
  if (r.cause === 'robots_txt_disallow') {
    const change = v.d.changes
      .filter((c) => c.ua === r.ua && c.kind === 'opened' && c.cause?.changed_at)
      .sort((a, b) => instant(b.detected_at) - instant(a.detected_at))[0];
    if (change)
      return `robots.txt changed ${weekdayTime(change.cause!.changed_at!, zoneOf(v))}: ${r.ua} disallowed`;
  }
  return CAUSE_SHORT[r.cause];
}

/** "robots.txt, Thu 19:40 · + User-agent: ClaudeBot · … · three lines to delete, then mark done". */
function diffOf(v: AccountView, f: Fix): string | null {
  const change = v.d.changes.find((c) => c.fix_id === f.id && c.cause?.diff);
  const diff = change?.cause?.diff;
  if (!change || !diff) return null;
  const lines = [...diff.removed.map((l) => `− ${l}`), ...diff.added.map((l) => `+ ${l}`)];
  const when = change.cause!.changed_at
    ? `, ${weekdayTime(change.cause!.changed_at, zoneOf(v))}`
    : '';
  const n = diff.added.length;
  return [
    `${change.where}${when}`,
    ...lines,
    n ? `${numberWord(n)} ${plural(n, 'line', 'lines')} to delete, then mark done` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What the fix's events say about it, when there is more than "open". */
function noteOf(v: AccountView, f: Fix): string | null {
  const zone = zoneOf(v);
  const events = v.d.fix_events
    .filter((e) => e.fix_id === f.id)
    .sort((a, b) => instant(a.at) - instant(b.at));
  const marked = events.filter((e) => e.kind === 'marked_done').at(-1);
  if (!marked) return null;
  if (f.status === 'marked_done')
    return `marked done ${weekday(marked.at, zone)}; re-check pending`;
  const reopened = events.find((e) => e.kind === 'reopened' && instant(e.at) >= instant(marked.at));
  if (f.status === 'reopened' && reopened) {
    const when =
      calendarDays(marked.at, reopened.at, zone) === 0
        ? 'that day'
        : `on ${weekday(reopened.at, zone)}`;
    return `marked done ${weekday(marked.at, zone)}; the re-check ${when} did not agree, so it stays open`;
  }
  return null;
}

function fixRow(v: AccountView, result: Check, f: Fix, all: readonly Fix[]): FixRowView {
  const isNew = f.first_seen_check_id === result.id && result.previous_check_id !== null;
  const pro = !isFreeFix(v.d, result, f);
  return {
    key: f.id,
    number: f.number,
    title: f.title,
    isNew,
    newLabel: isNew ? `new ${weekday(result.finished_at!, zoneOf(v))}` : null,
    diff: diffOf(v, f),
    note: noteOf(v, f),
    section: SECTION_LABEL[f.section],
    effect: points(f, all),
    status: `${STATUS_LABEL[f.status]}${pro ? ' · Pro' : ''}`,
    pro,
    packet: action('packet', 'Packet', { checkId: result.id, fixId: f.id }),
  };
}

function scheduleValue(s: Site, zone: string): string {
  const sch = s.schedule;
  if (!sch || s.paused || sch.cadence === 'on_deploy') return scheduleCell(s);
  return `${scheduleCell(s)} around ${String(sch.hour_local).padStart(2, '0')}:00, ${zoneName(zone)}`;
}

export function siteView(d: FixtureDataset, viewer: Viewer, siteId: string): SiteView {
  const v = viewAt(d, viewer);
  const zone = zoneOf(v);
  const site = v.d.sites.find((s) => s.id === siteId);
  if (!site) throw new Error(`Site ${siteId} is not the viewer’s at ${viewer.now}`);
  const all = resultChecks(v, site.id);
  const result = all.at(-1);
  if (!result) throw new Error(`Site ${site.host} has no result at ${viewer.now}`);
  const prev = all.at(-2) ?? null;
  const shown = all.slice(-SHOWN_CHECKS);

  // ── header ──
  const fixes = fixesAsOf(v.d, result);
  const fresh = fixes.filter(
    (f) => f.first_seen_check_id === result.id && result.previous_check_id !== null,
  );
  const before = fixes.length - fresh.length;
  const firstAudit = all.find((c) => c.trigger === 'first_audit');
  const fromAudit = fixes.every(
    (f) => fresh.includes(f) || f.first_seen_check_id === firstAudit?.id,
  );
  const fixLine = !fixes.length
    ? 'no fixes'
    : fresh.length && before
      ? `${fixes.length} fixes: the ${before} ${fromAudit ? 'from the audit' : 'already open'} plus ${fresh.length} new at ${weekdayLong(result.finished_at!, zone)}’s check`
      : `${fixes.length} ${plural(fixes.length, 'fix', 'fixes')}`;
  const ended = v.d.checks
    .filter((c) => c.site_id === site.id)
    .sort((a, b) => instant(a.finished_at!) - instant(b.finished_at!))
    .at(-1);
  const next = nextCheck(site, v, (ts) => dayDate(ts, zone));
  const line = [
    dayDate(v.now, zone),
    `last check ${whenAgo(result.finished_at!, v)}`,
    ended && ended !== result && ended.status === 'failed' ? 'latest check failed' : null,
    ...v.inFlight.filter((f) => f.siteId === site.id).map((f) => `check ${f.status}`),
    next ? `next ${next}` : null,
    result.coverage ? `${count(result.coverage.pages_crawled)} pages` : null,
    fixLine,
  ]
    .filter(Boolean)
    .join(' · ');
  const target =
    [...fresh].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))[0] ?? fixes[0];
  const openLatest = (primary: boolean) =>
    action('openAudit', 'Open the latest audit', { checkId: result.id }, { primary });
  const targetLabel = target
    ? target.section === 'crawler_access' && target.crawler_uas.length
      ? `Open the ${listOf(target.crawler_uas)} packet · ${points(target, fixes)}`
      : `Open fix ${target.number} · ${points(target, fixes)}`
    : null;

  // ── fixes table ──
  const byNumber = [...fixes].sort((a, b) => a.number - b.number);
  const rows = byNumber.slice(0, SHOWN_FIXES).map((f) => fixRow(v, result, f, fixes));
  const rest = byNumber.slice(SHOWN_FIXES);
  const sections = Object.entries(
    rest.reduce<Record<string, number>>((m, f) => {
      const k = SECTION_LABEL[f.section];
      m[k] = (m[k] ?? 0) + 1;
      return m;
    }, {}),
  ).sort(([, a], [, b]) => b - a);
  const allPro = rest.every((f) => !isFreeFix(v.d, result, f));

  // ── settings ──
  const staging = v.d.sites.find((s) => s.staging_of_site_id === site.id);
  const publicLink = v.d.reports.find((r) => r.site_id === site.id && r.kind === 'public_link');
  const edit = (field: string, label: string) =>
    action('editSite', label, { id: site.id }, { fields: { field } });
  const canCompete = v.gates.competitorsPerSite > 0;

  // ── alerts ──
  const siteChecks = new Set(v.d.checks.filter((c) => c.site_id === site.id).map((c) => c.id));
  const contentNow = v.d.changes.filter(
    (c) => c.check_id === result.id && c.subject === 'content' && c.previous_check_id !== null,
  );
  const seat = v.d.seats.find((s) => s.role === 'owner');
  const slack = v.gates.slack && site.slack_channel ? `${site.slack_channel} in Slack` : null;
  const to = slack
    ? `${seat?.email ?? v.account.email} and ${slack}`
    : (seat?.email ?? v.account.email);

  return {
    header: {
      title: site.host,
      line,
      actions: [
        openLatest(!target),
        action('runCheck', 'Run a check now', { id: site.id }),
        ...(target && targetLabel
          ? [
              action(
                'packet',
                targetLabel,
                { checkId: result.id, fixId: target.id },
                { primary: true },
              ),
            ]
          : []),
      ],
    },
    grades: {
      title: `Grades, ${numberWord(shown.length)} ${plural(shown.length, 'check', 'checks')}`,
      sub: checksLine(shown, site, zone),
      cards: [seoCard(result, prev, zone), aiCard(result, prev, zone)],
      actions: v.gates.exports
        ? [
            action(
              'reports',
              'Compare any two checks',
              {},
              { fields: { siteId: site.id, kind: 'compare' } },
            ),
            action(
              'reports',
              'Export',
              {},
              { fields: { siteId: site.id, checkId: result.id, kind: 'raw_export' } },
            ),
          ]
        : [],
    },
    crawlers: {
      columns: axisLabels(shown, zone),
      rows: crawlerOrder(result).map((r) => {
        const verdicts = shown.map((c) => c.crawlers.find((y) => y.ua === r.ua)?.verdict ?? null);
        return {
          ua: r.ua,
          group: r.group,
          verdicts,
          cause: causeNow(r, v),
          changedNow: verdicts.length > 1 && verdicts.at(-1) !== verdicts.at(-2),
        };
      }),
      note: TAGGED_UA_LINE,
    },
    fixes: {
      title: fresh.length
        ? `Fixes · ${fixes.length}, counting the ${fresh.length} new`
        : `Fixes · ${fixes.length}`,
      sub: SITE_COPY.fixesSub,
      copyAll: v.gates.packets === 'all' && fixes.length ? SITE_COPY.copyAll : null,
      rows,
      rest: rest.length
        ? {
            numbers: `${rest[0]!.number}–${rest.at(-1)!.number}`,
            count: rest.length,
            title: `${capitalise(numberWord(rest.length))} more: ${listOf(sections.map(([k, n]) => `${n} in ${k}`))}`,
            effect: groupPoints(rest),
            status: `open${allPro ? ' · Pro' : ''}`,
            show: action('sitePage', 'Show all', { id: site.id }, { query: '?fixes=all' }),
          }
        : null,
    },
    settings: {
      rows: [
        {
          label: 'Schedule',
          value: scheduleValue(site, zone),
          mono: false,
          muted: false,
          action: edit('schedule', 'Change'),
        },
        {
          label: 'Page cap',
          value: `${count(v.account.limits.pages_per_audit)} on ${PLAN_NAMES[v.tier]}${
            result.coverage ? ` · ${count(result.coverage.pages_crawled)} crawled` : ''
          }`,
          mono: false,
          muted: false,
          action: null,
        },
        ...(canCompete
          ? [
              {
                label: 'Competitor',
                value: site.competitor_hosts.length ? listOf(site.competitor_hosts) : 'none',
                mono: site.competitor_hosts.length > 0,
                muted: false,
                action: edit('competitor', site.competitor_hosts.length ? 'Change' : 'Add'),
              },
            ]
          : []),
        ...(v.gates.stagingAndDeployHooks
          ? [
              {
                label: 'Staging',
                value: staging ? `${staging.host} · ${scheduleCell(staging)}` : 'none',
                mono: Boolean(staging),
                muted: false,
                action: edit('staging', staging ? 'Change' : 'Add'),
              },
            ]
          : []),
        ...(publicLink?.public_slug
          ? [
              {
                label: 'Public link',
                value: `crawlmouse.com/r/${publicLink.public_slug}`,
                mono: true,
                muted: false,
                action: action('publicReport', 'Open', { slug: publicLink.public_slug }),
              },
            ]
          : []),
        {
          label: 'Remove this site',
          value: SITE_COPY.removeNote,
          mono: false,
          muted: true,
          action: action('removeSite', 'Remove', { id: site.id }),
        },
      ],
    },
    alerts: {
      rows: v.d.alert_rules
        .filter((r) => r.site_id === null || r.site_id === site.id)
        .map((r) => ({
          key: r.id,
          label: ALERT_LABELS[r.kind](r.threshold_points),
          on: r.enabled,
          fired:
            r.last_fired_at && r.last_fired_check_id && siteChecks.has(r.last_fired_check_id)
              ? `fired ${weekdayTime(r.last_fired_at, zone)}`
              : null,
          extra:
            !r.enabled && r.kind === 'any_change' && contentNow.length
              ? contentNow.map((c) => `${c.summary}, ${weekday(c.detected_at, zone)}`).join('; ')
              : null,
          toggle: action(
            'alertRules',
            ALERT_LABELS[r.kind](r.threshold_points),
            { id: site.id },
            {
              fields: { rule: r.kind, enabled: String(!r.enabled) },
            },
          ),
        })),
      foot: SITE_COPY.alertsFoot(to),
    },
  };
}
