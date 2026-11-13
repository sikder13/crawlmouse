/**
 * The agency's client reports (Final-Ag-Reports, CC-31 D8) as data: one row per client site the
 * reader's records hold, with its contact and where the contact stands, its schedule in words, its
 * next run and its owning seat; then the client reports that were sent.
 *
 * The records are the ones the page read for the reader, so a seat that covers some clients lists
 * those, and is told that the header's counts and an empty Sent table are of its own clients. A
 * staging copy is not a client and has no row. What the reader's own session is not
 * granted, the page hands over beside the records (`ClientReportsSide`): whether each schedule's
 * contact was asked to confirm and has confirmed, when the schedule runs next, and whether a
 * report's document is stored. A contact reads as confirmed where the page says it has confirmed.
 *
 * What a reader is offered follows `roleMay(role, 'schedule_report')`: the owner and an account
 * manager get each row's actions and the chosen client's forms; a developer gets the rows. The
 * routes ask `seat_may` again. Below Agency the page is `agencyGate`'s, as `/agency` is.
 */
import { instant, type Report, type Seat, type Site } from '@crawlmouse/types/v2';
import { ZONES } from '../account/profile';
import { agencyGateMessage, gateMessage } from '../agency/gates';
import { roleMay } from '../agency/guard';
import { CLIENT_COPY } from '../copy/agency';
import { CLIENT_REPORTS_COPY as COPY } from '../copy/client-reports';
import { dayDate, hourMinute } from '../format';
import {
  primarySites,
  readerRole,
  readerSeat,
  viewAt,
  type AccountDataset,
  type AccountView,
  type Viewer,
} from './account';
import type { ActionView } from './account-actions';
import { accountShellView, type ShellView, type SwitcherAccount } from './account-shell';
import { agencyGate, type AgencyGateView, type AgencyOpenView } from './agency-matrix';
import type { FileState } from './reports';

/** The routes this screen's forms post to; a form sends a verb HTML lacks as `_method`. */
export const CLIENT_REPORT_ROUTES = {
  client: { verb: 'PATCH', route: '/api/report-files/schedules/site/[siteId]/client' },
  schedule: { verb: 'PUT', route: '/api/report-files/schedules/site/[siteId]' },
  stop: { verb: 'DELETE', route: '/api/report-files/schedules/site/[siteId]' },
  confirm: { verb: 'POST', route: '/api/report-files/schedules/site/[siteId]/confirm' },
  resume: { verb: 'POST', route: '/api/report-files/schedules/site/[siteId]/resume' },
} as const;

type RouteKey = keyof typeof CLIENT_REPORT_ROUTES;

/** Where a sent report's document is read by a member: `app/reports/[id]/page.tsx`. */
const PROOF_ROUTE = '/reports/[id]';

/** How many sent reports the page lists; its line says how many there are. */
export const SENT_SHOWN = 20;

/** The anchor of the chosen client's forms. */
const CHANGE_ANCHOR = 'change';

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** The cadences a client report has, in the order the header and the form give them. */
const CADENCES = ['weekly', 'monthly'] as const;
const ROLES = ['owner', 'account_manager', 'developer'] as const satisfies readonly Seat['role'][];

/** A schedule's columns the reader's session is not granted, as the page read them. */
export interface ScheduleSide {
  nextRunAt: string | null;
  /** When the contact was last sent the confirmation link; null when it never was. */
  confirmSentAt: string | null;
  confirmedAt: string | null;
}

/** What a live page knows that the account's records do not hold. */
export interface ClientReportsSide {
  /** By site id. A schedule with no entry reads as never asked and not confirmed. */
  schedules?: ReadonlyMap<string, ScheduleSide>;
  /**
   * Each sent report's file state, by report id. Given, a report whose file is not `stored` has no
   * Open. Left out (a preview), a report that is a document has one.
   */
  fileStates?: ReadonlyMap<string, FileState>;
}

export interface ClientReportsReader {
  /** The accounts of the reader's active seats (`AccountViewer.accounts`). */
  accounts?: readonly SwitcherAccount[];
}

