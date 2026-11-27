/**
 * The account Changes log as data (D3). It has no artboard: its rows are CC-23's change rows
 * (`rowOf`, drawn by `ChangeTable`), over every change of the viewer's account at `now`, newest
 * first, with the site as the first column. Three filters (site, kind, since) are links that set the
 * page's query (ARCH-2 §5: `GET /changes?site=&kind=&since=`). A kind the contract does not name or
 * an unknown since is ignored, as if that filter were not set. A site the account does not hold is
 * ignored too, and the page says so (F-130), in the same words whether or not the id exists.
 */
import { instant, type Change, type Check } from '@crawlmouse/types/v2';
import { CHANGES_LOG_COPY as COPY } from '../copy/changes-log';
import { findCheck } from '../fixtures';
import { dayDate, hourMinuteZoned } from '../format';
import {
  readerRole,
  resultChecks,
  viewAt,
  type AccountDataset,
  type AccountView,
  type Viewer,
} from './account';
import { accountShellView, newChanges, type ShellView } from './account-shell';
import { listedChanges } from './listed-changes';
import { everySectionMeasured } from './section-measured';
import { firstSeenOf, rowOf, TRIGGERS, type ChangeRowView } from './segment/changes';

const DAY_MS = 86_400_000;

/** The since filter's choices: how far back from `now`, in days (null: every change). */
export const CHANGES_LOG_SINCE = [
  { key: 'all', label: 'Any time', days: null },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '24h', label: 'Last 24 hours', days: 1 },
] as const;

type SinceKey = (typeof CHANGES_LOG_SINCE)[number]['key'];

/** The contract's change kinds, in the order the filter lists them. */
const KIND_ORDER: readonly Change['kind'][] = ['opened', 'resolved', 'changed', 'baseline'];

export interface ChangesLogQuery {
  site?: string;
  kind?: string;
  since?: string;
}

export interface FilterLinkView {
  label: string;
  href: string;
  current: boolean;
}

export interface ChangesLogView {
  shell: ShellView;
  title: string;
  /** "8 changes across 4 sites, newest first."; with a filter set, "3 of 8 changes match: opened." */
  /** Null when the account has no change at all: the empty sentence says so instead. */
  headline: string | null;
  /** The rail's new count in words; null while a filter is set or nothing is new. */
  newNote: string | null;
  /** The three filters, each with its name, in the order the page draws them. */
  filters: { name: string; links: FilterLinkView[] }[];
  filtersLabel: string;
  /** CC-23's rows, each naming its site. */
  rows: ChangeRowView[];
  /** Said when the site filter names no site of this account; it does not repeat the id. */
  notice: string | null;
  /** What the page says in place of the table; null when it has rows. */
  empty: string | null;
  tableLabel: string;
}

/**
 * A change as it stood at `now`. viewAt drops a change found after `now`, but a change found before
 * it can carry a notification sent after it; at `now` that notification has not gone out.
 */
export function asSentBy(c: Change, now: string): Change {
  return c.notified && instant(c.notified.sent_at) > instant(now) ? { ...c, notified: null } : c;
}

/** The account's changes at `now`, newest first; ties in the order of their ids. */
export function accountChanges(v: AccountView): Change[] {
  return listedChanges(v.d.changes)
    .map((c) => asSentBy(c, v.now))
    .sort((a, b) => instant(b.detected_at) - instant(a.detected_at) || a.id.localeCompare(b.id));
}

/**
 * One row of the log: a change, everything one site's first audit found (`findings`), or a re-check
 * that recorded no change (`quiet`, F-214).
 */
type LogEntry =
  | { change: Change; findings: number | null; quiet: null }
  | { change: null; findings: null; quiet: Check };

const checkIdOf = (e: LogEntry) => (e.change ? e.change.check_id : e.quiet.id);
const timeOf = (e: LogEntry) => (e.change ? e.change.detected_at : e.quiet.finished_at!);

/**
 * The log's rows (F-100). What a site's first audit found was not a change: nothing came before it.
 * Its `opened` rows (no previous check) become one `baseline` row per check, where the newest of them
 * stood; any other row of a first check, such as a deploy audited, stays its own.
 */
