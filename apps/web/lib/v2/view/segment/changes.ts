/**
 * Changes (Final-Seg-Changes) as data. A first audit has nothing to compare with: the page says so,
 * shows what a change looks like with a fixed example, and lists the audit. A later check lists
 * the changes it found. A change is reported as first observed at a check, after what we found
 * with it, never as caused by it: a check sees that something differs, not why.
 */
import type {
  Change,
  Check,
  EvidenceClass,
  FixtureDataset,
  GradeName,
  Verdict,
} from '@crawlmouse/types/v2';

type ChangeKind = Change['kind'];
type ChangeSubject = Change['subject'];
type CheckTrigger = Check['trigger'];
import { findCheck, siteOf } from '../../fixtures';
import { dateTimeUtc, listOf, weekdayTime } from '../../format';
import { capitalise, count, numberWord, plural } from '../../words';
import { ANONYMOUS_VISIBLE_MS, type DoorView } from '../result';

const HOUR_MS = 60 * 60 * 1000;
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface ChangeRowView {
  key: string;
  when: string;
  kind: ChangeKind;
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
  history: { key: string; when: string; label: string }[];
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

const TRIGGERS: Record<CheckTrigger, string> = {
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
function clockOf(d: FixtureDataset, check: Check) {
  const account = d.accounts.find((a) => a.id === siteOf(d, check).account_id);
  return (ts: string) =>
    account ? weekdayTime(ts, account.timezone) : `${weekdayTime(ts, 'UTC')} UTC`;
}

/** "First observed after robots.txt changed Thu 19:40: …": when we saw it, and what we found. */
function causeOf(c: Change): string {
  if (!c.cause) return 'First observed at this check; we found no cause.';
  const text = c.cause.text.replace(/\.$/, '');
  return c.cause.changed_at
    ? `First observed after ${text}.`
    : `First observed at this check. What we found: ${text}.`;
}

function rowOf(c: Change, check: Check, at: (ts: string) => string): ChangeRowView {
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
    pill: { state: PILL[c.kind], label: c.kind },
    summary: c.summary,
    subject: SUBJECTS[c.subject],
    where: c.where,
    pages: `${count(c.pages_affected)} ${plural(c.pages_affected, 'page', 'pages')}`,
    effect: c.grade_deltas.length
      ? c.grade_deltas.map((g) => `${GRADES[g.grade]} ${g.from_score} → ${g.to_score}`).join(', ')
      : 'none',
    verdict: crawler ? { verdict: crawler.verdict, evidence: crawler.evidence_class } : null,
    cause: causeOf(c),
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
function auditsUpTo(d: FixtureDataset, check: Check): Check[] {
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
function scheduleOf(d: FixtureDataset, check: Check, kept: boolean): string | null {
  const s = siteOf(d, check).schedule;
  if (!kept || !s) return null;
  if (s.cadence === 'on_deploy') return 'on each deploy';
  return `${s.cadence}, ${WEEKDAYS[s.iso_weekday!]} around ${String(s.hour_local).padStart(2, '0')}:00`;
}

export function changesView(
  d: FixtureDataset,
  checkId: string,
  options: SegmentOptions = {},
): ChangesView {
  const check = findCheck(d, checkId);
  const frame = segmentFrame(d, checkId, 'changes', options);
  const kept = frame.keptUntil === null;
  const at = clockOf(d, check);
  const audits = auditsUpTo(d, check);
  const history = audits.map((c) => ({
    key: c.id,
    when: dateTimeUtc(c.finished_at!),
    label: historyLabel(c),
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
        : 'The second row appears after the next check. "Re-run, free" in the header runs one now, without an account, but it replaces this audit rather than comparing with it.',
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

  const rows = d.changes.filter((c) => c.check_id === check.id).map((c) => rowOf(c, check, at));
  const previous = findCheck(d, check.previous_check_id);
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
      : {
          title: `Nothing changed at the ${when} check.`,
          pill: { state: 'neutral', label: 'no changes' },
        },
    body: 'Each row says what changed, where, what it did to the grades, what we found with it, and who was told.',
    tiles: tiles({ label: 'Changes at this check', value: String(rows.length), note: null }),
    rows,
    example: null,
    history,
    historyNote: null,
    coverage: {
      read: previous.finished_at
        ? `Compared with the check of ${dateTimeUtc(previous.finished_at)}`
        : 'Compared with the check before it',
    },
    keep: null,
  };
}
