/**
 * The agency workspace's written sentences (CC-31): the parts no record holds, every number a
 * parameter, so the view models fill them from the data, `GATES` and `prices.ts`
 * (OPERATING-RULES §10). The lock corrections for the agency artboards follow.
 */
import type { Addition, CopyChange, LockedScreen } from '../copy-registry';
import { count, plural } from '../words';

/** The agency rail's plan card and the account switcher (the switcher is outside the artboards). */
export const AGENCY_RAIL_COPY = {
  /** "Agency · $99 a month": the price is prices.ts's, already formatted. */
  planPrice: (plan: string, price: string, period: 'month' | 'year') =>
    `${plan} · ${price} a ${period}`,
  planKeeps: (sites: number, seats: number) =>
    `${count(sites)} client ${plural(sites, 'site', 'sites')} · ${count(seats)} ${plural(seats, 'seat', 'seats')}`,
  renews: (date: string, last4: string) => `Renews ${date}. Card ending ${last4}.`,
  /** Read before the account's name by a screen reader. */
  acting: 'Account',
  switchTo: 'Switch to',
  switchToAccount: (name: string) => `Switch to ${name}`,
  /** On a page of an account the reader is not acting in. */
  actingIn: (name: string) => `You are acting in ${name}.`,
};

/** The client matrix (Final-Ag-Matrix) and the states the artboard does not draw. */
export const MATRIX_COPY = {
  title: 'Clients',
  /** Each row compares its site's two latest results: the clients' checks share no one day. */
  sinceTitle: 'Since each client’s last check',
  clientSites: (n: number) => `${count(n)} client ${plural(n, 'site', 'sites')}`,
  unused: (unused: number, limit: number) => `${count(unused)} of ${count(limit)} unused`,
  inYourSeat: 'in your seat',
  nextWeekly: (at: string) => `next weekly check ${at}`,
  add: (n: number, limit: number) => `Add a client site · ${count(n)} of ${count(limit)}`,
  /** At the plan's site limit, for a reader who may buy: the way to the buy form on Seats. */
  buySites: 'Add sites to the plan',
  addField: { label: 'Client site address', placeholder: 'example.com' },
  strip: {
    label: 'Since each client’s last check',
    calls: 'Clients needing a call',
    compared: (n: number) => `of ${count(n)} compared`,
    opened: 'Opened',
    resolved: 'Resolved',
    at: (names: string) => `at ${names}`,
  },
  tableTitle: (n: number) => `Clients · ${count(n)}`,
  tableLabel: 'Client matrix',
  /** The locked sentence, its count from the data; `scoped` for a seat that covers some clients. */
  tableSub: (n: number, scoped: boolean) =>
    n === 1
      ? `The one client site${scoped ? ' your seat covers' : ''}, both grades, what changed. Select the site to open it.`
      : `${scoped ? `The ${count(n)} client sites your seat covers` : `All ${count(n)} client sites`}, both grades, what changed. Sites with a new problem first; select a site to open it.`,
  columns: {
    site: 'Site',
    client: 'Client',
    seo: 'Technical SEO',
    ai: 'AI readability',
    since: 'Since last check',
    next: 'Next check',
    last: 'Last check',
    schedule: 'Schedule · report',
  },
  noClientName: '—',
  noNextCheck: 'none scheduled',
  report: (cadence: string, weekday: string) =>
    cadence === 'monthly' ? `report monthly, first ${weekday}` : `report ${cadence}, ${weekday}`,
  noReport: 'no report',
  runFirst: 'Run the first check',
  /** Setup, one step at a time: each is the page's one next step while it is the first not done. */
  steps: {
    addTitle: 'Add your first client',
    addBody: 'Enter a client’s site. Its first check starts at once, and the site joins this list.',
    noClientsInSeat:
      'No client site is in your seat yet. The account’s owner chooses which clients a seat covers.',
    checkTitle: (host: string) => `Run the first check of ${host}`,
    checkBody: 'It has not been checked yet. The first check grades the site and lists its fixes.',
    checkAction: 'Run it now',
    inviteTitle: 'Invite a colleague',
    inviteBody: (seats: number) =>
      `You are the only person on this account, which has ${count(seats)} ${plural(seats, 'seat', 'seats')}. Give one to an account manager or a developer, for every client or for some.`,
    inviteAction: 'Open Seats',
    reportTitle: 'Send the first report',
    reportBody:
      'No report has gone to a client yet. Choose a client, its contact and how often the report is sent.',
    reportAction: 'Open client reports',
  },
  /** Where the account acted in is not on Agency. */
  gateAction: 'Compare plans',
  openTitle: 'Your clients are in another account',
  openBody: (acting: string) =>
    `You are acting in ${acting}, which has no client workspace. Open the agency to see its clients.`,
  open: (name: string) => `Open ${name}`,
};

