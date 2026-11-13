/**
 * Reports and exports' written sentences (Final-Reports): every number a parameter. The lock
 * corrections for the artboard follow.
 */
import type { Report } from '@crawlmouse/types/v2';
import type { Addition, CopyChange } from '../copy-registry';
import { gateMessage } from '../agency/gates';
import { count, plural } from '../words';
import { railChanges } from './dashboard';

/** A share link to a report file works this long (FACTS: "share links to report files expire at 30 days"). */
export const SHARE_LINK_DAYS = 30;

/** Each report as the list names it, by kind and, for a raw export, its format. */
export const REPORT_TYPES: Record<Exclude<Report['kind'], 'raw_export'>, string> = {
  audit_pdf: 'PDF audit report',
  compare: 'Compare',
  public_link: 'Public audit link',
  client_report: 'Client report',
  prospect_one_pager: 'Prospect one-pager',
};
export const RAW_TYPES: Record<Report['format'], string> = {
  csv: 'CSV, all responses',
  json: 'JSON, all responses',
  edge_list: 'Link map, edge list',
  pdf: 'PDF',
  html: 'HTML',
};

/** The raw-data buttons, in the artboard's order. */
export const RAW_FORMATS = [
  { format: 'csv', label: 'CSV' },
  { format: 'json', label: 'JSON' },
  { format: 'edge_list', label: 'Link map' },
] as const;

export const REPORTS_COPY = {
  title: 'Reports and exports',
  sites: (n: number) => `${count(n)} ${plural(n, 'site', 'sites')}`,
  /**
   * For a reader whose seat covers some clients, whose records hold those clients' sites and
   * reports and no others: a count or an absence read from them is said of the seat's sites.
   */
  sitesInSeat: (n: number) => `${count(n)} ${plural(n, 'site', 'sites')} in your seat`,
  ofSeat: (line: string) => `${line} for the sites in your seat`,
  madeEmptyInSeat: 'No reports yet for the sites in your seat.',
  noSitesInSeat: 'No site is in your seat yet: reports are made from a site’s checks.',
  exportsOn: (plan: string) => `exports and PDF on ${plan}`,
  exportsAre: (plan: string) => `exports and PDF are ${plan}`,
  daysLeft: (n: number, plan: string) => `${count(n)} ${plural(n, 'day', 'days')} of ${plan} left`,
  makeTitle: 'Make a report',
  makeSub: (host: string, latest: string) => `For ${host}, latest check ${latest}`,
  makeNoCheck: (host: string) => `For ${host}, which has no finished check yet`,
  noSites: 'No sites yet: reports are made from a site’s checks.',
  siteLabel: 'Site',
  show: 'Show',
  pdfTitle: 'PDF audit report',
  pdfBody: 'Grades, crawler table, every open fix, the link map’s figures.',
  makePdf: 'Make the PDF',
  compareTitle: 'Compare two checks',
  comparePair: (a: string, b: string) => `${a} vs ${b}.`,
  compareBody: 'What moved and why, with the evidence for each change.',
  compareNeedsTwo: 'Needs two finished checks of this site.',
  makeCompare: 'Compare these two',
  statusWords: { scheduled: 'scheduled', held: 'held back' },
  rawTitle: 'Raw data',
  rawBody: 'Every response as CSV, JSON or the link map as an edge list.',
  comparePlans: 'Compare plans',
  madeTitle: 'Reports made',
  madeSub: (days: number) =>
    `Kept with the account; a share link to one expires after ${days} days`,
  madeEmpty: 'No reports yet.',
  firstAudit: 'first audit',
  checkOf: (date: string) => `check of ${date}`,
  vs: (a: string, b: string) => `${a} vs ${b}`,
  /** A report over more than two checks: how many, first to last. */
  span: (n: number, first: string, last: string) => `${count(n)} checks, ${first} to ${last}`,
  madeByCheck: (cadence: string) => `made by the ${cadence} check`,
  sentTo: (email: string) => `sent to ${email}`,
  download: (size: string) => `Download · ${size}`,
  /** A stored file whose size was not recorded. */
  downloadFile: 'Download',
  open: 'Open',
  /** Makes the report's first share link. */
  makeLink: 'Link',
  /** What a row says of a link that works: text, not a control. */
  link: (until: string) => `Link · until ${until}`,
  /** Replaces a link that works: the one before stops opening. */
  newLink: 'New link',
  withdrawLink: 'Withdraw link',
  /** Beside a link just made, which the page shows while the share form's cookie lasts. */
  madeLink: 'The link, shown here for a short while:',
  /** What a row says of a report whose file is not stored; a stored one says nothing. */
  fileStates: { pending: 'Being made', failed: 'Could not be made', stored: null } as Record<
    'pending' | 'failed' | 'stored',
    string | null
  >,
  madeFoot: (days: number, plan: string) =>
    `Files stay here; a share link to one works for ${days} days and needs no account to open. Making new reports and raw-data exports is ${plan}; what is listed here stays downloadable. The public audit link on each site page is free.`,
  scheduledTitle: 'Scheduled',
  none: 'None',
  toSend: (n: number) => `${count(n)} ${plural(n, 'report', 'reports')} to send`,
  /** On Agency. */
  scheduledAgency: 'Client reports are sent for you weekly or monthly, to each client’s contact.',
  table: { made: 'Reports', scheduled: 'Scheduled reports' },
  columns: {
    made: 'Made',
    site: 'Site',
    type: 'Type',
    covers: 'Covers',
    actions: 'Actions',
    when: 'When',
    to: 'To',
    status: 'Status',
  },
};

