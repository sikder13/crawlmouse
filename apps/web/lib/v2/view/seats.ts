/**
 * Seats (Final-Ag-Seats) and the invitation page as data (CC-31 D3, D4).
 *
 * The People table is the account's seats that are not removed, invitations among them: a seat with
 * no `accepted_at` is an invitation. Counts are of those rows; the seat limit is the one the page
 * passes (the viewer's, with the trial and past-due clocks read) or the account's own. The role table
 * is rendered from `SEAT_GUARD` through `ROLE_ROWS`. Prices are `prices.ts`'s and the plans' limits
 * `GATES`'s; a line about a limit is `gateMessage`'s.
 *
 * What a reader is offered follows `roleMay`: the invite, change, remove and resend forms for a role
 * that may invite (the owner), the buy form for a role that may buy on a plan that sells seats. Any
 * other member sees the people and the role table. The routes ask `seat_may` again.
 */
import type { Seat, SeatRole, Site } from '@crawlmouse/types/v2';
import { EXTRA_SEAT, EXTRA_SITE, usd } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { MAX_EXTRA_SEATS } from '../agency/extras-bounds';
import { gateMessage } from '../agency/gates';
import { roleMay } from '../agency/guard';
import { INVITE_COPY, ROLE_ROWS, SEATS_COPY as COPY } from '../copy/seats';
import { capitalise, count, numberWord, plural } from '../words';
import {
  primarySites,
  readerRole,
  readerSeat,
  viewAt,
  type AccountDataset,
  type Viewer,
} from './account';
import { accountShellView, type ShellView } from './account-shell';

const ROLES = ['owner', 'account_manager', 'developer'] as const satisfies readonly SeatRole[];
const INVITED_ROLES = ['account_manager', 'developer'] as const;

export interface Option {
  value: string;
  label: string;
}

/** A client site a seat's scope can name, and whether this seat's scope names it. */
export interface ScopeBox {
  /** The form field: `site_<id>`. */
  name: string;
  host: string;
  ticked: boolean;
}

/** The role and scope fields of the invite form and of a seat's change form. */
export interface SeatFields {
  roles: Option[];
  role: string;
  scope: Option[];
  scopeValue: 'all' | 'some';
  sites: ScopeBox[];
}

export interface SeatChangeView {
  /** POST with `_method=PATCH`: the role and the scope. */
  change: { action: string; fields: SeatFields };
  /** POST with `_method=DELETE`. */
  remove: { action: string; label: string };
  /** For an invitation: its next one. */
  resend: { action: string; label: string } | null;
}

export interface SeatRowView {
  key: string;
  /** "You, Alex", "Priya", or the address for a person with no name. */
  person: string;
  /** Under the name; null when the name is the address. */
  email: string | null;
  role: string;
  /** "all 12", or "7 · a.example, b.example, …". */
  clients: string;
  alerts: string;
  /** An invitation not yet accepted. */
  invited: boolean;
  /** Null for the owner's seat, and for a reader who may not change seats. */
  change: SeatChangeView | null;
}

export interface SeatsView {
  shell: ShellView;
  header: {
    title: string;
    /** "4 of 5 used · owner, 2 account managers, 1 developer". */
    line: string;
    /** The page's one orange element: a link to the invite form. Null when the reader may not invite. */
    invite: { label: string; href: string } | null;
  };
  people: {
    title: string;
    sub: string;
    rows: SeatRowView[];
    /** "One seat free. Beyond five, $12 a seat a month.", or the plan's gate message. */
    foot: string;
    mailNote: string;
  };
  roles: {
    title: string;
    columns: string[];
    rows: { can: string; cells: boolean[] }[];
  };
  /** Null when the reader may not invite, or no seat is free. */
  invite: { id: string; action: string; fields: SeatFields } | null;
  /** Null unless the reader may buy and the plan sells seats and sites beyond its own. */
  buy: {
    action: string;
    accountId: string;
    line: string;
    seats: { value: number; max: number };
    sites: { value: number; max: number };
  } | null;
}

