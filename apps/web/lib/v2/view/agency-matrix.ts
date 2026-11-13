/**
 * The client matrix (Final-Ag-Matrix) as data: one row per client site the reader's seat covers,
 * with both grades and what moved since each site's previous check, sites with a new problem first.
 *
 * Each row's grades, pills, last check and schedule are the dashboard's own site row
 * (`dashboardView`), and a client with no result yet reads as its site page does (`sitePage`), so
 * the matrix cannot say of a site what those screens do not. The records it reads are the ones
 * `loadAccountDataset` returned for the reader, which holds the sites their seat covers and no
 * others; a staging copy is not a client and has no row.
 *
 * `agencyHomeView` is what `/agency` renders: the matrix on the Agency tier; below it the gate; and
 * for a reader acting in an account that is not an agency while holding a seat on one, the switch.
 */
import { instant, type Site } from '@crawlmouse/types/v2';
import { GATES } from '../../entitlement-v2';
import { extrasSold } from '../agency/extras-bounds';
import { roleMay } from '../agency/guard';
import { agencyGateMessage } from '../agency/gates';
import { MATRIX_COPY as COPY } from '../copy/agency';
import { dayDate, hourMinute, listOf, nextWeekly } from '../format';
import {
  addsSites,
  primarySites,
  readerRole,
  readerSeat,
  resultChecks,
  viewAt,
  type AccountDataset,
  type AccountView,
  type Viewer,
} from './account';
import { action, type ActionView } from './account-actions';
import {
  accountLabel,
  accountShellView,
  type ShellView,
  type SwitcherAccount,
} from './account-shell';
import { nextCheck, zoneOf, type GradeCell } from './checks';
import { dashboardView, type SinceCellView, type SiteRowView } from './dashboard';
import { BUY_ANCHOR } from './seats';
import { sitePage } from './site';

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface ClientRowView {
  key: string;
  host: string;
  /** The client's page. */
  href: string;
  /** The client's name, or null where the site has none. */
  client: string | null;
  seo: GradeCell | null;
  ai: GradeCell | null;
  /** The AI grade is withheld at the site's latest result. */
  aiWithheld: boolean;
  since: SinceCellView;
  /** The cell's words when it has no pills: "first audit · 13 fixes", "no change". */
  sinceLabel: string | null;
  /**
   * A client with no result yet: what its first check is doing ("Not checked yet", "First check
   * running · 42 pages read so far"), and the one thing to do about it: start it, or watch it.
   */
  first: { label: string; action: ActionView } | null;
  /** "Fri 6 Nov around 06:00", or "none scheduled". */
  nextCheck: string;
  lastCheck: string;
  /** "weekly, Fri · report weekly, Mon". */
  schedule: string;
}

/** A count of changes, and the clients they are at. */
export interface StripCountView {
  count: number;
  /** "at granitepeak.example and harborlight.example". */
  detail: string;
}

export interface MatrixStripView {
  label: string;
  /** Clients with a problem opened since their previous check, of those that have two results. */
  calls: { count: number; detail: string };
  /** Null when nothing was opened: the cell is left out, not shown as zero. */
  opened: StripCountView | null;
  resolved: StripCountView | null;
}

/** Setup's one next step: the first of add a client, run a first check, invite, send a report. */
export interface NextStepView {
  step: 'add' | 'check' | 'invite' | 'report';
  title: string;
  body: string;
  /** Null for the add step, whose action is the header's form. */
  action: ActionView | null;
}

export interface MatrixView {
  kind: 'matrix';
  shell: ShellView;
  header: {
    title: string;
    line: string;
    /** "Add a client site · 2 of 25": the form, for a seat that may add one while a slot is free. */
    actions: ActionView[];
  };
  /** Null until a client has two results to compare. */
  strip: MatrixStripView | null;
  next: NextStepView | null;
  clients: {
    title: string;
    sub: string;
    rows: ClientRowView[];
    /** What the card says in place of the table when there is no client to list. */
    empty: string | null;
  };
}

