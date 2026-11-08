/**
 * Reports and exports (Final-Reports) as data (D5). "Reports made" is the account's reports by
 * `now`, newest first, the public audit link left out (owner ruling 7: each site page carries it);
 * "Covers" names the checks a report covers; a share link shows while `share_expires_at` is ahead;
 * sizes come from `byte_count`. Making a report needs `GATES[tier].exports`; without it the card
 * offers the plans instead. The site the card makes reports for is the page's `?site=`, by default
 * the primary site.
 */
import { instant, type Check, type FixtureDataset, type Report } from '@crawlmouse/types/v2';
import { GATES, type Tier } from '../../entitlement-v2';
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
  resultChecks,
  viewAt,
  type Viewer,
} from './account';
import { action, type ActionView } from './account-actions';
import { accountShellView, type ShellView } from './account-shell';
import { routeAction } from './settings';

export { SHARE_LINK_DAYS } from '../copy/reports';

export interface MadeRowView {
  key: string;
  made: string;
  site: string;
  type: string;
  covers: string;
  actions: ActionView[];
}

export interface ScheduledRowView {
  key: string;
  when: string;
  site: string;
  type: string;
  to: string;
  status: Report['status'];
}

export interface ReportsView {
  shell: ShellView;
  header: { title: string; line: string };
  make: {
    title: string;
    sub: string;
    /** The site picker: a GET form to `base` that reloads the card for another site. */
    sites: { value: string; label: string }[];
    selected: string;
    pick: { href: string; label: string; show: string };
    pdf: { title: string; text: string; action: ActionView | null };
    compare: { title: string; text: string };
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
  d: FixtureDataset,
  viewer: Viewer,
  query: { site?: string },
  /** The page the site picker reloads: `/reports`, or a preview's path. */
  base: string,
): ReportsView {
  const v = viewAt(d, viewer);
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
  const pair = results.slice(-2);
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
        : COPY.vs(...(checks.map((c) => dayDate(c.finished_at!, zone)) as [string, string]));
    const cadence = v.d.sites.find((s) => s.id === r.site_id)?.schedule?.cadence;
    const by =
      r.made_by === 'scheduled_check' && cadence
        ? COPY.madeByCheck(cadence)
        : r.made_by === 'report_schedule' && r.recipient_email && r.status === 'sent'
          ? COPY.sentTo(r.recipient_email)
          : null;
    return [what, by].filter(Boolean).join(' · ');
  };
  const rowActions = (r: Report): ActionView[] => {
    const ctx = `${REPORT_TYPES[r.kind as keyof typeof REPORT_TYPES] ?? RAW_TYPES[r.format]}, ${when(r.created_at)}`;
    const get =
      r.byte_count !== null
        ? routeAction(
            'reportDownload',
            COPY.download(fileSize(r.byte_count)),
            { id: r.id },
            { context: ctx },
          )
        : r.format === 'html'
          ? routeAction('reportDownload', COPY.open, { id: r.id }, { context: ctx })
          : null;
    const share =
      r.share_expires_at && at(r.share_expires_at) > at(v.now)
        ? routeAction(
            'reportShare',
            COPY.link(dayDate(r.share_expires_at, zone)),
            { id: r.id },
            { context: ctx },
          )
        : null;
    return [get, share].filter((a): a is ActionView => a !== null);
  };
  const typeOf = (r: Report) =>
    r.kind === 'raw_export' ? RAW_TYPES[r.format] : REPORT_TYPES[r.kind];
  const scheduled = v.d.reports
    .filter((r) => r.status === 'scheduled' || r.status === 'held')
    .sort((a, b) => at(a.scheduled_for!) - at(b.scheduled_for!) || a.id.localeCompare(b.id));
  const branding = v.gates.agencyBranding ? v.account.branding : null;

  return {
    shell: accountShellView(v, 'Reports'),
    header: { title: COPY.title, line },
    make: {
      title: COPY.makeTitle,
      sub: chosen
        ? latest
          ? COPY.makeSub(chosen.host, when(latest.finished_at!))
          : COPY.makeNoCheck(chosen.host)
        : COPY.noSites,
      sites: sites.map((s) => ({ value: s.id, label: s.host })),
      selected: chosen?.id ?? '',
      pick: { href: base, label: COPY.siteLabel, show: COPY.show },
      pdf: {
        title: COPY.pdfTitle,
        text: `${COPY.pdfBody} ${v.gates.agencyBranding ? COPY.branded : COPY.brandedOnAgency}`,
        action: canMake
          ? make('audit_pdf', COPY.makePdf, {}, true)
          : v.gates.exports
            ? null
            : pricing,
      },
      compare: {
        title: COPY.compareTitle,
        text: pair.length === 2 ? `${twoDates(pair)} ${COPY.compareBody}` : COPY.compareNeedsTwo,
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
        actions: rowActions(r),
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
        status: r.status,
      })),
      foot: branding?.sender_email ? COPY.sentFrom(branding.sender_email) : COPY.scheduledFoot,
      compare: v.gates.agencyBranding ? null : pricing,
    },
  };
}
