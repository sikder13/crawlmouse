/**
 * The Seats screen's words (Final-Ag-Seats) and the invitation page's. Counts, prices and limits are
 * not here: the view reads them from the account's rows, `GATES` and `prices.ts`.
 */
import type { SeatRole } from '@crawlmouse/types/v2';
import { EXTRA_SEAT, usd } from '../../billing/prices';
import type { SeatAction } from '../agency/guard';
import type { Addition, CopyChange } from '../copy-registry';
import { agencyRailChanges } from './agency';

export const SEATS_COPY = {
  title: 'Seats',
  invite: 'Invite someone',
  people: 'People',
  peopleSub: 'Who sees which clients and who gets which alerts',
  tables: { seats: 'Seats', roles: 'Roles' },
  columns: {
    person: 'Person',
    role: 'Role',
    clients: 'Clients',
    alerts: 'Alerts',
    actions: 'Actions',
    can: 'Can',
  },
  /** For a reader whose seat covers some clients: row security shows them two seats, not the count. */
  partialLine:
    'Your seat and the owner’s. A seat that covers some clients is not shown the others.',
  you: 'You',
  /** A seat's role as the People table writes it. */
  roleLine: {
    owner: 'Owner · billing, branding, seats',
    account_manager: 'Account manager',
    developer: 'Developer · packets only, no client email',
  } satisfies Record<SeatRole, string>,
  roleName: {
    owner: 'Owner',
    account_manager: 'Account manager',
    developer: 'Developer',
  } satisfies Record<SeatRole, string>,
  /** In the header's line, after a count: "2 account managers". */
  rolePlural: {
    owner: ['owner', 'owners'],
    account_manager: ['account manager', 'account managers'],
    developer: ['developer', 'developers'],
  } satisfies Record<SeatRole, readonly [string, string]>,
  channel: { email: 'email', slack: 'Slack' },
  noAlerts: 'none',
  invited: 'Invited, not yet accepted',
  change: 'Change',
  rolesTitle: 'What each role can do',
  yes: 'yes',
  no: 'no',
  /**
   * What an invitation is, under the People table: the `seat_invite` mail, whose one link is the
   * invitation's. `days` is how long that link works, in words.
   */
  mailNote: (days: string) =>
    `An invitation is one email with a link to accept it. The link works for ${days} days.`,
  /** The Clients cell of a seat that covers no live client. */
  noClients: 'none',
  /** Ends the foot's price in an Agency trial, where extras cannot be bought yet. */
  onceTrialEnds: ', once the trial has become the plan',
  form: {
    title: 'Invite someone',
    email: 'Their email address',
    emailPlaceholder: 'name@company.com',
    role: 'Role',
    scope: 'Clients',
    everyClient: 'Every client',
    someClients: 'Only the clients ticked',
    send: 'Send the invitation',
    save: 'Save',
    remove: 'Remove from the account',
    resend: 'Send a new invitation',
  },
  buy: {
    title: 'Seats and sites beyond the plan',
    seats: 'Extra seats',
    sites: 'Extra sites',
    submit: 'Change the plan',
  },
} as const;

/**
 * The rows of "What each role can do", as the locked screen words them, each with the Guard action
 * that answers it (`SEAT_GUARD`, lib/v2/agency/guard.ts). A row with no action is what a seat does
 * on the sites it covers, whatever its role: `is_member_for_site` alone decides it (spec 31 §3).
 */
export const ROLE_ROWS: readonly { can: string; action: SeatAction | null }[] = [
  { can: 'See audits and packets', action: null },
  { can: 'Mark fixes done, run checks', action: null },
  { can: 'Edit and send client reports', action: 'schedule_report' },
  { can: 'Add or remove client sites', action: 'remove_site' },
  { can: 'Branding, seats, billing', action: 'invite_seat' },
];