export type ContactState = 'none' | 'not_asked' | 'asked' | 'confirmed' | 'paused' | 'trial';

export interface ContactView {
  address: string | null;
  state: ContactState;
  /** "confirmed", "asked to confirm Sat 31 Oct", "no contact"; in the Agency trial, when it is asked. */
  label: string;
}

export interface ClientReportRowView {
  key: string;
  /** The client's name, or null where the site has none. */
  client: string | null;
  host: string;
  /** The client's page. */
  href: string;
  contact: ContactView;
  /** "weekly, Mon 08:00 their time", or "not scheduled". */
  schedule: string;
  /** "Mon 9 Nov 08:00 America/Denver": the schedule's own clock, with its zone. */
  nextRun: string;
  seat: string;
  /** For a reader who may schedule: the ask its state calls for, where one is sent, then Change. */
  actions: ActionView[];
}

export interface Option {
  value: string;
  label: string;
}

/** The chosen client's forms, each a POST with the verb its route takes. */
export interface ClientChangeView {
  id: string;
  title: string;
  host: string;
  client: {
    action: string;
    method: 'PATCH';
    name: string;
    email: string;
    seat: string;
    /**
     * Null when the client's owning seat is not one the field can offer: the reader's records do
     * not hold it, or it no longer covers the client.
     */
    seats: Option[] | null;
  };
  schedule: {
    action: string;
    method: 'PUT';
    cadence: string;
    cadences: Option[];
    weekday: string;
    weekdays: Option[];
    time: string;
    zone: string;
    /** The zone names the form offers: `zoneOptions`. */
    zones: Option[];
    unchanged: boolean;
    /** Its submit is the page's one orange element. */
    primary: boolean;
  };
  /** Null for a client with no schedule. */
  stop: ActionView | null;
}

export interface SentRowView {
  key: string;
  /** "Mon 26 Oct 10:00", in the account's zone. */
  sent: string;
  host: string;
  to: string;
  /** The report's document, where it has one that is stored. */
  open: ActionView | null;
}

export interface ClientReportsView {
  kind: 'reports';
  shell: ShellView;
  header: {
    title: string;
    /** "9 weekly, 3 monthly, 1 not scheduled", counted from the rows. */
    line: string;
    /** "Schedule a report for <host>", while a client has none and no client's forms are open. */
    action: ActionView | null;
  };
  /** For an account in its Agency trial. */
  trialNote: string | null;
  clients: {
    title: string;
    sub: string;
    rows: ClientReportRowView[];
    /** In place of the table when there is no client. */
    empty: string | null;
  };
  change: ClientChangeView | null;
  sent: {
    title: string;
    /** "20 of 43 shown, the newest first"; empty when none was sent. */
    sub: string;
    rows: SentRowView[];
    empty: string | null;
  };
}

export type ClientReportsPageView = ClientReportsView | AgencyGateView | AgencyOpenView;

const pathOf = (key: RouteKey, siteId: string) =>
  CLIENT_REPORT_ROUTES[key].route.replace('[siteId]', siteId);

/** One of this screen's routes as a POST form, the verb in `_method` where HTML has none. */
function post(key: RouteKey, label: string, site: Site): ActionView {
  const { verb, route } = CLIENT_REPORT_ROUTES[key];
  return {
    label,
    route,
    href: pathOf(key, site.id),
    method: 'post',
    fields: verb === 'POST' ? {} : { _method: verb },
    primary: false,
    context: site.host,
  };
}

const link = (
  href: string,
  label: string,
  { route = href, primary = false, context = null as string | null } = {},
): ActionView => ({ label, route, href, method: 'get', fields: {}, primary, context });

/**
 * The header's count, by iterating the clients: each cadence a client's schedule holds, in the
 * form's order and then any other by name, and last the clients with no schedule. A count of
 * nothing is left out.
 */
