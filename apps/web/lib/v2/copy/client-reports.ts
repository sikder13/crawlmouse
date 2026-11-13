/**
 * The client reports screen's written sentences (Final-Ag-Reports, CC-31 D8): the parts no record
 * holds, with each count, date and name a parameter the view fills from the data
 * (OPERATING-RULES §10). Where the screen differs from its locked HTML follows.
 */
import type { Addition, CopyChange } from '../copy-registry';
import { count } from '../words';
import { agencyRailChanges } from './agency';

export const CLIENT_REPORTS_COPY = {
  title: 'Client reports',
  /** One part of the header's line: "2 weekly". The cadence is the schedule's own word. */
  cadenceCount: (n: number, cadence: string) => `${count(n)} ${cadence}`,
  unscheduledCount: (n: number) => `${count(n)} not scheduled`,
  /** The header's line for a seat that covers some clients: the count is of its own clients. */
  inSeat: (line: string) => `${line}, of the client sites in your seat`,
  noClients: 'No client site yet',
  noClientsInSeat: 'No client site is in your seat yet',
  /** The header's action, for a client that has no schedule. */
  scheduleFor: (host: string) => `Schedule a report for ${host}`,
  /**
   * Said once on the page of an account in its Agency trial: the trial rule of a schedule's run,
   * the third thing it decides (`skipReason`, lib/v2/agency/schedules-run.ts), which
   * `pnpm --filter @crawlmouse/web exec vitest run lib/v2/agency/schedules-run.test.ts` holds.
   */
  trialNote:
    'This account is in its Agency trial. While the trial runs, a report is sent where the client’s contact is the account owner’s own address; a schedule with another contact sends nothing.',

  clientsTitle: (n: number) => `Clients · ${count(n)}`,
  clientsSub:
    'A report goes to a client’s contact once the contact has confirmed. The pause link in a report stops them, and they start again only when the contact confirms again.',
  clientsLabel: 'Client report schedules',
  columns: {
    client: 'Client',
    contact: 'Contact',
    schedule: 'Schedule',
    nextRun: 'Next run',
    owner: 'Owner',
    actions: 'Actions',
  },
  contact: {
    none: 'no contact',
    notAsked: 'not asked to confirm yet',
    asked: (date: string) => `asked to confirm ${date}`,
    confirmed: 'confirmed',
    paused: 'paused by the recipient',
    /** The recipient answered "Don't ask me again": nothing asks that address for this client. */
    declined: 'declined: answered “Don’t ask me again”',
    /** After a contact that paused was asked again: when the next ask is possible. */
    askAgainFrom: (date: string) => `; asked again since, and can be asked again from ${date}`,
    /** In the Agency trial, a contact that is not the account owner's own address: nothing is mailed to it. */
    trial: 'asked to confirm once the trial has become the plan',
  },
  /** "Mon 9 Nov 08:00 America/Denver": the run's clock time in the schedule's own zone, and the zone. */
  nextRun: (when: string, zone: string) => `${when} ${zone}`,
  noNextRun: 'none',
  noNextRunPaused: 'none while paused',
  noNextRunDeclined: 'none: the contact declined',
  noNextRunTrial: 'none during the trial',
  change: 'Change',
  askToConfirm: 'Ask to confirm',
  askAgain: 'Ask again',
  /** For a schedule its recipient paused: posts to the resume route, which asks the contact again. */
  askAfterPause: 'Ask to confirm again',

  form: {
    /** The card's title: the client the forms change. */
    title: (client: string) => `Change ${client}`,
    clientLegend: 'The client',
    name: 'Client name',
    email: 'Contact address',
    emailPlaceholder: 'name@client.com',
    emailHint:
      'One address a client. A contact that changes is asked to confirm before a report is sent to it.',
    seat: 'Owning seat',
    noSeat: 'none',
    saveClient: 'Save the client',
    scheduleLegend: 'The schedule',
    cadence: 'How often',
    cadences: { weekly: 'Weekly', monthly: 'Monthly, on the first such weekday' },
    weekday: 'Weekday',
    weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    time: 'Time',
    zone: 'Time zone',
    zoneHint: 'The client’s own zone: the time above is on its clock.',
    unchanged: 'Send a report when nothing changed',
    saveSchedule: 'Save the schedule',
    stop: 'Stop the schedule',
  },

  sentTitle: 'Sent',
  /** How many of the reports sent the table lists: it is bounded, and says so. */
  sentSub: (shown: number, total: number) =>
    `${count(shown)} of ${count(total)} shown, the newest first`,
  sentLabel: 'Sent reports',
  sentColumns: { sent: 'Sent', client: 'Client', to: 'To', actions: 'Actions' },
  sentEmpty: 'No report has been sent to a client yet.',
  /** For a seat that covers some clients, whose records hold no report sent to another client. */
  sentEmptyInSeat: 'No report has been sent to a client in your seat yet.',
  open: 'Open',
} as const;

