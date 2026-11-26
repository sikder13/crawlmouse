/**
 * Changes (Final-Seg-Changes) as data. A first audit has nothing to compare with: the page says so,
 * shows what a change looks like with a fixed example, and lists the audit. A later check lists
 * the changes it found. A change is reported as first observed at a check, after what we found
 * with it, never as caused by it: a check sees that something differs, not why.
 */
import { everySectionMeasured } from '../section-measured';
import { listedChanges } from '../listed-changes';
import type {
  Change,
  Check,
  EvidenceClass,
  FixEvent,
  GradeName,
  Verdict,
} from '@crawlmouse/types/v2';
import type { ViewDataset } from '../../dataset-lookups';

type ChangeKind = Change['kind'];
type ChangeSubject = Change['subject'];
type CheckTrigger = Check['trigger'];
import { findCheck, siteOf } from '../../dataset-lookups';
import {
  dateTimeUtc,
  dayDate,
  hourMinute,
  hourMinuteZoned,
  listOf,
  weekdayTime,
  weekdayTimeZoned,
} from '../../format';
import { capitalise, count, numberWord, plural } from '../../words';
import { ANONYMOUS_VISIBLE_MS, type DoorView } from '../result';

const HOUR_MS = 60 * 60 * 1000;
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface ChangeRowView {
  key: string;
  /** The site's host, on a list that spans an account's sites (the Changes log); absent here. */
  site?: string;
  when: string;
  /** `checked`: a Changes log entry for a re-check that recorded no change (F-214), not a change. */
  kind: ChangeKind | 'checked';
  pill: DoorView['pill'];
  summary: string;
  /** Null on the example rows, which the locked page writes without one. */
  subject: string | null;
  where: string;
  pages: string | null;
  effect: string;
  /** The crawler's verdict at this check, for a change about one crawler. */
  verdict: { verdict: Verdict; evidence: EvidenceClass } | null;
  cause: string;
  diff: { sign: '+' | '−'; line: string }[];
  /** Who was told; null on the example rows. */
  told: string | null;
}

export interface ChangesView {
  frame: SegmentFrame;
  state: 'first' | 'changes';
  headline: { title: string; pill: DoorView['pill'] };
  body: string;
  tiles: { label: string; value: string; note: string | null }[];
  rows: ChangeRowView[];
  /** What a change looks like, for a first audit: an example, not this site's data. */
  example: ChangeRowView[] | null;
  /** Each audit of the site so far; `href` is its result page, where the page has a route for it. */
  history: { key: string; when: string; label: string; href?: string }[];
  historyNote: string | null;
  coverage: { read: string };
  keep: { title: string; sub: string } | null;
}

export const PILL: Record<ChangeKind, DoorView['pill']['state']> = {
  opened: 'bad',
  resolved: 'ok',
  changed: 'neutral',
  baseline: 'neutral',
};

export const SUBJECTS: Record<ChangeSubject, string> = {
  crawler_access: 'crawler access',
  text_without_js: 'text without JavaScript',
  grade: 'grade',
  orphans: 'orphan pages',
  structure: 'site structure',
  content: 'content',
  deploy: 'deploy',
};

export const GRADES: Record<GradeName, string> = {
  technical_seo: 'Technical SEO',
  ai_readability: 'AI readability',
};

export const TRIGGERS: Record<CheckTrigger, string> = {
  first_audit: 'First audit',
  manual: 'Re-run',
  scheduled: 'Scheduled check',
  deploy: 'Deploy check',
  fix_recheck: 'Re-check after a fix',
};

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** What a change looks like: the locked page's example, from another store, names removed. */
const EXAMPLE: ChangeRowView[] = [
  {
    key: 'example-opened',
    when: 'Fri 06:00',
    kind: 'opened',
    pill: { state: 'bad', label: 'opened' },
    summary: 'ClaudeBot blocked on all pages',
    subject: null,
    where: 'robots.txt',
    pages: null,
    effect: 'AI 63 → 44',
    verdict: null,
    cause: 'robots.txt changed Thu 19:40: "User-agent: ClaudeBot / Disallow: /" added',
    diff: [],
    told: null,
  },
  {
    key: 'example-resolved',
    when: 'Fri 06:00',
    kind: 'resolved',
    pill: { state: 'ok', label: 'resolved' },
    summary: '4 orphan pages now linked',
    subject: null,
    where: '/collections/*',
    pages: null,
    effect: 'SEO +2',
    verdict: null,
    cause: 'linked from their collections, as the fix described',
    diff: [],
    told: null,
  },
  {
    key: 'example-changed',
    when: 'Thu 14:12',
    kind: 'changed',
    pill: { state: 'neutral', label: 'changed' },
    summary: '23 pages changed content',
    subject: null,
    where: '/products/*',
    pages: null,
    effect: 'none',
    verdict: null,
    cause: 'price and stock updates; grades unaffected',
    diff: [],
    told: null,
  },
];