function scheduleCounts(clients: readonly Site[]): string[] {
  const counts = new Map<string, number>();
  let unscheduled = 0;
  for (const s of clients) {
    const cadence = s.client_report?.cadence;
    if (cadence === undefined) unscheduled += 1;
    else counts.set(cadence, (counts.get(cadence) ?? 0) + 1);
  }
  const order = (c: string) => {
    const i = (CADENCES as readonly string[]).indexOf(c);
    return i < 0 ? CADENCES.length : i;
  };
  return [
    ...[...counts.keys()]
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b, 'en'))
      .map((c) => COPY.cadenceCount(counts.get(c)!, c)),
    ...(unscheduled ? [COPY.unscheduledCount(unscheduled)] : []),
  ];
}

/**
 * Whether the account's Agency trial keeps mail from this client's contact: in the trial a report,
 * and the confirmation before it, go to the account owner's own address and to no other
 * (`due_report_schedules` and `issue_recipient_confirmation`, which compare the two in lower case).
 * The owner's address is the account's (`Account.email`, the owner's `users.email`).
 */
function heldByTrial(v: AccountView, s: Site): boolean {
  const contact = s.client_contact_email;
  return (
    v.account.state === 'agency_trial' &&
    contact !== null &&
    contact.toLowerCase() !== v.account.email.toLowerCase()
  );
}

function contactOf(
  s: Site,
  side: ScheduleSide | undefined,
  zone: string,
  held: boolean,
): ContactView {
  const address = s.client_contact_email;
  const as = (state: ContactState, label: string): ContactView => ({ address, state, label });
  if (address === null) return as('none', COPY.contact.none);
  const schedule = s.client_report;
  // The confirmation is the schedule's: a client with no schedule has none.
  if (schedule === null) return as('not_asked', COPY.contact.notAsked);
  // Nothing was mailed to it and nothing will be while the trial runs, whatever was asked for.
  if (held) return as('trial', COPY.contact.trial);
  if (schedule.paused_by_recipient_at !== null) return as('paused', COPY.contact.paused);
  if (side?.confirmedAt) return as('confirmed', COPY.contact.confirmed);
  if (side?.confirmSentAt)
    return as('asked', COPY.contact.asked(dayDate(side.confirmSentAt, zone)));
  return as('not_asked', COPY.contact.notAsked);
}

function scheduleOf(s: Site): string {
  const r = s.client_report;
  return r
    ? CLIENT_COPY.reportWhen(r.cadence, WEEKDAYS[r.iso_weekday]!, r.time_local)
    : CLIENT_COPY.noReport;
}

function nextRunOf(s: Site, side: ScheduleSide | undefined): string {
  const r = s.client_report;
  if (r === null) return COPY.noNextRun;
  if (r.paused_by_recipient_at !== null) return COPY.noNextRunPaused;
  const at = side?.nextRunAt;
  return at
    ? COPY.nextRun(`${dayDate(at, r.timezone)} ${hourMinute(at, r.timezone)}`, r.timezone)
    : COPY.noNextRun;
}

const seatLabel = (seat: Seat) =>
  CLIENT_COPY.seat(seat.name ?? seat.email, CLIENT_COPY.roles[seat.role]);

/** The seat that owns the client, as far as the reader's records name it. */
function seatOf(v: AccountView, s: Site): string {
  if (s.owner_seat_id === null) return CLIENT_COPY.none;
  const seat = v.d.seats.find((x) => x.id === s.owner_seat_id);
  return seat ? seatLabel(seat) : CLIENT_COPY.seatNotListed;
}

/** The accepted seats whose scope covers the client: the ones `set_client` takes as its owner. */
function owningSeats(v: AccountView, s: Site): Option[] {
  return [...v.d.seats]
    .filter(
      (x) => x.accepted_at !== null && (x.client_scope === 'all' || x.client_scope.includes(s.id)),
    )
    .sort(
      (a, b) =>
        ROLES.indexOf(a.role) - ROLES.indexOf(b.role) ||
        a.invited_at.localeCompare(b.invited_at) ||
        a.id.localeCompare(b.id),
    )
    .map((x) => ({ value: x.id, label: seatLabel(x) }));
}

/**
 * The zones a schedule's form offers: the names the account's own zone is chosen from (`ZONES`,
 * lib/v2/account/profile.ts), in order, and `current` where it is not one of them, so a schedule
 * whose zone is an alias (`America/Indiana/Indianapolis`) is not moved by a save. The form posts a
 * name from this list; agency-reports.test.ts parses each of `ZONES` with the contract's
 * `TimeZoneSchema` and with the schedule route's own body.
 */