/** One client (Final-Ag-Client). The grades, moves, fix titles and effects are the site page's. */
export const CLIENT_COPY = {
  gradesTitle: 'Grades today',
  sitePage: 'Site page, all checks',
  fixesTitle: (n: number) => `Open fixes · ${count(n)} to raise`,
  fixesLabel: 'Open fixes',
  fixColumns: { number: 'No.', fix: 'Fix', effect: 'Effect', packet: 'Packet' },
  more: (n: number) => `${count(n)} more on the site page`,
  noFixes: 'Nothing is open to raise with this client.',
  clientTitle: 'This client',
  clientLabel: 'Client settings',
  clientColumns: { setting: 'Setting', value: 'Value', change: 'Change' },
  contact: 'Contact',
  report: 'Report',
  seatLabel: 'Seat',
  change: 'Change',
  none: 'none',
  noReport: 'not scheduled',
  /** "weekly, Mon 08:00 their time": the clock is the client's zone, as the schedule stores it. */
  reportWhen: (cadence: string, weekday: string, time: string) =>
    cadence === 'monthly'
      ? `monthly, first ${weekday} ${time} their time`
      : `${cadence}, ${weekday} ${time} their time`,
  pausedByRecipient: 'paused by the recipient',
  seat: (name: string, role: string) => `${name} (${role})`,
  roles: { owner: 'owner', account_manager: 'account manager', developer: 'developer' },
  /** The client has an owning seat that the reader's seat is not shown. */
  seatNotListed: 'a seat yours is not shown',
};

// ── Where the agency screens differ from their locked HTML ───────────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/agency.test.tsx). The previews read
// challenged-site's Northwind Digital at its as_of (Mon 2 Nov, the account's zone), the contract's
// one agency with results; the artboards drew a twelve-client agency no fixture holds.

const NORTHWIND =
  'The fixture: Northwind Digital at its as_of, Mon 2 Nov in the account’s zone, with two clients (granitepeak.example and harborlight.example); the artboard drew an agency of twelve that no fixture holds';
const D11 = 'CC-31 brief, D11: Branding (the agency’s domain and sender) is not in this step';

/** The agency rail's plan card, which the matrix and the client page share. */
function agencyRailChanges(screen: LockedScreen): CopyChange[] {
  return [
    {
      screen,
      kind: 'ruling',
      locked: 'Agency · $69 a month',
      rendered: 'Agency · $99 a month',
      source:
        'Owner ruling of 2026-11-03: the Agency list price is $99 (lib/billing/prices.ts AGENCY_MONTHLY)',
    },
    {
      screen,
      kind: 'fixture',
      locked: '12 clients · 5 seats',
      rendered: '25 client sites · 5 seats',
      source:
        'The contract’s accounts[].limits: what the plan keeps, the same for every seat that reads the card. The clients a seat covers are counted on the rail’s Clients link',
    },
    {
      screen,
      kind: 'fixture',
      locked: 'Renews 1 Nov. Card ending 4242.',
      rendered: 'Billing',
      source:
        'The fixture: Northwind’s invoice failed on 1 Nov (state past_due), so the card promises no renewal. The locked card is itself a link to billing; here the link is the word, as on the trial card',
    },
  ];
}

