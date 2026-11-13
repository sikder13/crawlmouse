/**
 * Reports and exports (Final-Reports) as data (D5). "Reports made" is the account's reports by
 * `now`, newest first, the public audit link left out (owner ruling 7: each site page carries it);
 * "Covers" names the checks a report covers; a share link shows while `share_expires_at` is ahead;
 * sizes come from `byte_count`. Making a report needs `GATES[tier].exports`; without it the card
 * offers the plans instead. The site the card makes reports for is the page's `?site=`, by default
 * the primary site.
 *
 * A live page hands the view what the records do not hold (`ReportsSide`): each report's file state,
 * whether the reader's role may share, and a link just made. With the file states given, a report is
 * offered for download, opening or sharing only when its file is stored; a pending one and a failed
 * one say so and offer nothing. A proof page (`html`) opens at `/reports/<id>`.
 */
import { instant, type Check, type Report, type Seat } from '@crawlmouse/types/v2';
import { GATES, type Tier } from '../../entitlement-v2';
import { gateMessage } from '../agency/gates';
import { roleMay } from '../agency/guard';
import {
  RAW_FORMATS,
  RAW_TYPES,
  REPORTS_COPY as COPY,
  REPORT_TYPES,
  SHARE_LINK_DAYS,
} from '../copy/reports';
import { findCheck } from '../fixtures';
import { calendarDays, dayDate, dayMonth, dayOfMonth, hourMinute, weekday } from '../format';
import {
  PLAN_NAMES,
  primarySite,
  primarySites,
  readerRole,
  resultChecks,
  viewAt,
  type AccountDataset,
  type Viewer,
} from './account';
import { action, type ActionView } from './account-actions';
import { accountShellView, type ShellView } from './account-shell';
import { routeAction } from './settings';

export { SHARE_LINK_DAYS } from '../copy/reports';

/** Where a proof page is read by a member: `app/reports/[id]/page.tsx`. */
const PROOF_ROUTE = '/reports/[id]';

/** Whether a report's file is in the bucket yet (`reports.file_state`). */
export type FileState = 'pending' | 'stored' | 'failed';

/** What a live page knows that the account's records do not hold. */
export interface ReportsSide {
  /**
   * Each report's file state, by report id. Given, a report that is not `stored` in it has no
   * download, no Open and no share link. Left out (a preview), a row's own columns decide.
   */
  fileStates?: ReadonlyMap<string, FileState>;
  /**
   * The reader's role on the account, as the page's own session read it: it decides the rail and
   * whether a share link may be made and withdrawn. Left out, the reader is the viewer's seat (a
   * preview reads as the owner).
   */
  role?: Seat['role'];
  /** A share link made a moment ago, shown on its report's row while the page is handed it. */
  madeLink?: { reportId: string; url: string } | null;
}

export interface MadeRowView {
  key: string;
  made: string;
  site: string;
  type: string;
  covers: string;
  /** "Being made" or "Could not be made", for a report whose file is not stored. */
  state: string | null;
  actions: ActionView[];
  /** A share link that works: "Link · until <date>", as text beside the row's actions. */
  linkUntil: string | null;
  /** The address of a share link just made for this report. */
  madeLink: { label: string; url: string } | null;
}

export interface ScheduledRowView {
  key: string;
  when: string;
  site: string;
  type: string;
  to: string;
  /** In words: "scheduled", or "held back" for a report waiting on a check that could not run. */
  status: string;
}

export interface ReportsView {
  shell: ShellView;
  header: { title: string; line: string };
  make: {
    title: string;
    sub: string;
    /** The plan that makes reports, where the account's does not. */
    gate: string | null;
    /** The site picker: a GET form to `base` that reloads the card for another site. */
    sites: { value: string; label: string }[];
    selected: string;
    pick: { href: string; label: string; show: string };
    pdf: { title: string; text: string; action: ActionView | null };
    /** The latest two results' compare: no route chooses another pair (owner ruling 6). */
    compare: { title: string; text: string; action: ActionView | null };
    raw: { title: string; text: string; actions: ActionView[] };
  };
  made: { title: string; sub: string; rows: MadeRowView[]; foot: string; empty: string | null };
  scheduled: {
    title: string;
    /** "None", or how many are still to send. */
    sub: string;
    rows: ScheduledRowView[];
    foot: string;
    /** The plans, where client reports are not on the account's plan. */
    compare: ActionView | null;
  };
}

/** "1.2 MB", "310 KB": 1024-based, one decimal under 10. */
export function fileSize(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  const shown = u === 0 || n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
  return `${shown} ${units[u]}`;
}

/** The cheapest plan a gate opens on: "Pro" for exports. */
const firstPlanWith = (gate: 'exports' | 'agencyBranding'): string =>
  PLAN_NAMES[
    (['free', 'pro', 'agency'] as const satisfies readonly Tier[]).find((t) => GATES[t][gate])!
  ];