function logEntries(changes: readonly Change[]): LogEntry[] {
  const found = new Map<string, Change[]>();
  const isFinding = (c: Change) => c.kind === 'opened' && c.previous_check_id === null;
  for (const c of changes) {
    if (isFinding(c)) found.set(c.check_id, [...(found.get(c.check_id) ?? []), c]);
  }
  const placed = new Set<string>();
  const entries: LogEntry[] = [];
  for (const c of changes) {
    if (!isFinding(c)) {
      entries.push({ change: c, findings: null, quiet: null });
    } else if (!placed.has(c.check_id)) {
      placed.add(c.check_id);
      const group = found.get(c.check_id)!;
      const change: Change = {
        ...c,
        id: `first-audit-${c.check_id}`,
        kind: 'baseline',
        fix_id: null,
        severity: null,
        grade_deltas: [],
        notified: group.find((g) => g.notified)?.notified ?? null,
      };
      entries.push({ change, findings: group.length, quiet: null });
    }
  }
  return entries;
}

/**
 * The log's entries with a row for each re-check that recorded no change (F-214): a finished or
 * partial check that has a check before it and no change row of its own. Newest first.
 */
function withQuietChecks(v: AccountView, changes: readonly Change[]): LogEntry[] {
  const found = new Set(changes.map((c) => c.check_id));
  const quiet: LogEntry[] = v.d.checks
    .filter(
      (c) =>
        (c.status === 'finished' || c.status === 'partial') &&
        c.previous_check_id !== null &&
        !found.has(c.id),
    )
    .map((c) => ({ change: null, findings: null, quiet: c }));
  // At one instant a change comes before a re-check, and entries of one kind keep their order:
  // changes by id (accountChanges), re-checks by check id.
  const rank = (e: LogEntry) => (e.change ? 0 : 1);
  const tie = (e: LogEntry) => (e.change ? '' : e.quiet.id);
  return [...logEntries(changes), ...quiet]
    .map((e, i) => ({ e, i }))
    .sort(
      (a, b) =>
        instant(timeOf(b.e)) - instant(timeOf(a.e)) ||
        rank(a.e) - rank(b.e) ||
        tie(a.e).localeCompare(tie(b.e)) ||
        a.i - b.i,
    )
    .map(({ e }) => e);
}