/** An account below Agency: the gate, with the plans a click away. */
export interface AgencyGateView {
  kind: 'gate';
  shell: ShellView;
  title: string;
  message: string;
  action: ActionView;
}

/** A reader acting in an account that is not an agency, who holds a seat on one: the switch. */
export interface AgencyOpenView {
  kind: 'open';
  shell: ShellView;
  title: string;
  body: string;
  /** One per agency the reader holds a seat on, by name; the first is the page's orange element. */
  agencies: ActionView[];
}

export type AgencyHomeView = MatrixView | AgencyGateView | AgencyOpenView;

export interface AgencyReader {
  /** The accounts of the reader's active seats (`AccountViewer.accounts`). */
  accounts?: readonly SwitcherAccount[];
  /**
   * Whether the plan's extra seats and sites can be bought here (`V2_BILLING`): `/seats` draws its
   * buy form only then, so only then does the matrix link to it. Left out, it is not linked.
   */
  billing?: boolean;
  /**
   * Whether a client report was sent, as the page's own read found: the records a page reads
   * (`loadAccountDataset`) hold no client report. Left out (a preview), the dataset's own reports
   * say. The read is the reader's, so it speaks for the account where their seat covers every
   * client; the matrix asks it of no other seat (`nextStep`).
   */
  reportSent?: boolean;
}

function reportCell(s: Site): string {
  const r = s.client_report;
  return r ? COPY.report(r.cadence, WEEKDAYS[r.iso_weekday]!) : COPY.noReport;
}

/** The earliest weekly check ahead of any client, as the dashboard writes one: "Fri 6 Nov around 06:00". */
function nextWeeklyOf(v: AccountView, clients: readonly Site[]): string | null {
  const zone = zoneOf(v);
  const next = clients
    .flatMap((s) =>
      !s.paused && s.schedule?.cadence === 'weekly'
        ? [
            nextWeekly(
              { iso_weekday: s.schedule.iso_weekday!, hour_local: s.schedule.hour_local! },
              v.now,
              zone,
            ),
          ]
        : [],
    )
    .sort((a, b) => instant(a) - instant(b))[0];
  return next ? `${dayDate(next, zone)} around ${hourMinute(next, zone)}` : null;
}

/** A client with no result yet, read as its site page reads it; null once it has one. */
function firstOf(d: AccountDataset, viewer: Viewer, site: Site): ClientRowView['first'] {
  const page = sitePage(d, viewer, site.id);
  if (page.kind !== 'first_check') return null;
  // The site page's line is "<today> · <state> · <pages read>": the row has no use for the date.
  const [, ...state] = page.first.line.split(' · ');
  const label = state.join(' · ');
  const act = page.first.actions[0]!;
  return {
    label,
    action:
      act.method === 'post'
        ? action('runCheck', COPY.runFirst, { id: site.id }, { context: site.host })
        : { ...act, primary: false, context: site.host },
  };
}

/** A link to a page of the workspace that has no entry in ACCOUNT_ACTIONS. */
const link = (href: string, label: string): ActionView => ({
  label,
  route: href,
  href,
  method: 'get',
  fields: {},
  primary: false,
  context: null,
});

const names = (rows: readonly ClientRowView[]) => COPY.strip.at(listOf(rows.map((r) => r.host)));

function stripOf(rows: readonly ClientRowView[], compared: number): MatrixStripView | null {
  if (compared === 0) return null;
  const opened = rows.filter((r) => r.since.opened > 0);
  const resolved = rows.filter((r) => r.since.resolved > 0);
  const sum = (xs: readonly ClientRowView[], key: 'opened' | 'resolved') =>
    xs.reduce((n, r) => n + r.since[key], 0);
  return {
    label: COPY.strip.label,
    calls: {
      count: opened.length,
      detail: [opened.map((r) => r.host).join(', '), COPY.strip.compared(compared)]
        .filter(Boolean)
        .join(' · '),
    },
    opened: opened.length ? { count: sum(opened, 'opened'), detail: names(opened) } : null,
    resolved: resolved.length
      ? { count: sum(resolved, 'resolved'), detail: names(resolved) }
      : null,
  };
}