function zoneOptions(current: string): Option[] {
  const names = [...new Set([current, ...ZONES])].sort((a, b) => a.localeCompare(b, 'en'));
  return names.map((z) => ({ value: z, label: z }));
}

/** The page with one client's card open, where its contact, schedule and owning seat are changed. */
export const clientCardHref = (base: string, siteId: string) =>
  `${base}?client=${siteId}#${CHANGE_ANCHOR}`;
const changeHref = (base: string, s: Site) => clientCardHref(base, s.id);

/**
 * Of `reports`, the client reports that were sent: how many there are, and the newest SENT_SHOWN,
 * which the page lists. A report that is scheduled or held was not sent. A sent report holds its
 * `sent_at` (the contract's `report_sent` rule, packages/types/src/v2/report.ts).
 */
export function shownSent(reports: readonly Report[]): { shown: Report[]; total: number } {
  const sent = reports
    .filter((r) => r.kind === 'client_report' && r.status === 'sent')
    .sort((a, b) => instant(b.sent_at!) - instant(a.sent_at!) || a.id.localeCompare(b.id));
  const shown = sent.slice(0, SENT_SHOWN);
  return { shown, total: sent.length };
}

function rowActions(s: Site, contact: ContactView, base: string): ActionView[] {
  return [
    ...(contact.state === 'paused' ? [post('resume', COPY.askAfterPause, s)] : []),
    // With no schedule, or a contact that has confirmed, the confirm route has nothing to ask
    // (`resendConfirmation`, lib/v2/agency/schedules.ts). A contact the Agency trial keeps mail
    // from (`trial`) is in neither state here, so it is offered no ask.
    ...(s.client_report !== null && (contact.state === 'asked' || contact.state === 'not_asked')
      ? [post('confirm', contact.state === 'asked' ? COPY.askAgain : COPY.askToConfirm, s)]
      : []),
    link(changeHref(base, s), COPY.change, { route: base, context: s.host }),
  ];
}

function changeOf(v: AccountView, s: Site): ClientChangeView {
  const r = s.client_report;
  const F = COPY.form;
  const seats = owningSeats(v, s);
  const zone = r?.timezone ?? v.account.timezone;
  // The field is a select: one whose value is not among its options shows its first, "none", and a
  // save would post that. So it is drawn when the client has no owning seat, or its owning seat is
  // one of the options: a seat the reader's records hold, accepted, that still covers the client.
  const ownerOffered =
    s.owner_seat_id === null || seats.some((option) => option.value === s.owner_seat_id);
  return {
    id: CHANGE_ANCHOR,
    title: F.title(s.client_name?.trim() || s.host),
    host: s.host,
    client: {
      action: pathOf('client', s.id),
      method: CLIENT_REPORT_ROUTES.client.verb,
      name: s.client_name ?? '',
      email: s.client_contact_email ?? '',
      seat: s.owner_seat_id ?? '',
      // Left out, the field is not posted and `set_client` leaves the owning seat as it is.
      seats: ownerOffered ? [{ value: '', label: F.noSeat }, ...seats] : null,
    },
    schedule: {
      action: pathOf('schedule', s.id),
      method: CLIENT_REPORT_ROUTES.schedule.verb,
      cadence: r?.cadence ?? CADENCES[0],
      cadences: CADENCES.map((c) => ({ value: c, label: F.cadences[c] })),
      weekday: String(r?.iso_weekday ?? 1),
      weekdays: F.weekdays.map((label, i) => ({ value: String(i + 1), label })),
      time: r?.time_local ?? '08:00',
      zone,
      zones: zoneOptions(zone),
      unchanged: r?.send_when_unchanged ?? false,
      primary: true,
    },
    stop: r === null ? null : post('stop', F.stop, s),
  };
}