export function changesLogView(
  d: AccountDataset,
  viewer: Viewer,
  query: ChangesLogQuery,
  /** The page the filter links point at: `/changes`, or a preview's path. */
  base: string,
): ChangesLogView {
  const v = viewAt(d, viewer);
  const zone = v.account.timezone;
  const sites = [...v.d.sites].sort(
    (a, b) => instant(a.created_at) - instant(b.created_at) || a.id.localeCompare(b.id),
  );
  const hostOf = new Map(sites.map((s) => [s.id, s.host]));
  const siteOfCheck = new Map(v.d.checks.map((c) => [c.id, c.site_id]));
  const all = withQuietChecks(v, accountChanges(v));
  const site = query.site && hostOf.has(query.site) ? query.site : null;
  const kind = KIND_ORDER.find((k) => k === query.kind) ?? null;
  // The kinds the account's changes hold, and the one asked for even when none has it yet.
  const kinds = KIND_ORDER.filter((k) => k === kind || all.some((e) => e.change?.kind === k));
  const since = CHANGES_LOG_SINCE.find((s) => s.key === query.since) ?? CHANGES_LOG_SINCE[0];
  const set = { site, kind, since: since.key as SinceKey };

  const from = since.days === null ? null : instant(v.now) - since.days * DAY_MS;
  const shown = all
    .filter((e) => site === null || siteOfCheck.get(checkIdOf(e)) === site)
    // A re-check that recorded no change is not a change of any kind.
    .filter((e) => kind === null || e.change?.kind === kind)
    .filter((e) => from === null || instant(timeOf(e)) >= from);

  const clock = (ts: string) => `${dayDate(ts, zone)} ${hourMinuteZoned(ts, zone)}`;
  const rows: ChangeRowView[] = shown.map((e) => {
    if (e.change === null) return quietRow(v, e.quiet, clock, hostOf.get(e.quiet.site_id)!);
    const { change: c, findings } = e;
    return {
      ...rowOf(
        c,
        findCheck(v.d, c.check_id),
        clock,
        firstSeenOf(v.d, c, clock),
        v.d.checks.find((x) => x.id === c.previous_check_id) ?? null,
        v.d.fix_events,
      ),
      ...(findings === null
        ? {}
        : {
            summary: COPY.firstAudit(findings),
            subject: null,
            where: COPY.firstAuditWhere,
            pages: null,
            effect: 'none',
            verdict: null,
            cause:
              resultChecks(v, siteOfCheck.get(c.check_id)!).length > 1
                ? COPY.firstAuditCauseLater
                : COPY.firstAuditCause,
            diff: [],
          }),
      site: hostOf.get(siteOfCheck.get(c.check_id)!)!,
    };
  });

  const href = (next: Partial<typeof set>) => {
    const q = { ...set, ...next };
    const params = new URLSearchParams();
    if (q.site) params.set('site', q.site);
    if (q.kind) params.set('kind', q.kind);
    if (q.since !== 'all') params.set('since', q.since);
    const s = params.toString();
    return s ? `${base}?${s}` : base;
  };
  const filtered = site !== null || kind !== null || since.days !== null;
  const named = [
    ...(site ? [hostOf.get(site)!] : []),
    ...(kind ? [kind] : []),
    ...(since.days !== null ? [since.label.toLowerCase()] : []),
  ];
  const fresh = newChanges(v).length;
  // A first audit is an entry in the log and not a change: the headline counts changes only.
  const changesShown = shown.filter((e) => e.change !== null && e.findings === null);
  const sitesChanged = new Set(changesShown.map((e) => siteOfCheck.get(checkIdOf(e)))).size;
  // With no change to show, the headline counts the sites audited: a clean first audit has no row.
  const audited = sites.map((s) => resultChecks(v, s.id).length).filter((n) => n > 0);
  const anyRechecked = audited.some((n) => n > 1);

  return {
    shell: accountShellView(v, 'Changes', { role: readerRole(v) ?? 'developer' }),
    title: COPY.title,
    headline: filtered
      ? COPY.filtered(
          rows.length,
          all.length,
          named,
          all.some((e) => e.change === null || e.findings !== null),
        )
      : rows.length
        ? changesShown.length === 0
          ? anyRechecked
            ? COPY.firstAuditsNoChange(audited.length)
            : COPY.firstAuditsOnly(audited.length)
          : COPY.headline(changesShown.length, sitesChanged)
        : null,
    newNote: !filtered && fresh > 0 ? COPY.newNote(fresh) : null,
    filters: [
      {
        name: COPY.groups.site,
        links: [
          { label: COPY.allSites, href: href({ site: null }), current: site === null },
          ...sites.map((s) => ({
            label: s.host,
            href: href({ site: s.id }),
            current: site === s.id,
          })),
        ],
      },
      {
        name: COPY.groups.kind,
        links: [
          { label: COPY.allKinds, href: href({ kind: null }), current: kind === null },
          ...kinds.map((k) => ({ label: k, href: href({ kind: k }), current: kind === k })),
        ],
      },
      {
        name: COPY.groups.since,
        links: CHANGES_LOG_SINCE.map((s) => ({
          label: s.label,
          href: href({ since: s.key }),
          current: since.key === s.key,
        })),
      },
    ],
    filtersLabel: COPY.filtersLabel,
    rows,
    notice: query.site && site === null ? COPY.siteNotHere : null,
    empty: rows.length ? null : filtered ? COPY.noMatch : COPY.noChanges,
    tableLabel: COPY.table,
  };
}

/** A re-check that recorded no change, as a row (F-214): what ran, and what it was compared with. */
function quietRow(
  v: AccountView,
  check: Check,
  clock: (ts: string) => string,
  site: string,
): ChangeRowView {
  const previous = v.d.checks.find((c) => c.id === check.previous_check_id);
  const measured =
    previous !== undefined && everySectionMeasured(check) && everySectionMeasured(previous);
  return {
    key: `check-${check.id}`,
    site,
    when: clock(check.finished_at!),
    kind: 'checked',
    pill: { state: 'neutral', label: COPY.quietPill },
    summary: COPY.quiet(TRIGGERS[check.trigger], measured),
    subject: null,
    where: COPY.firstAuditWhere,
    pages: null,
    effect: 'none',
    verdict: null,
    cause: COPY.quietCause(previous?.finished_at ? clock(previous.finished_at) : null),
    diff: [],
    told: 'nobody was notified',
  };
}