export const INVITE_COPY = {
  title: 'You are invited',
  /** With the account's name, or without when it has none. */
  to: (account: string | null) =>
    account ? `to ${account} on Crawlmouse` : 'to an account on Crawlmouse',
  role: {
    account_manager:
      'As an account manager you see audits and packets, run checks, and edit and send client reports.',
    developer: 'As a developer you see audits and packets, mark fixes done and run checks.',
  },
  everyClient: 'The seat covers every client of the account.',
  someClients: 'The seat covers the clients the account’s owner chose.',
  accept: 'Accept the invitation',
  signIn: 'Sign in to accept',
  signInNote:
    'Sign in with the address the invitation was sent to. This page opens again afterwards.',
  goneTitle: 'This invitation cannot be used',
  gone: 'It was accepted, replaced by a newer one, removed, or it has expired. The account’s owner can send another.',
  /** The page's cookie holds no token: it ran out, or the link was opened in another browser. */
  noLinkTitle: 'This page holds no invitation',
  noLink:
    'A page keeps an invitation for a short while after its link is opened, in the browser that opened it. Open the link in the invitation email again.',
} as const;

// ── Where Seats differs from its locked HTML ─────────────────────────────────────────────────
// Applied in order by the lock comparison (__tests__/v2/seats.test.tsx). The preview reads
// challenged-site's Northwind Digital, the contract's one agency; the artboard drew an agency of
// twelve clients that no fixture holds.

const NORTHWIND_SEATS =
  'The fixture: Northwind Digital, whose four seats are Alex (owner), Priya and Sam (account managers, one client each) and Lee (developer), with two clients; the artboard drew an agency of twelve';

export const SEATS_CHANGES: CopyChange[] = [
  ...agencyRailChanges('agency-seats'),
  {
    screen: 'agency-seats',
    kind: 'fixture',
    locked: '@summitdigital.co',
    rendered: '@northwind-digital.example',
    all: true,
    source: NORTHWIND_SEATS,
  },
  {
    screen: 'agency-seats',
    kind: 'fixture',
    locked: 'all 12',
    rendered: 'all 2',
    all: true,
    source: NORTHWIND_SEATS,
  },
  {
    screen: 'agency-seats',
    kind: 'fixture',
    locked: '7 · example-outfitter, holicfoods, …',
    rendered: '1 · granitepeak.example',
    source: `${NORTHWIND_SEATS}. A seat that covers some clients names them, up to two, and then an ellipsis`,
  },
  {
    screen: 'agency-seats',
    kind: 'fixture',
    locked: '5 · nahltech, ridgelineoutdoors, …',
    rendered: '1 · harborlight.example',
    source: NORTHWIND_SEATS,
  },
  {
    screen: 'agency-seats',
    kind: 'ruling',
    locked: '$9 a seat a month',
    rendered: `${usd(EXTRA_SEAT)} a seat a month`,
    source:
      'CC-31 brief, D10: a price is read from prices.ts, where a seat beyond the plan’s is EXTRA_SEAT',
  },
];

export const SEATS_ADDITIONS: Addition[] = [
  {
    screen: 'agency-seats',
    what: 'Under the People table: "An invitation is one email with a link to accept it. The link works for seven days."',
    source:
      'FACTS (ARCH-2 q12, as corrected in CC-31): what an invited person receives. The invitation is its own mail (seat_invite) with one link, which works for INVITE_LINK_DAYS days',
  },
  {
    screen: 'agency-seats',
    what: 'An "Invited" pill on a seat whose invitation is not yet accepted',
    source: 'CC-31 D3: an invited seat holds its place until the invitation is accepted or expires',
  },
  {
    screen: 'agency-seats',
    what: 'The invite form (address, role, the clients the seat covers), which "Invite someone" links to, and each row’s Change form',
    source: 'CC-31 D3; the artboard draws the buttons and no form',
  },
  {
    screen: 'agency-seats',
    what: 'The buy form: seats and sites beyond the plan’s, for the owner where they are sold',
    source: 'CC-31 D4',
  },
  {
    screen: 'agency-seats',
    what: 'The line a form’s answer sends back (a notice)',
    source: 'CC-31 D3 and D4: each form answers on the page it was posted from',
  },
];