// ── Where Reports differs from its locked HTML ───────────────────────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/reports.test.tsx).

const ZONE =
  'FACTS D4 and Q4 (owner ruling): dates and times in the account’s zone, America/Indiana/Indianapolis; the locked page wrote them in UTC';

export const REPORTS_CHANGES: CopyChange[] = [
  ...railChanges('reports'),
  {
    screen: 'reports',
    kind: 'facts',
    locked: '9 days of Pro left',
    rendered: '8 days of Pro left',
    source:
      'FACTS D4 and Q4 (owner ruling): calendar days in the account’s zone, Fri 30 Oct to Sat 7 Nov',
  },
  {
    screen: 'reports',
    kind: 'fixture',
    locked: 'latest check Fri 30 Oct 06:00',
    rendered: 'latest check Fri 30 Oct 06:02',
    source: 'The fixture’s weekly check finished at 10:02Z, 06:02 in the account’s zone',
  },
  {
    screen: 'reports',
    kind: 'fixture',
    locked: ' 6–9 pages.',
    rendered: '',
    source: 'The fixture records no PDF’s page count: the length is not in fixture (D2)',
  },
  {
    screen: 'reports',
    kind: 'ruling',
    locked: ' Under your own name and domain on Agency.',
    rendered: '',
    source:
      'CC-31 brief, D11: Branding (the agency’s name, domain and sender) is not in this step, and the PDF the step makes carries none of them',
  },
  {
    screen: 'reports',
    kind: 'ruling',
    locked: 'every open fix, link map.',
    rendered: 'every open fix, the link map’s figures.',
    source:
      'CC-31 brief, D6: the PDF is made from the audit’s own views (auditDoc, lib/v2/reports/generate-doc.ts), which hold the structure page’s figures and no drawing of the map',
  },
  {
    screen: 'reports',
    kind: 'ruling',
    locked: 'Choose checks',
    rendered: 'Compare these two',
    source:
      'Owner ruling 6: no route chooses the two checks of a compare (a CC-27b candidate), so the card makes the compare of the latest pair it names',
  },
  {
    screen: 'reports',
    kind: 'ruling',
    locked: 'Thu 29 vs Fri 30 Oct, or any two.',
    rendered: 'Thu 29 vs Fri 30 Oct.',
    source:
      'Owner ruling 6: no route chooses the two checks of a compare (“Choose checks” is a CC-27b candidate), so the card offers only the latest pair',
  },
  {
    screen: 'reports',
    kind: 'fixture',
    locked: ' 1,284 rows for example-outfitter.com.',
    rendered: '',
    source:
      'The fixture’s latest check holds 0 page results and 2 of 308 access tests (306 withheld): no count it holds is the export’s rows, so the count is not in fixture (D2, D5); 1,284 is the 6 × 214 formula FACTS I1 withdraws',
  },
  {
    screen: 'reports',
    kind: 'fixture',
    locked: 'nahltech.com Compare',
    rendered: 'example-outfitter.com Compare',
    source: 'The fixture’s compare (report 2) is of example-outfitter.com',
  },
  {
    screen: 'reports',
    kind: 'facts',
    locked: '25 Oct vs Thu 29 Oct',
    rendered: 'Sat 24 Oct vs Thu 29 Oct',
    source: `${ZONE}: the first audit finished 25 Oct 02:34Z, Sat 24 Oct 22:34 there`,
  },
  {
    screen: 'reports',
    kind: 'fixture',
    locked: 'Download · 310 KB',
    rendered: 'Link · until Tue 24 Nov Download · 310 KB New link Withdraw link',
    source:
      'The fixture’s CSV (report 3) has a share link until 24 Nov 07:10Z, Tue 24 Nov in the account’s zone (D5: the expiry from share_expires_at); CC-31 D7: a link can be replaced and withdrawn, so a report with one says until when it works and offers both',
  },
  {
    screen: 'reports',
    kind: 'ruling',
    locked:
      'Scheduled client reports, sent for you weekly or monthly from your own address, are an Agency feature.',
    rendered: gateMessage('clientReports', 'pro')!,
    source:
      'CC-31 brief, D10: a gate’s line is written once, from GATES and prices.ts (lib/v2/agency/gates.ts); D11: sending from the agency’s own address is Branding, which the step does not build',
  },
];

export const REPORTS_ADDITIONS: Addition[] = [
  {
    screen: 'reports',
    what: 'A Show button beside the site picker: the picker reloads the card for another site without changing the page on input (WCAG 3.2.2)',
    source: 'CC-27 plan, approved; the artboard draws the picker alone',
  },
];