const INVITE_ANCHOR = 'invite';

const siteField = (id: string) => `site_${id}`;

function fields(sites: readonly Site[], role: string, scope: Seat['client_scope']): SeatFields {
  return {
    roles: INVITED_ROLES.map((r) => ({ value: r, label: COPY.roleName[r] })),
    role,
    scope: [
      { value: 'all', label: COPY.form.everyClient },
      { value: 'some', label: COPY.form.someClients },
    ],
    scopeValue: scope === 'all' ? 'all' : 'some',
    sites: sites.map((s) => ({
      name: siteField(s.id),
      host: s.host,
      ticked: scope !== 'all' && scope.includes(s.id),
    })),
  };
}

/** "all 12", or the count and the first two hosts of the clients a scoped seat covers. */
function clientsCell(scope: Seat['client_scope'], sites: readonly Site[]): string {
  if (scope === 'all') return `all ${count(sites.length)}`;
  const [first, second, ...more] = sites.filter((s) => scope.includes(s.id)).map((s) => s.host);
  const shown = [first, second].filter((h) => h !== undefined).join(', ');
  return `${count(scope.length)} · ${shown}${more.length > 0 ? ', …' : ''}`;
}

/** "owner, 2 account managers, 1 developer": the owner unnumbered, the other roles counted. */
function roleCounts(seats: readonly Seat[]): string {
  return ROLES.flatMap((role) => {
    const n = seats.filter((s) => s.role === role).length;
    if (n === 0) return [];
    const [one, many] = COPY.rolePlural[role];
    return [role === 'owner' && n === 1 ? one : `${count(n)} ${plural(n, one, many)}`];
  }).join(', ');
}

export interface SeatsOptions {
  /** The seat limit at this moment; by default the account's own. */
  seatLimit?: number;
  /** Whether the purchase route is switched on (`V2_BILLING`). */
  billing?: boolean;
}

