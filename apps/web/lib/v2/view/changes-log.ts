/**
 * The account Changes log as data (D3). It has no artboard: its rows are CC-23's change rows
 * (`rowOf`, drawn by `ChangeTable`), over every change of the viewer's account at `now`, newest
 * first, with the site as the first column. Three filters (site, kind, since) are links that set the
 * page's query (ARCH-2 §5: `GET /changes?site=&kind=&since=`). A site the account does not hold, a
 * kind the contract does not name or an unknown since is ignored, as if that filter were not set.
 */
import { instant, type Change } from '@crawlmouse/types/v2';
import { CHANGES_LOG_COPY as COPY } from '../copy/changes-log';
import { findCheck } from '../fixtures';
import { dayDate, hourMinute } from '../format';
import { readerRole, viewAt, type AccountDataset, type AccountView, type Viewer } from './account';
import { accountShellView, newChanges, type ShellView } from './account-shell';
import { rowOf, type ChangeRowView } from './segment/changes';

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
  return v.d.changes
    .map((c) => asSentBy(c, v.now))
    .sort((a, b) => instant(b.detected_at) - instant(a.detected_at) || a.id.localeCompare(b.id));
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
  const all = accountChanges(v);
  const site = query.site && hostOf.has(query.site) ? query.site : null;
  const kind = KIND_ORDER.find((k) => k === query.kind) ?? null;
  // The kinds the account's changes hold, and the one asked for even when none has it yet.
  const kinds = KIND_ORDER.filter((k) => k === kind || all.some((c) => c.kind === k));
  const since = CHANGES_LOG_SINCE.find((s) => s.key === query.since) ?? CHANGES_LOG_SINCE[0];
  const set = { site, kind, since: since.key as SinceKey };

  const from = since.days === null ? null : instant(v.now) - since.days * DAY_MS;
  const shown = all
    .filter((c) => site === null || siteOfCheck.get(c.check_id) === site)
    .filter((c) => kind === null || c.kind === kind)
    .filter((c) => from === null || instant(c.detected_at) >= from);

  const clock = (ts: string) => `${dayDate(ts, zone)} ${hourMinute(ts, zone)}`;
  const rows = shown.map((c) => ({
    ...rowOf(c, findCheck(v.d, c.check_id), clock),
    site: hostOf.get(siteOfCheck.get(c.check_id)!)!,
  }));

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
  const sitesShown = new Set(rows.map((r) => r.site)).size;

  return {
    shell: accountShellView(v, 'Changes', { role: readerRole(v) ?? 'developer' }),
    title: COPY.title,
    headline: filtered
      ? COPY.filtered(rows.length, all.length, named)
      : rows.length
        ? COPY.headline(rows.length, sitesShown)
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
    empty: rows.length ? null : filtered ? COPY.noMatch : COPY.noChanges,
    tableLabel: COPY.table,
  };
}