/** The account's clock, or UTC for an audit nobody has kept. */
function clockOf(d: ViewDataset, check: Check) {
  const account = d.accounts.find((a) => a.id === siteOf(d, check).account_id);
  return (ts: string) =>
    account ? weekdayTimeZoned(ts, account.timezone) : `${weekdayTime(ts, 'UTC')} UTC`;
}

/** The same clock with the day of the month: "Sat 24 Oct 22:34 EDT". */
function datedClockOf(d: ViewDataset, check: Check) {
  const account = d.accounts.find((a) => a.id === siteOf(d, check).account_id);
  const zone = account?.timezone ?? 'UTC';
  // Named with its zone, as every time on this page is (D-17).
  return (ts: string) =>
    account
      ? `${dayDate(ts, zone)} ${hourMinuteZoned(ts, zone)}`
      : `${dayDate(ts, zone)} ${hourMinute(ts, zone)} UTC`;
}

export { lettersUnmoved } from '../listed-changes';

/** The pill of an `opened` row for a fix that was done and is found again (F-296). */
export const FOUND_AGAIN = 'found again';

/**
 * Whether `c` opened a fix that was done before: its own record says so, a `reopened` event for that
 * fix at the check that wrote the row.
 */
export const foundAgain = (c: Change, events: readonly FixEvent[]): boolean =>
  c.kind === 'opened' &&
  c.fix_id !== null &&
  events.some((e) => e.kind === 'reopened' && e.fix_id === c.fix_id && e.check_id === c.check_id);

/**
 * Where the fix an `opened` row reopened was first seen, when that was a check queued before the
 * row's own (F-213): that check's finish, read by `dated`, a clock that names the day, since a
 * reopened fix can be weeks old; or `'another'` when the dataset does not hold that check. Null for
 * any other row, including a fix first seen at this check, which is what "first observed at this
 * check" means.
 */
export type FirstSeen = { when: string } | 'another' | null;

export function firstSeenOf(
  d: Pick<ViewDataset, 'fixes' | 'checks'>,
  c: Change,
  dated: (ts: string) => string,
): FirstSeen {
  if (c.kind !== 'opened' || c.fix_id === null) return null;
  const fix = d.fixes.find((f) => f.id === c.fix_id);
  if (!fix || fix.first_seen_check_id === c.check_id) return null;
  const seen = d.checks.find((x) => x.id === fix.first_seen_check_id);
  if (!seen?.finished_at) return 'another';
  const own = d.checks.find((x) => x.id === c.check_id);
  if (own && Date.parse(seen.queued_at) >= Date.parse(own.queued_at)) return null;
  return { when: dated(seen.finished_at) };
}

/**
 * "First observed after robots.txt changed Thu 19:40: …": when we saw it, and what we found.
 * - `seen`: where the fix an opened row reopened was first seen (F-213); its lead replaces "First
 *   observed at this check".
 * - A grade change with no cause found, between checks that read different numbers of pages, says so
 *   (D-08): the grade moved with what was read. That is a row first observed here.
 */