export const MATRIX_CHANGES: CopyChange[] = [
  ...agencyRailChanges('agency-matrix'),
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked: "Since last week's checks",
    rendered: 'Since each client’s last check',
    source:
      'The contract’s sites[].schedule: the clients’ checks share no one day or cadence, so each row compares its site’s two latest results',
  },
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked: 'Fri 30 Oct · 12 client sites, 13 of 25 unused · next weekly check Fri 6 Nov 06:00',
    rendered:
      'Mon 2 Nov · 2 client sites, 23 of 25 unused · next weekly check Fri 6 Nov around 06:00',
    source: `${NORTHWIND}. FACTS H4: a scheduled check runs "around" its hour`,
  },
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked: 'Add a client site · 12 of 25',
    rendered: 'Add a client site · 2 of 25',
    source: NORTHWIND,
  },
  {
    screen: 'agency-matrix',
    kind: 'ruling',
    locked: 'Audit a prospect',
    rendered: '',
    source:
      'CC-31 brief, workstream C §2: the prospect one-pager is workstream B’s; the matrix is built without its button, and "Add a client site" is the page’s orange element',
  },
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked: 'Clients needing a call 2 example-outfitter, holicfoods',
    rendered: 'Clients needing a call 1 granitepeak.example · of 2 compared',
    source: `${NORTHWIND}. The cell names each client with a problem opened since its previous check, and how many clients had two results to compare`,
  },
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked: 'Opened 2 1 crawler blocked, 1 text drop',
    rendered: 'Opened 1 at granitepeak.example',
    source: `${NORTHWIND}. The count is the rows’ own, and the cell names the clients it is at`,
  },
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked: 'Resolved 3 orphans, nahltech',
    rendered: '',
    source: `${NORTHWIND}: nothing was resolved, and a count of nothing has no cell`,
  },
  {
    screen: 'agency-matrix',
    kind: 'ruling',
    locked: 'Reports going out Mon 12 Preview',
    rendered: '',
    source:
      'CC-31 brief, workstream C §2: client report schedules and their preview are workstream B2’s (/agency/reports)',
  },
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked: 'Clients · 12',
    rendered: 'Clients · 2',
    source: NORTHWIND,
  },
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked: 'All 12 client sites',
    rendered: 'All 2 client sites',
    source: NORTHWIND,
  },
  {
    screen: 'agency-matrix',
    kind: 'ruling',
    locked: 'Filter',
    rendered: '',
    source: 'CC-31 brief, workstream C §2: no filter is built in this step',
  },
  {
    screen: 'agency-matrix',
    kind: 'ruling',
    locked: 'Export matrix',
    rendered: '',
    source: 'CC-31 brief, workstream C §2: no export of the matrix is built in this step',
  },
  {
    screen: 'agency-matrix',
    kind: 'facts',
    locked: 'AI visibility',
    rendered: 'AI readability',
    source: 'FACTS A1',
  },
  {
    screen: 'agency-matrix',
    kind: 'fixture',
    locked:
      'example-outfitter.com Example Outfitter B 79 F 22 1 blocked Fri 06:00 weekly, report Mon holicfoods.com Holic Foods C+ 68 D 44 text −12 Fri 06:00 weekly, report Mon nahltech.com Nahl Technologies B+ 84 A 93 3 resolved Fri 06:00 weekly, report Mon ridgelineoutdoors.com Ridgeline Outdoors B- 72 C 61 no change Fri 06:00 weekly, report Mon redbirdaviation.com Redbird Aviation B- 74 B 78 no change Fri 06:00 monthly, first Mon drivepei.ca Drive PEI B- 73 C 66 no change Fri 06:00 weekly, report Mon bluebirdclinic.com Bluebird Clinic A- 90 B+ 83 no change Fri 06:00 monthly, first Mon maplerowbakery.ca Maple Row Bakery B 77 B- 72 no change Fri 06:00 weekly, report Mon northfieldlegal.com Northfield Legal A- 88 B 80 no change Fri 06:00 weekly, report Mon harborviewdental.com Harborview Dental B+ 83 B+ 84 no change Fri 06:00 weekly, report Mon cedarpointcabins.com Cedar Point Cabins C+ 69 C 64 no change Fri 06:00 monthly, first Mon lumenstudio.design Lumen Studio A 91 A- 89 no change Fri 06:00 weekly, report Mon',
    rendered:
      'granitepeak.example Granite Peak Supply C+ 66 withheld 1 opened Wed 15:13 · latest check failed · check deferred weekly, Fri · report weekly, Mon harborlight.example Harbor Light Studio A 91 A- 89 no change Fri 06:01 weekly, Fri · report monthly, first Mon',
    source: `${NORTHWIND}. Each row is the dashboard’s own site row; the last column gives the check’s schedule, then the report’s`,
  },
];

export const MATRIX_ADDITIONS: Addition[] = [
  {
    screen: 'agency-matrix',
    what: 'A "Next check" column: when each client’s next scheduled check runs, or "none scheduled"',
    source: 'CC-31 brief, workstream C §2 (the row’s fields)',
  },
  {
    screen: 'agency-matrix',
    what: 'Setup’s one next step, as a card above the list: run a first check, invite a colleague, send the first report; and, with no client yet, the header and the card ask for the first one',
    source: 'CC-31 D5: the first-run states guide setup in order, one step at a time',
  },
  {
    screen: 'agency-matrix',
    what: 'A client with no result yet: "Not checked yet" or what its first check is doing, with one button to start or watch it',
    source: 'CC-31 D5',
  },
  {
    screen: 'agency-matrix',
    what: 'Two states of the page that are not the matrix: the gate for an account below Agency, and "Open <agency>" for a reader acting in another account',
    source: 'CC-31 questions.md Q8 and Q12',
  },
];