// ── Where the client reports screen differs from its locked HTML ─────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/agency.test.tsx). The preview reads
// challenged-site's Northwind Digital at its as_of, as the matrix and the client page do.

const NORTHWIND =
  'The fixture: Northwind Digital at its as_of, with two clients (granitepeak.example weekly, harborlight.example monthly); the artboard drew an agency of twelve that no fixture holds';
const D11 = 'CC-31 brief, D11: Branding (the agency’s domain and sender) is not in this step';
/** What the artboard draws and this step has no route for. */
const noRoute = (what: string) =>
  `CC-31 brief, workstream R §1: this step has no route for ${what}, so it is not drawn`;

export const CLIENT_REPORTS_CHANGES: CopyChange[] = [
  ...agencyRailChanges('agency-reports'),
  {
    screen: 'agency-reports',
    kind: 'fixture',
    locked: '9 weekly, 3 monthly',
    rendered: '1 weekly, 1 monthly',
    source: `${NORTHWIND}. The line is counted from the client sites the reader’s seat covers`,
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: ' · from reports@summitdigital.co',
    rendered: '',
    source: `${D11}, so the sender address is not drawn`,
  },
  {
    screen: 'agency-reports',
    kind: 'fixture',
    locked: ' · next batch Mon 2 Nov 08:00, all 12',
    rendered: '',
    source:
      'The contract’s sites[].client_report: each schedule runs at its own time in its own zone, so there is no one batch; each row gives its next run',
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: "Preview Monday's reports",
    rendered: '',
    source: noRoute('“Preview Monday’s reports”'),
  },
  {
    screen: 'agency-reports',
    kind: 'fixture',
    locked: "Going out Mon 2 Nov, 08:00 each client's time · 12",
    rendered: 'Clients · 2',
    source: `${NORTHWIND}. The table lists each client with its schedule, sent or not, so it is headed by the clients and not by one day’s batch`,
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: '9 weekly and, because Mon 2 Nov is the first Monday, the 3 monthly ones too',
    rendered:
      'A report goes to a client’s contact once the contact has confirmed. The pause link in a report stops them, and they start again only when the contact confirms again.',
    source:
      'CC-31 brief, workstream R §1: each row gives the contact’s state, so the card says what the states mean (the double opt-in and the recipient’s pause, docs/specs/v2/31-agency.md §10); the artboard’s line describes one day’s batch, which the table no longer is',
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: 'Hold all this week',
    rendered: '',
    source: noRoute('“Hold all this week”'),
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: 'Headline this week To Owner',
    rendered: 'Contact Schedule Next run Owner',
    source:
      'CC-31 brief, workstream R §1: the row’s columns are the contact and its state, the schedule in words, the next run and the owning seat. A headline is not one of them: this step has no route that edits it, and a report’s lines are its document’s own (§10, “The two mails of a schedule”)',
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: 'Preview and edit',
    rendered: '',
    source: noRoute('“Preview and edit”'),
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: 'Edit headline',
    rendered: '',
    source: noRoute('“Edit headline”'),
    all: true,
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: 'Hold',
    rendered: '',
    source: noRoute('“Hold”'),
    all: true,
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: 'Preview',
    rendered: '',
    source: noRoute('“Preview”'),
    all: true,
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: 'Expand',
    rendered: '',
    source:
      'CC-31 brief, workstream R §1: one row a client site, so no row stands for several and none expands',
    all: true,
  },
  {
    screen: 'agency-reports',
    kind: 'fixture',
    locked:
      "example-outfitter.com One new problem this week, and it's a two-line fix. opened maya@example-outfitter.com Priya holicfoods.com Product text readable by AI crawlers fell 12 points after Thursday's theme update. dropped dan@holicfoods.com Priya nahltech.com Three orphan pages are now linked; Technical SEO up to B+. resolved ud@nahltech.com Sam ridgelineoutdoors.com No change this week. Both grades held. ops@ridgelineoutdoors.com Sam 5 more weekly \"No change this week. Both grades held.\" · maplerowbakery.ca, northfieldlegal.com, harborviewdental.com, lumenstudio.design, drivepei.ca each client's contact Priya 3 · Sam 2 3 monthly October summary · redbirdaviation.com, bluebirdclinic.com, cedarpointcabins.com each client's contact Priya 2 · Sam 1",
    rendered:
      'Granite Peak Supply granitepeak.example ops@granitepeak.example confirmed weekly, Mon 08:00 their time Mon 2 Nov 08:00 America/Denver Priya (account manager) Harbor Light Studio harborlight.example hello@harborlight.example confirmed monthly, first Mon 08:00 their time Mon 2 Nov 08:00 America/Chicago Sam (account manager)',
    source: `${NORTHWIND}. Each row is a client site of the contract with its contact, its client_report and its owning seat. Whether the contact has confirmed and when the schedule runs next are not in the contract: the preview states them (_preview/agency-reports.ts)`,
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked:
      "Headlines are written from the check and you can change them until 08:00. Reports with no change still go, so clients see you looked; turn that off per client if they'd rather not.",
    rendered: '',
    source: `${noRoute('“Edit headline”')}. Whether a report goes when nothing changed is each schedule’s own box in its form (report_schedules.send_when_unchanged)`,
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked:
      'Last 30 days, 3 of 9 shown · "Opened" comes from a tracking pixel that is off by default; it is on for Example Outfitter and Nahl, who agreed to it',
    rendered: '1 of 1 shown, the newest first',
    source: `${noRoute('the Opened column (open tracking)')}. The line counts the fixture’s client reports that were sent`,
  },
  {
    screen: 'agency-reports',
    kind: 'ruling',
    locked: 'Opened Fix marked done after',
    rendered: 'To',
    source: `${noRoute('the Opened column and “Fix marked done after”')}. The row says who the report went to`,
  },
  {
    screen: 'agency-reports',
    kind: 'fixture',
    locked:
      'Mon 26 Oct 08:00 example-outfitter.com Mon 09:14 by maya@ — Mon 26 Oct 08:00 nahltech.com Mon 08:31 orphans, Wed Mon 26 Oct 08:00 holicfoods.com tracking off —',
    rendered: 'Mon 26 Oct 10:00 granitepeak.example ops@granitepeak.example',
    source: `${NORTHWIND}. The fixture’s client report that was sent, at its sent_at in the account’s zone, with its recipient_email. It is a PDF, which has no page to open; a report a schedule writes is a document, and its row has Open`,
  },
];