function causeOf(c: Change, seen: FirstSeen, check: Check, previous: Check | null): string {
  const now = check.coverage?.pages_crawled;
  const before = previous?.coverage?.pages_crawled;
  if (
    seen === null &&
    !c.cause &&
    c.grade_deltas.length &&
    now != null &&
    before != null &&
    now !== before
  ) {
    return `First observed at this check, which read ${count(now)} ${plural(now, 'page', 'pages')}; the check before read ${count(before)}. The grade moved with the pages read, and we found no other cause.`;
  }
  const lead =
    seen === null
      ? 'First observed at this check'
      : seen === 'another'
        ? 'First seen at another check'
        : `First seen at the ${seen.when} check`;
  if (!c.cause) return `${lead}; we found no cause.`;
  const text = c.cause.text.replace(/\.$/, '');
  if (c.cause.changed_at && seen === null) return `First observed after ${text}.`;
  return `${lead}. What we found: ${text}.`;
}

/**
 * One change as a row: `check` is the check that found it, `at` the clock its times are read by,
 * `seen` where the fix it reopened was first seen (`firstSeenOf`), `previous` the check before it
 * where the dataset holds it (its pages read, D-08), and `events` the fix events that say whether an
 * opened fix was found again (F-296).
 */
export function rowOf(
  c: Change,
  check: Check,
  at: (ts: string) => string,
  seen: FirstSeen,
  previous: Check | null = null,
  events: readonly FixEvent[] = [],
): ChangeRowView {
  const crawler = c.ua ? check.crawlers.find((x) => x.ua === c.ua) : undefined;
  const n = c.notified;
  const channels = n
    ? n.channels.map((ch) =>
        ch === 'email' ? 'email' : `Slack${n.slack_channel ? ` ${n.slack_channel}` : ''}`,
      )
    : [];
  return {
    key: c.id,
    when: at(c.detected_at),
    kind: c.kind,
    pill: { state: PILL[c.kind], label: foundAgain(c, events) ? FOUND_AGAIN : c.kind },
    summary: c.summary,
    subject: SUBJECTS[c.subject],
    where: c.where,
    pages: `${count(c.pages_affected)} ${plural(c.pages_affected, 'page', 'pages')}`,
    effect: c.grade_deltas.length
      ? c.grade_deltas.map((g) => `${GRADES[g.grade]} ${g.from_score} → ${g.to_score}`).join(', ')
      : 'none',
    verdict: crawler ? { verdict: crawler.verdict, evidence: crawler.evidence_class } : null,
    cause: causeOf(c, seen, check, previous),
    diff: [
      ...(c.cause?.diff?.removed ?? []).map((line) => ({ sign: '−' as const, line })),
      ...(c.cause?.diff?.added ?? []).map((line) => ({ sign: '+' as const, line })),
    ],
    told: n ? `${listOf(channels)}, ${at(n.sent_at)}` : 'nobody was notified',
  };
}

/** "First audit · Technical SEO B · 79 · AI readability D · 41". */
function historyLabel(c: Check): string {
  const seo = c.technical_seo;
  const ai = c.ai_readability;
  return [
    TRIGGERS[c.trigger],
    seo?.grade ? `Technical SEO ${seo.grade} · ${seo.score}` : 'Technical SEO not graded',
    !ai || ai.withheld ? 'AI readability withheld' : `AI readability ${ai.grade} · ${ai.total}`,
  ].join(' · ');
}

/** The site's graded checks up to and including this one, newest first. */
function auditsUpTo(d: ViewDataset, check: Check): Check[] {
  const at = Date.parse(check.queued_at);
  return d.checks
    .filter(
      (c) =>
        c.site_id === check.site_id &&
        (c.status === 'finished' || c.status === 'partial') &&
        Date.parse(c.queued_at) <= at,
    )
    .sort((a, b) => Date.parse(b.queued_at) - Date.parse(a.queued_at));
}

/** "weekly, Fri around 06:00" (FACTS H4), or null when nothing re-checks the site. */
function scheduleOf(d: ViewDataset, check: Check, kept: boolean): string | null {
  const s = siteOf(d, check).schedule;
  if (!kept || !s) return null;
  if (s.cadence === 'on_deploy') return 'on each deploy';
  return `${s.cadence}, ${WEEKDAYS[s.iso_weekday!]} around ${String(s.hour_local).padStart(2, '0')}:00`;
}