function reportsView(
  v: AccountView,
  shell: ShellView,
  query: { client?: string },
  base: string,
  side: ClientReportsSide,
): ClientReportsView {
  const zone = v.account.timezone;
  const role = readerRole(v) ?? 'developer';
  const maySchedule = roleMay(role, 'schedule_report');
  const clients = [...primarySites(v)].sort(
    (a, b) => a.host.localeCompare(b.host, 'en') || a.id.localeCompare(b.id),
  );
  const host = new Map(clients.map((s) => [s.id, s.host]));
  const mine = readerSeat(v);
  const scoped = v.seatId !== null && mine !== null && mine.client_scope !== 'all';
  const noClients = scoped ? COPY.noClientsInSeat : COPY.noClients;

  const chosen = maySchedule ? clients.find((s) => s.id === query.client) : undefined;
  const unscheduled = clients.find((s) => s.client_report === null);

  const { shown, total } = shownSent(v.d.reports);
  const stored = (id: string) => !side.fileStates || side.fileStates.get(id) === 'stored';

  const counts = scheduleCounts(clients);
  return {
    kind: 'reports',
    shell,
    header: {
      title: COPY.title,
      line: counts.length
        ? scoped
          ? COPY.inSeat(counts.join(', '))
          : counts.join(', ')
        : noClients,
      action:
        maySchedule && unscheduled && !chosen
          ? link(changeHref(base, unscheduled), COPY.scheduleFor(unscheduled.host), {
              route: base,
              primary: true,
            })
          : null,
    },
    trialNote: v.account.state === 'agency_trial' ? COPY.trialNote : null,
    clients: {
      title: COPY.clientsTitle(clients.length),
      sub: COPY.clientsSub,
      rows: clients.map((s) => {
        const contact = contactOf(s, side.schedules?.get(s.id), zone, heldByTrial(v, s));
        return {
          key: s.id,
          client: s.client_name?.trim() || null,
          host: s.host,
          href: `/agency/clients/${s.id}`,
          contact,
          schedule: scheduleOf(s),
          nextRun: nextRunOf(s, side.schedules?.get(s.id)),
          seat: seatOf(v, s),
          actions: maySchedule ? rowActions(s, contact, base) : [],
        };
      }),
      empty: clients.length ? null : noClients,
    },
    change: chosen ? changeOf(v, chosen) : null,
    sent: {
      title: COPY.sentTitle,
      sub: total ? COPY.sentSub(shown.length, total) : '',
      rows: shown.map((r) => {
        const when = `${dayDate(r.sent_at!, zone)} ${hourMinute(r.sent_at!, zone)}`;
        const site = host.get(r.site_id) ?? '';
        return {
          key: r.id,
          sent: when,
          host: site,
          to: r.recipient_email ?? '',
          // `/reports/<id>` opens a report that is a document, and one whose file is stored.
          open:
            r.format === 'html' && stored(r.id)
              ? link(PROOF_ROUTE.replace('[id]', r.id), COPY.open, {
                  route: PROOF_ROUTE,
                  context: `${site}, ${when}`,
                })
              : null,
        };
      }),
      empty: total ? null : scoped ? COPY.sentEmptyInSeat : COPY.sentEmpty,
    },
  };
}

/**
 * What `/agency/reports` shows the reader of `viewer`'s account. `query.client` is the client whose
 * forms are open, and `base` the page its links reload (`/agency/reports`, or a preview's path).
 * Below Agency it is the gate, worded for client reports where the next plan has them, or the
 * switch to the reader's agency.
 */
export function agencyReportsView(
  d: AccountDataset,
  viewer: Viewer,
  query: { client?: string },
  base: string,
  side: ClientReportsSide = {},
  reader: ClientReportsReader = {},
): ClientReportsPageView {
  const v = viewAt(d, viewer);
  const gate = agencyGate(d, viewer, reader);
  if (gate?.kind === 'open') return gate;
  if (gate) {
    const message = v.tier === 'agency' ? null : gateMessage('clientReports', v.tier);
    return { ...gate, title: COPY.title, message: message ?? agencyGateMessage() };
  }
  const role = readerRole(v) ?? 'developer';
  const shell = accountShellView(v, 'Reports', { role, accounts: reader.accounts ?? [] });
  return reportsView(v, shell, query, base, side);
}