export const CLIENT_CHANGES: CopyChange[] = [
  ...agencyRailChanges('agency-client'),
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked:
      'What to tell Example Outfitter this week Their robots.txt changed Thursday evening and now blocks ClaudeBot on every page; AI visibility fell from D to F overnight. It is two lines to delete and the packet is ready. The Cloudflare rule and the product template from the first audit are still open. Nothing else moved.',
    rendered: '',
    source:
      'CC-31 brief, workstream C §2, and OPERATING-RULES §10: a paragraph about measured data is rendered from the data or left out; no view renders these sentences, so the card is left out',
  },
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked: 'Email the robots.txt fix to Maya',
    rendered: '',
    source:
      'CC-31 brief, workstream C §2: the card it sat in is left out; a fix is emailed to a developer from its own page (CC-26b)',
  },
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked: "Preview Monday's report",
    rendered: '',
    source: 'CC-31 brief, workstream C §2: client reports and their preview are workstream B2’s',
  },
  {
    screen: 'agency-client',
    kind: 'fixture',
    locked:
      'Example Outfitter example-outfitter.com · Fri 30 Oct · last check today 06:00 · report goes Mon 2 Nov 08:00 Run a check now',
    rendered:
      'Granite Peak Supply granitepeak.example · Mon 2 Nov · last check Wed 15:13 · latest check failed · check deferred · next Fri 6 Nov around 06:00 · 96 pages · 2 fixes Open the latest audit Run a check now Open the OAI-SearchBot, ChatGPT-User, PerplexityBot and Claude-SearchBot packet · AI not yet estimated',
    source: `${NORTHWIND}; the client is granitepeak.example. The line and the actions are the site page’s own (Final-Site), after the host; when the next report goes is on the report schedule, workstream B2’s`,
  },
  {
    screen: 'agency-client',
    kind: 'fixture',
    locked:
      'example-outfitter.com · competitors summitgear.co, trailhead.store, basecampco.com · six checks since 25 Oct on the site page',
    rendered: '24 Oct the first audit, 28 Oct run by you',
    source:
      'The fixture’s checks of granitepeak.example, as the site page’s grades card lists them',
  },
  {
    screen: 'agency-client',
    kind: 'fixture',
    locked: 'Technical SEO B 79 · −1 since Thu AI visibility F 22 · −19 since Thu',
    rendered:
      'Technical SEO C+ 66 · −1 since Sat AI readability – withheld The site’s edge blocks all automation, so only one of the four scored crawlers could be measured. Access is somewhere between 0 and 30 of 40.',
    source:
      'The fixture’s grades of granitepeak.example, whose AI readability is withheld (FACTS I4: the reason is said with it); FACTS A1 names the grade AI readability',
  },
  {
    screen: 'agency-client',
    kind: 'fixture',
    locked:
      'Open fixes · 4 to raise 0 Remove the ClaudeBot block from robots.txt new +19 AI Packet 1 Let GPTBot and PerplexityBot through Cloudflare +24 AI Packet 2 Server-render the product template +22 AI Packet 3 Link the 7 orphan pages +4 SEO Packet',
    rendered:
      "Open fixes · 1 to raise 1 Let AI crawlers past the edge's automation challenge AI not yet estimated Packet",
    source:
      'The fixture’s fixes of granitepeak.example still to do: fix 1, which a check could not verify (fix 2 is marked done)',
  },
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked: "Packets are addressed to the client's developer and carry your name, not ours.",
    rendered: '',
    source: D11,
  },
  {
    screen: 'agency-client',
    kind: 'fixture',
    locked: '11 more on the site page',
    rendered: '',
    source: 'The fixture: granitepeak.example has no fix beyond those listed',
  },
  {
    screen: 'agency-client',
    kind: 'fixture',
    locked: 'Contact maya@example-outfitter.com',
    rendered: 'Contact Jordan · ops@granitepeak.example',
    source: 'The fixture’s client_contact_name and client_contact_email of granitepeak.example',
  },
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked: 'weekly, Mon 08:00 their time · PDF from reports@ summitdigital.co',
    rendered: 'weekly, Mon 08:00 their time',
    source: D11,
  },
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked: 'Client portal audits.summitdigital.co /example-outfitter Open',
    rendered: '',
    source: D11,
  },
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked: 'Priya (account manager) · alerts to her and #clients-outfitter',
    rendered: 'Priya (account manager)',
    source:
      'CC-31 brief, workstream C §2: the row names the owning seat; a seat’s alert channels are edited on Seats (workstream A) and a site’s Slack channel on Alerts (CC-28)',
  },
];

export const CLIENT_ADDITIONS: Addition[] = [
  {
    screen: 'agency-client',
    what: 'A client whose first check has not ended with a result is shown as its site page shows it (the first-check screen), on the agency rail',
    source: 'CC-31 D5; CC-26b D8',
  },
];