export const CLIENT_REPORTS_ADDITIONS: Addition[] = [
  {
    screen: 'agency-reports',
    what: 'For a seat that may schedule reports: each row’s “Change”, “Ask to confirm” or “Ask again” while the contact has not confirmed, and “Ask to confirm again” while the recipient has paused. In the Agency trial a contact that is not the owner’s own address has neither ask, and its row says it is asked once the trial has become the plan',
    source:
      'CC-31 D8; brief, workstream R §1; owner ruling of 2026-11-12: a schedule its recipient paused starts again only when the contact confirms again',
  },
  {
    screen: 'agency-reports',
    what: 'The card a row’s “Change” opens: the client’s name, contact address and owning seat; the schedule (how often, weekday, time, time zone, whether to send when nothing changed); and “Stop the schedule”',
    source: 'CC-31 D8: “Client report schedules: stored and editable here”',
  },
  {
    screen: 'agency-reports',
    what: 'The header’s “Schedule a report for <host>”, while a client has no schedule; and, on an account in its Agency trial, one line saying where a report is sent during the trial',
    source:
      'CC-31 brief, workstream R §1; docs/specs/v2/31-agency.md §10, “Sending”: the trial rule, third in its list',
  },
  {
    screen: 'agency-reports',
    what: 'An “Open” link on a sent report whose document is stored, to its page at /reports/<id>',
    source: 'CC-31 brief, workstream R §1; docs/specs/v2/31-agency.md §9, “The proof page”',
  },
  {
    screen: 'agency-reports',
    what: 'Below Agency the page is the gate, and for a reader acting in another account the switch, as /agency shows them',
    source: 'CC-31 questions.md Q8 and Q12',
  },
];