export function seatsView(
  d: AccountDataset,
  viewer: Viewer,
  { seatLimit, billing = true }: SeatsOptions = {},
): SeatsView {
  const v = viewAt(d, viewer);
  const role = readerRole(v);
  const mine = readerSeat(v);
  const sites = [...primarySites(v)].sort((a, b) => a.host.localeCompare(b.host));
  const seats = [...v.d.seats].sort(
    (a, b) =>
      ROLES.indexOf(a.role) - ROLES.indexOf(b.role) ||
      a.invited_at.localeCompare(b.invited_at) ||
      a.id.localeCompare(b.id),
  );
  const limit = seatLimit ?? v.account.limits.seats;
  const used = seats.length;
  const free = Math.max(0, limit - used);
  const mayInvite = role !== null && roleMay(role, 'invite_seat');
  const mayChange = role !== null && roleMay(role, 'change_seat');
  const mayBuy = role !== null && roleMay(role, 'buy_seats');

  const rows: SeatRowView[] = seats.map((s) => {
    const own = mine !== null && s.id === mine.id;
    const person = own ? (s.name ? `${COPY.you}, ${s.name}` : COPY.you) : (s.name ?? s.email);
    const invited = s.accepted_at === null;
    return {
      key: s.id,
      person,
      email: person === s.email ? null : s.email,
      role: COPY.roleLine[s.role],
      clients: clientsCell(s.client_scope, sites),
      alerts: s.alert_channels.map((c) => COPY.channel[c]).join(', ') || COPY.noAlerts,
      invited,
      change:
        mayChange && s.role !== 'owner'
          ? {
              change: {
                action: `/api/seats/id/${s.id}`,
                fields: fields(sites, s.role, s.client_scope),
              },
              remove: { action: `/api/seats/id/${s.id}`, label: COPY.form.remove },
              resend: invited
                ? { action: `/api/seats/id/${s.id}/resend`, label: COPY.form.resend }
                : null,
            }
          : null,
    };
  });

  const freeLine = `${capitalise(free === 0 ? 'no' : numberWord(free))} ${free > 1 ? 'seats' : 'seat'} free.`;
  const foot =
    v.tier === 'agency'
      ? `${freeLine} Beyond ${numberWord(GATES.agency.seats)}, ${usd(EXTRA_SEAT)} a seat a month.`
      : v.tier === 'free' || free === 0
        ? gateMessage('seats', v.tier)!
        : freeLine;

  const extras = {
    seats: Math.max(0, v.account.limits.seats - GATES.agency.seats),
    sites: Math.max(0, v.account.limits.sites - GATES.agency.sites),
  };

  return {
    shell: accountShellView(v, null, { role: role ?? 'developer' }),
    header: {
      title: COPY.title,
      line: `${count(used)} of ${count(limit)} used · ${roleCounts(seats)}`,
      invite:
        mayInvite && v.tier !== 'free' && free > 0
          ? { label: COPY.invite, href: `#${INVITE_ANCHOR}` }
          : null,
    },
    people: {
      title: `${COPY.people} · ${count(used)} of ${count(limit)} seats`,
      sub: COPY.peopleSub,
      rows,
      foot,
      mailNote: COPY.mailNote,
    },
    roles: {
      title: COPY.rolesTitle,
      columns: [COPY.columns.can, ...ROLES.map((r) => COPY.roleName[r])],
      rows: ROLE_ROWS.map((r) => ({
        can: r.can,
        cells: ROLES.map((roleOf) => r.action === null || roleMay(roleOf, r.action)),
      })),
    },
    invite:
      mayInvite && v.tier !== 'free' && free > 0
        ? { id: INVITE_ANCHOR, action: '/api/seats', fields: fields(sites, 'developer', 'all') }
        : null,
    buy:
      mayBuy && billing && v.gates.agencyBranding
        ? {
            action: '/api/billing/seats',
            accountId: v.account.id,
            line: `${usd(EXTRA_SEAT)} a month for each seat beyond ${numberWord(GATES.agency.seats)}, ${usd(EXTRA_SITE)} a month for each site beyond ${count(GATES.agency.sites)}, up to ${count(GATES.agency.maxSites)} sites.`,
            seats: { value: extras.seats, max: MAX_EXTRA_SEATS },
            sites: { value: extras.sites, max: GATES.agency.maxSites - GATES.agency.sites },
          }
        : null,
  };
}

// ─── the invitation page ─────────────────────────────────────────────────────────────────────────

export type InviteView =
  | { state: 'gone'; title: string; lines: string[]; notice: string | null }
  | {
      state: 'invite';
      title: string;
      lines: string[];
      notice: string | null;
      /** Signed in: the form that accepts. Signed out: the link to sign in first. */
      act:
        | { kind: 'accept'; action: string; label: string }
        | { kind: 'sign_in'; href: string; label: string; note: string };
    };

/**
 * What `/invite` shows: the invitation its cookie's token opens, read through `read_seat_invite`
 * (null when the link cannot be used), for a reader who is signed in or not. `notice` is the line of
 * a refused acceptance the form was sent back with.
 */
export function inviteView(
  invitation: {
    accountName: string | null;
    role: (typeof INVITED_ROLES)[number];
    everyClient: boolean;
  } | null,
  signedIn: boolean,
  notice: string | null = null,
): InviteView {
  if (invitation === null) {
    return { state: 'gone', title: INVITE_COPY.goneTitle, lines: [INVITE_COPY.gone], notice };
  }
  return {
    state: 'invite',
    title: `${INVITE_COPY.title} ${INVITE_COPY.to(invitation.accountName)}`,
    lines: [
      INVITE_COPY.role[invitation.role],
      invitation.everyClient ? INVITE_COPY.everyClient : INVITE_COPY.someClients,
    ],
    notice,
    act: signedIn
      ? { kind: 'accept', action: '/api/seats/accept', label: INVITE_COPY.accept }
      : {
          kind: 'sign_in',
          href: '/login?next=/invite',
          label: INVITE_COPY.signIn,
          note: INVITE_COPY.signInNote,
        },
  };
}