export function reportsView(
  d: AccountDataset,
  viewer: Viewer,
  query: { site?: string },
  /** The page the site picker reloads: `/reports`, or a preview's path. */
  base: string,
  side: ReportsSide = {},
): ReportsView {
  const v = viewAt(d, viewer);
  const role = side.role ?? readerRole(v) ?? 'developer';
  const zone = v.account.timezone;
  const when = (ts: string) => `${dayDate(ts, zone)} ${hourMinute(ts, zone)}`;
  const at = (ts: string) => instant(ts);
  const plan = PLAN_NAMES[v.tier];
  const exportsPlan = firstPlanWith('exports');
  const sites = [...v.d.sites].sort(
    (a, b) => at(a.created_at) - at(b.created_at) || a.id.localeCompare(b.id),
  );
  const host = new Map(sites.map((s) => [s.id, s.host]));

  // ── the header ──
  const trial = v.account.state === 'pro_trial' || v.account.state === 'agency_trial';
  const line = [
    COPY.sites(sites.length),
    v.gates.exports ? COPY.exportsOn(plan) : COPY.exportsAre(exportsPlan),
    ...(trial ? [COPY.daysLeft(calendarDays(v.now, v.account.trial_ends_at!, zone), plan)] : []),
  ].join(' · ');

  // ── make a report ──
  const chosen =
    sites.find((s) => s.id === query.site) ?? (primarySites(v).length ? primarySite(v) : sites[0]);
  const results = chosen ? resultChecks(v, chosen.id) : [];
  const latest = results.at(-1);
  // The two latest results, the pair a compare starts from.
  const pair = results.length > 1 ? [results.at(-2)!, results.at(-1)!] : [];
  const twoDates = ([a, b]: Check[]) => {
    const [x, y] = [a!.finished_at!, b!.finished_at!];
    const month = (ts: string) => dayMonth(ts, zone).replace(/^\d+ /, '');
    const sameMonth = month(x) === month(y);
    return sameMonth
      ? COPY.comparePair(`${weekday(x, zone)} ${dayOfMonth(x, zone)}`, dayDate(y, zone))
      : COPY.comparePair(dayDate(x, zone), dayDate(y, zone));
  };
  const make = (
    kind: Report['kind'],
    label: string,
    extra: Record<string, string> = {},
    primary = false,
  ) =>
    action(
      'reports',
      label,
      {},
      {
        primary,
        fields: { siteId: chosen!.id, checkId: latest!.id, kind, ...extra },
      },
    );
  const canMake = v.gates.exports && chosen && latest;
  const pricing = action('pricing', COPY.comparePlans);

  // ── reports made, and scheduled ──
  const made = v.d.reports
    .filter((r) => r.kind !== 'public_link' && (r.status === 'ready' || r.status === 'sent'))
    .sort((a, b) => at(b.created_at) - at(a.created_at) || a.id.localeCompare(b.id));
  const coversOf = (r: Report): string => {
    const checks = r.covers_check_ids.map((id) => findCheck(v.d, id));
    const what =
      checks.length === 1
        ? checks[0]!.trigger === 'first_audit'
          ? COPY.firstAudit
          : COPY.checkOf(dayDate(checks[0]!.finished_at!, zone))
        : checks.length === 2
          ? COPY.vs(dayDate(checks[0]!.finished_at!, zone), dayDate(checks[1]!.finished_at!, zone))
          : COPY.span(
              checks.length,
              dayDate(checks[0]!.finished_at!, zone),
              dayDate(checks.at(-1)!.finished_at!, zone),
            );
    const cadence = v.d.sites.find((s) => s.id === r.site_id)?.schedule?.cadence;
    const by =
      r.made_by === 'scheduled_check' && cadence
        ? COPY.madeByCheck(cadence)
        : r.made_by === 'report_schedule' && r.recipient_email && r.status === 'sent'
          ? COPY.sentTo(r.recipient_email)
          : null;
    return [what, by].filter(Boolean).join(' · ');
  };
  const stateOf = (r: Report): FileState | null => side.fileStates?.get(r.id) ?? null;
  /** Whether the report has a file to hand over: the page's word for it, else the row's own. */
  const hasFile = (r: Report): boolean =>
    side.fileStates ? stateOf(r) === 'stored' : r.byte_count !== null || r.format === 'html';
  const mayShare = roleMay(role, 'share_report');
  /** A new link needs the plan's exports as well as the role; withdrawing one needs the role. */
  const mayLink = mayShare && v.gates.exports;
  /**
   * Whether the reader may make `r` a link. A client report's link is the one its mail carries; a
   * new one would revoke it, so none is offered (it may still be withdrawn).
   */
  const mayMake = (r: Report): boolean => mayLink && r.kind !== 'client_report';
  const sharedUntil = (r: Report): string | null =>
    hasFile(r) && r.share_expires_at !== null && at(r.share_expires_at) > at(v.now)
      ? COPY.link(dayDate(r.share_expires_at, zone))
      : null;
  const rowActions = (r: Report): ActionView[] => {
    if (!hasFile(r)) return [];
    const ctx = `${REPORT_TYPES[r.kind as keyof typeof REPORT_TYPES] ?? RAW_TYPES[r.format]}, ${when(r.created_at)}`;
    const get: ActionView =
      r.format === 'html'
        ? {
            label: COPY.open,
            route: PROOF_ROUTE,
            href: PROOF_ROUTE.replace('[id]', r.id),
            method: 'get',
            fields: {},
            primary: false,
            context: ctx,
          }
        : routeAction(
            'reportDownload',
            r.byte_count === null ? COPY.downloadFile : COPY.download(fileSize(r.byte_count)),
            { id: r.id },
            { context: ctx },
          );
    const until = sharedUntil(r);
    // With a link that works, making one replaces it: the action says so, and the row states the
    // expiry as text (`linkUntil`).
    const link = mayMake(r)
      ? routeAction(
          'reportShare',
          until === null ? COPY.makeLink : COPY.newLink,
          { id: r.id },
          { context: ctx },
        )
      : null;
    const withdraw =
      mayShare && until !== null
        ? routeAction(
            'reportShare',
            COPY.withdrawLink,
            { id: r.id },
            { fields: { _method: 'DELETE' }, context: ctx },
          )
        : null;
    return [get, link, withdraw].filter((a): a is ActionView => a !== null);
  };
  const typeOf = (r: Report) =>
    r.kind === 'raw_export' ? RAW_TYPES[r.format] : REPORT_TYPES[r.kind];
  const scheduled = v.d.reports
    .filter((r) => r.status === 'scheduled' || r.status === 'held')
    .sort((a, b) => at(a.scheduled_for!) - at(b.scheduled_for!) || a.id.localeCompare(b.id));
  return {
    shell: accountShellView(v, 'Reports', { role }),
    header: { title: COPY.title, line },
    make: {
      title: COPY.makeTitle,
      sub: chosen
        ? latest
          ? COPY.makeSub(chosen.host, when(latest.finished_at!))
          : COPY.makeNoCheck(chosen.host)
        : COPY.noSites,
      gate: v.tier === 'agency' ? null : gateMessage('exports', v.tier),
      sites: sites.map((s) => ({ value: s.id, label: s.host })),
      selected: chosen?.id ?? '',
      pick: { href: base, label: COPY.siteLabel, show: COPY.show },
      pdf: {
        title: COPY.pdfTitle,
        // The PDF carries no agency's name or domain (branding is not built), so the card says
        // what the file holds and promises neither.
        text: COPY.pdfBody,
        action: canMake
          ? make('audit_pdf', COPY.makePdf, {}, true)
          : v.gates.exports
            ? null
            : pricing,
      },
      compare: {
        title: COPY.compareTitle,
        text: pair.length === 2 ? `${twoDates(pair)} ${COPY.compareBody}` : COPY.compareNeedsTwo,
        action:
          canMake && pair.length === 2
            ? {
                ...make('compare', COPY.makeCompare, { previousCheckId: pair[0]!.id }),
                context: twoDates(pair).replace(/\.$/, ''),
              }
            : null,
      },
      raw: {
        title: COPY.rawTitle,
        text: COPY.rawBody,
        actions: canMake
          ? RAW_FORMATS.map((f) => make('raw_export', f.label, { format: f.format }))
          : [],
      },
    },
    made: {
      title: COPY.madeTitle,
      sub: COPY.madeSub(SHARE_LINK_DAYS),
      rows: made.map((r) => ({
        key: r.id,
        made: when(r.created_at),
        site: host.get(r.site_id) ?? '',
        type: typeOf(r),
        covers: coversOf(r),
        state: COPY.fileStates[stateOf(r) ?? 'stored'],
        actions: rowActions(r),
        linkUntil: sharedUntil(r),
        madeLink:
          side.madeLink?.reportId === r.id && hasFile(r)
            ? { label: COPY.madeLink, url: side.madeLink.url }
            : null,
      })),
      foot: COPY.madeFoot(SHARE_LINK_DAYS, exportsPlan),
      empty: made.length ? null : COPY.madeEmpty,
    },
    scheduled: {
      title: COPY.scheduledTitle,
      sub: scheduled.length ? COPY.toSend(scheduled.length) : COPY.none,
      rows: scheduled.map((r) => ({
        key: r.id,
        when: when(r.scheduled_for!),
        site: host.get(r.site_id) ?? '',
        type: typeOf(r),
        to: r.recipient_email ?? '',
        status: COPY.statusWords[r.status as 'scheduled' | 'held'],
      })),
      // No sender of the agency's own is named: Branding is not built, and the mail's sender is
      // the product's (`ALERTS_SENDER`).
      foot: v.tier === 'agency' ? COPY.scheduledAgency : gateMessage('clientReports', 'pro')!,
      compare: v.gates.agencyBranding ? null : pricing,
    },
  };
}