export function changesView(
  d: ViewDataset,
  checkId: string,
  options: SegmentOptions = {},
): ChangesView {
  const check = findCheck(d, checkId);
  const frame = segmentFrame(d, checkId, 'changes', options);
  const kept = frame.keptUntil === null;
  const at = clockOf(d, check);
  const dated = datedClockOf(d, check);
  const audits = auditsUpTo(d, check);
  const history = audits.map((c) => ({
    key: c.id,
    when: dateTimeUtc(c.finished_at!),
    label: historyLabel(c),
    ...(options.hrefs?.check ? { href: options.hrefs.check(c.id) } : {}),
  }));
  const next = scheduleOf(d, check, kept);
  const tiles = (middle: ChangesView['tiles'][number]) => [
    { label: 'Audits of this site', value: String(audits.length), note: null },
    middle,
    { label: 'Next check', value: next ?? 'none scheduled', note: null },
  ];

  if (check.previous_check_id === null) {
    return {
      frame,
      state: 'first',
      headline: {
        title: 'Nothing has changed yet, because nothing has checked again.',
        pill: {
          state: 'neutral',
          label: `${audits.length} ${plural(audits.length, 'audit', 'audits')}`,
        },
      },
      body: `Changes appear here once the site has been checked twice: a crawler newly blocked, a template that starts or stops shipping its text, an orphan that gains a link, a grade that moves. ${
        kept
          ? next
            ? `This site is re-checked ${next}, and each check that finds a change sends one email.`
            : 'No re-check is scheduled for this site.'
          : `Without an account this audit is kept for ${ANONYMOUS_VISIBLE_MS / HOUR_MS} hours and never re-checked. With one, it is re-checked monthly on Free and weekly on Pro, and each check that finds a change sends one email.`
      }`,
      tiles: tiles(
        kept
          ? { label: 'Kept', value: 'by an account', note: null }
          : { label: 'Kept until', value: frame.keptUntil!, note: null },
      ),
      rows: [],
      example: EXAMPLE,
      history,
      historyNote: kept
        ? null
        : `The second row appears after the next check.${
            options.rerun === false
              ? ''
              : ' "Re-run, free" in the header runs one now, without an account, but it replaces this audit rather than comparing with it.'
          }`,
      coverage: { read: 'No earlier audit of this site to compare with' },
      keep: kept
        ? null
        : {
            title:
              'Keep this audit so there is something to compare: re-checked monthly, an email only when something changed.',
            sub: `One email creates a free account and starts 14 days of Pro with weekly checks. Otherwise this page expires ${frame.keptUntil}.`,
          },
    };
  }

  const rows = listedChanges(d.changes)
    .filter((c) => c.check_id === check.id)
    .map((c) =>
      rowOf(
        c,
        check,
        at,
        firstSeenOf(d, c, dated),
        d.checks.find((x) => x.id === c.previous_check_id) ?? null,
        d.fix_events,
      ),
    );
  const previous = d.checks.find((c) => c.id === check.previous_check_id);
  const when = at(check.finished_at!);
  return {
    frame,
    state: 'changes',
    headline: rows.length
      ? {
          title: `${capitalise(numberWord(rows.length))} ${plural(rows.length, 'change', 'changes')} found at the ${when} check.`,
          pill: {
            state: 'neutral',
            label: `${rows.length} ${plural(rows.length, 'change', 'changes')}`,
          },
        }
      : previous && everySectionMeasured(check) && everySectionMeasured(previous)
        ? {
            title: `Nothing changed at the ${when} check.`,
            pill: { state: 'neutral', label: 'no changes' },
          }
        : {
            // The diff skips what either check did not measure.
            title: `No change in what both checks measured at the ${when} check.`,
            pill: { state: 'neutral', label: 'no measured change' },
          },
    body: 'Each row says what changed, where, what it did to the grades, what we found with it, and who was told.',
    tiles: tiles({ label: 'Changes at this check', value: String(rows.length), note: null }),
    rows,
    example: null,
    history,
    historyNote: null,
    coverage: {
      read: previous?.finished_at
        ? `Compared with the check of ${dateTimeUtc(previous.finished_at)}`
        : 'Compared with the check before it',
    },
    keep: null,
  };
}