/**
 * Setup's next step, in order, the first that is not done and that the reader's seat may do: add a
 * client; run the first check of a client that has none; invite a colleague; send a first report.
 *
 * `sent` is read from the reader's own records, which for a seat that covers some clients
 * (`scoped`) hold no report sent to a client outside it: such a seat is not shown the report step,
 * which says of the account that none was sent.
 */
function nextStep(
  v: AccountView,
  rows: readonly ClientRowView[],
  adds: boolean,
  sent: boolean,
  scoped: boolean,
): NextStepView | null {
  const role = readerRole(v);
  const S = COPY.steps;
  if (rows.length === 0) {
    return adds ? { step: 'add', title: S.addTitle, body: S.addBody, action: null } : null;
  }
  const unchecked = rows.find((r) => r.first?.action.method === 'post');
  if (unchecked) {
    return {
      step: 'check',
      title: S.checkTitle(unchecked.host),
      body: S.checkBody,
      // Named apart from the row's own button, which the row's site names.
      action: { ...unchecked.first!.action, label: S.checkAction, primary: true },
    };
  }
  if (!rows.some((r) => r.first === null) || role === null) return null;
  if (v.d.seats.length === 1 && roleMay(role, 'invite_seat')) {
    return {
      step: 'invite',
      title: S.inviteTitle,
      body: S.inviteBody(v.account.limits.seats),
      action: { ...link('/seats', S.inviteAction), primary: true },
    };
  }
  if (v.d.seats.length > 1 && !sent && !scoped && roleMay(role, 'schedule_report')) {
    return {
      step: 'report',
      title: S.reportTitle,
      body: S.reportBody,
      action: { ...link('/agency/reports', S.reportAction), primary: true },
    };
  }
  return null;
}

/** Sites with a new problem first, the most opened first; then by host. */
const byProblem = (a: ClientRowView, b: ClientRowView) =>
  b.since.opened - a.since.opened || a.host.localeCompare(b.host, 'en');

function matrixView(
  d: AccountDataset,
  viewer: Viewer,
  v: AccountView,
  shell: ShellView,
  billing: boolean,
  reportSent: boolean | undefined,
): MatrixView {
  const zone = zoneOf(v);
  const clients = primarySites(v);
  const dash = new Map<string, SiteRowView>(
    dashboardView(d, viewer).sites.rows.map((r) => [r.key, r]),
  );
  const rows = clients
    .map((s): ClientRowView => {
      const row = dash.get(s.id)!;
      return {
        key: s.id,
        host: s.host,
        href: `/agency/clients/${s.id}`,
        client: s.client_name?.trim() || null,
        seo: row.seo,
        ai: row.ai,
        aiWithheld: row.aiWithheld,
        since: row.since,
        sinceLabel: row.sinceLabel,
        first: firstOf(d, viewer, s),
        nextCheck: nextCheck(s, v, (ts) => dayDate(ts, zone)) ?? COPY.noNextCheck,
        lastCheck: row.lastCheck,
        schedule: `${row.schedule} · ${reportCell(s)}`,
      };
    })
    .sort(byProblem);

  const scoped = readerSeat(v) !== null && readerSeat(v)!.client_scope !== 'all';
  const adds = addsSites(v);
  const limit = v.account.limits.sites;
  const n = rows.length;
  const next = nextStep(
    v,
    rows,
    adds,
    reportSent ?? v.d.reports.some((r) => r.kind === 'client_report' && r.status === 'sent'),
    scoped,
  );
  const role = readerRole(v);
  /** At the plan's limit, a reader who may buy is shown the way to the buy form (`/seats`). */
  const buys =
    billing &&
    adds &&
    n >= limit &&
    limit < GATES.agency.maxSites &&
    // The link is to the buy form, which `/seats` draws for these accounts (lib/v2/view/seats.ts).
    extrasSold(v.account.state, v.gates.agencyBranding) &&
    role !== null &&
    roleMay(role, 'buy_seats');
  const compared = clients.filter((s) => resultChecks(v, s.id).length > 1).length;
  const strip = stripOf(rows, compared);
  const upcoming = nextWeeklyOf(v, clients);
  return {
    kind: 'matrix',
    shell,
    header: {
      title: next?.step === 'add' ? next.title : strip ? COPY.sinceTitle : COPY.title,
      line: [
        dayDate(v.now, zone),
        scoped
          ? `${COPY.clientSites(n)} ${COPY.inYourSeat}`
          : `${COPY.clientSites(n)}, ${COPY.unused(Math.max(0, limit - n), limit)}`,
        upcoming ? COPY.nextWeekly(upcoming) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      actions:
        adds && n < limit
          ? [
              action(
                'addSite',
                COPY.add(n, limit),
                {},
                {
                  // Orange while no other step of setup is the next one.
                  primary: next === null || next.step === 'add',
                  inputs: [
                    { kind: 'text', name: 'url', type: 'text', ...COPY.addField, required: true },
                  ],
                },
              ),
            ]
          : buys
            ? [link(`/seats#${BUY_ANCHOR}`, COPY.buySites)]
            : [],
    },
    strip,
    next,
    clients: {
      title: COPY.tableTitle(n),
      sub: n ? COPY.tableSub(n, scoped) : '',
      rows,
      empty: n ? null : adds ? COPY.steps.addBody : COPY.steps.noClientsInSeat,
    },
  };
}

/**
 * What an Agency-only page shows in place of itself: null on the Agency tier. Below it, the switch
 * when the account is not an agency's and the reader holds a seat on one; else the gate.
 */
export function agencyGate(
  d: AccountDataset,
  viewer: Viewer,
  { accounts = [] }: AgencyReader = {},
): AgencyGateView | AgencyOpenView | null {
  const v = viewAt(d, viewer);
  if (v.tier === 'agency') return null;
  // Not a page of this account's rail: nothing in it is marked.
  const shell = accountShellView(v, null, { role: readerRole(v) ?? 'developer', accounts });
  const here = accounts.find((a) => a.id === v.account.id);
  const agencies = accounts.filter((a) => a.kind === 'agency' && a.id !== v.account.id);
  if (here && here.kind !== 'agency' && agencies.length > 0) {
    return {
      kind: 'open',
      shell,
      title: COPY.openTitle,
      body: COPY.openBody(accountLabel(here)),
      agencies: agencies
        .map((a) => ({ id: a.id, label: accountLabel(a) }))
        .sort((x, y) => x.label.localeCompare(y.label, 'en') || x.id.localeCompare(y.id))
        .map((a, i) =>
          action(
            'switchAccount',
            COPY.open(a.label),
            {},
            { fields: { accountId: a.id }, primary: i === 0 },
          ),
        ),
    };
  }
  return {
    kind: 'gate',
    shell,
    title: COPY.title,
    message: agencyGateMessage(),
    action: action('pricing', COPY.gateAction, {}, { primary: true }),
  };
}

/** What `/agency` shows the reader of `viewer`'s account: the matrix on the Agency tier, else `agencyGate`. */
export function agencyHomeView(
  d: AccountDataset,
  viewer: Viewer,
  reader: AgencyReader = {},
): AgencyHomeView {
  const gate = agencyGate(d, viewer, reader);
  if (gate) return gate;
  const v = viewAt(d, viewer);
  const role = readerRole(v) ?? 'developer';
  return matrixView(
    d,
    viewer,
    v,
    accountShellView(v, 'Clients', { role, accounts: reader.accounts ?? [] }),
    reader.billing === true,
    reader.reportSent,
  );
}
