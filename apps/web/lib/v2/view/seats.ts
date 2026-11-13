/**
 * Seats (Final-Ag-Seats) and the invitation page as data (CC-31 D3, D4).
 *
 * The People table is the account's seats that are not removed, invitations among them: a seat with
 * no `accepted_at` is an invitation. Counts are of those rows; the seat limit is the one the page
 * passes (the viewer's, with the trial and past-due clocks read) or the account's own. A reader
 * whose seat covers some clients is shown their own seat and the owner's by row security (spec 31
 * §4), so for them the table is those two and no count or free seat is stated. The role table
 * is rendered from `SEAT_GUARD` through `ROLE_ROWS`. Prices are `prices.ts`'s and the plans' limits
 * `GATES`'s; a line about a limit is `gateMessage`'s.
 *
 * What a reader is offered follows `roleMay`: the invite, change, remove and resend forms for a role
 * that may invite (the owner), the buy form for a role that may buy on an account the purchase route
 * would not refuse for its state or for a plan that does not renew (`extrasOffered`). Any other
 * member sees the people and the role table. The routes ask `seat_may` again.
 */
import type { Seat, SeatRole, Site } from '@crawlmouse/types/v2';
import {
  EXTRA_SEAT,
  EXTRA_SEAT_YEARLY,
  EXTRA_SITE,
  EXTRA_SITE_YEARLY,
  usd,
} from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import type { NoticeCode } from '../account/route';
import { extrasOffered, MAX_EXTRA_SEATS } from '../agency/extras-bounds';
import { gateMessage } from '../agency/gates';
import { roleMay } from '../agency/guard';
import { INVITE_LINK_DAYS } from '../agency/seats';
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
  /** "all 12", "all clients" for a reader whose seat covers some, or "7 · a.example, b.example, …". */
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
    /**
     * "One seat free. Beyond five, $12 a seat a month, or $120 a year on a yearly plan.", with what the price waits for in an Agency
     * trial and past due, and without the price on a plan that does not renew; below Agency the
     * plan's gate message; null for a reader who is not shown every seat.
     */
    foot: string | null;
    mailNote: string;
  };
  roles: {
    title: string;
    columns: string[];
    rows: { can: string; cells: boolean[] }[];
  };
  /** Null when the reader may not invite, or no seat is free. */
  invite: { id: string; action: string; fields: SeatFields } | null;
  /**
   * Null unless the reader may buy and the account is offered seats and sites beyond the plan's
   * (`extrasOffered`: not in its Agency trial, not past due, and on a plan that renews).
   */
  buy: {
    id: string;
    action: string;
    accountId: string;
    line: string;
    seats: { value: number; max: number };
    sites: { value: number; max: number };
  } | null;
}

const INVITE_ANCHOR = 'invite';
/** The buy form's id on `/seats`, which the client matrix links at the plan's site limit. */
export const BUY_ANCHOR = 'buy';

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

/**
 * "all 12", or the count and the first two hosts of the clients a scoped seat covers. The clients
 * counted and named are the account's live ones: a removed site stays in the seat's scope rows and
 * is not a client the seat covers, so a seat whose clients were all removed reads "none".
 *
 * `sites` is what the reader's records hold. For a reader whose own seat covers some clients
 * (`partial`) that is their clients and not the account's, so a seat that covers every client reads
 * "all clients", with no count.
 */
function clientsCell(
  scope: Seat['client_scope'],
  sites: readonly Site[],
  partial: boolean,
): string {
  if (scope === 'all') return COPY.everyClientCell(partial ? null : sites.length);
  const covered = sites.filter((s) => scope.includes(s.id)).map((s) => s.host);
  if (covered.length === 0) return COPY.noClients;
  const [first, second, ...more] = covered;
  const shown = [first, second].filter((h) => h !== undefined).join(', ');
  return `${count(covered.length)} · ${shown}${more.length > 0 ? ', …' : ''}`;
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
  const partial = v.seatId !== null && mine !== null && mine.client_scope !== 'all';
  const shown = partial ? seats.filter((s) => s.id === mine.id || s.role === 'owner') : seats;
  const limit = seatLimit ?? v.account.limits.seats;
  const used = seats.length;
  const free = Math.max(0, limit - used);
  const mayInvite = role !== null && roleMay(role, 'invite_seat');
  const mayChange = role !== null && roleMay(role, 'change_seat');
  const mayBuy = role !== null && roleMay(role, 'buy_seats');

  const rows: SeatRowView[] = shown.map((s) => {
    const own = mine !== null && s.id === mine.id;
    const person = own ? (s.name ? `${COPY.you}, ${s.name}` : COPY.you) : (s.name ?? s.email);
    const invited = s.accepted_at === null;
    return {
      key: s.id,
      person,
      email: person === s.email ? null : s.email,
      role: COPY.roleLine[s.role],
      clients: clientsCell(s.client_scope, sites, partial),
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
  // On Agency the foot prices a seat beyond the plan's while the plan renews. In the two states the
  // purchase route refuses (lib/v2/agency/extras.ts `CHANGEABLE`) it says what ends the refusal: a
  // trialing subscription's limits do not follow its extras, and a past-due one's last payment
  // failed. For a plan the records do not say renews (`extrasOffered`) it gives no price.
  const waits =
    v.account.state === 'agency_trial'
      ? COPY.onceTrialEnds
      : v.account.state === 'past_due'
        ? COPY.oncePaid
        : '';
  const priced =
    v.account.renews_at === null
      ? freeLine
      : `${freeLine} Beyond ${numberWord(GATES.agency.seats)}, ${usd(EXTRA_SEAT)} a seat a month, or ${usd(EXTRA_SEAT_YEARLY)} a year on a yearly plan${waits}.`;
  const foot =
    v.tier === 'agency'
      ? priced
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
      line: partial
        ? COPY.partialLine
        : `${count(used)} of ${count(limit)} used · ${roleCounts(seats)}`,
      invite:
        mayInvite && v.tier !== 'free' && free > 0
          ? { label: COPY.invite, href: `#${INVITE_ANCHOR}` }
          : null,
    },
    people: {
      title: partial ? COPY.people : COPY.peopleOf(used, limit),
      sub: COPY.peopleSub,
      rows,
      foot: partial ? null : foot,
      mailNote: COPY.mailNote(numberWord(INVITE_LINK_DAYS)),
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
      mayBuy && billing && extrasOffered(v.account, v.gates.agencyBranding)
        ? {
            id: BUY_ANCHOR,
            action: '/api/billing/seats',
            accountId: v.account.id,
            line: `${usd(EXTRA_SEAT)} a month for each seat beyond ${numberWord(GATES.agency.seats)}, ${usd(EXTRA_SITE)} a month for each site beyond ${count(GATES.agency.sites)}, up to ${count(GATES.agency.maxSites)} sites. On a yearly plan each is charged by the year: ${usd(EXTRA_SEAT_YEARLY)} a seat, ${usd(EXTRA_SITE_YEARLY)} a site.`,
            seats: { value: extras.seats, max: MAX_EXTRA_SEATS },
            sites: { value: extras.sites, max: GATES.agency.maxSites - GATES.agency.sites },
          }
        : null,
  };
}

// ─── the invitation page ─────────────────────────────────────────────────────────────────────────

export type InviteView =
  | { state: 'gone' | 'no_link'; title: string; lines: string[]; notice: string | null }
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

/** A refused acceptance's notice, as the page read it from its address. */
export interface InviteNotice {
  code: NoticeCode;
  text: string;
}

/**
 * The two refusals that are about the link itself. The page says each as its state, from its own
 * read of the cookie and the invitation, so neither is drawn as a line beside that state.
 */
const LINK_NOTICES: readonly NoticeCode[] = ['invite_gone', 'invite_no_link'];

/**
 * What `/invite` shows, for a reader who is signed in or not: the invitation its cookie's token
 * opens, read through `read_seat_invite`; null for a token that function refuses; `'no_link'` when
 * the cookie holds no token, which says nothing about the invitation itself.
 *
 * `notice` is what a refused acceptance sent the form back with. `invite_gone` with no token is a
 * link the accept route refused and whose cookie it cleared: the page says the link cannot be used,
 * not that the mailed link should be opened again. Any other refusal is said above what the page
 * read.
 */
export function inviteView(
  invitation:
    | {
        accountName: string | null;
        role: (typeof INVITED_ROLES)[number];
        everyClient: boolean;
      }
    | null
    | 'no_link',
  signedIn: boolean,
  notice: InviteNotice | null = null,
): InviteView {
  const line = notice === null || LINK_NOTICES.includes(notice.code) ? null : notice.text;
  if (invitation === null || (invitation === 'no_link' && notice?.code === 'invite_gone')) {
    return { state: 'gone', title: INVITE_COPY.goneTitle, lines: [INVITE_COPY.gone], notice: line };
  }
  if (invitation === 'no_link') {
    return {
      state: 'no_link',
      title: INVITE_COPY.noLinkTitle,
      lines: [INVITE_COPY.noLink],
      notice: line,
    };
  }
  return {
    state: 'invite',
    title: `${INVITE_COPY.title} ${INVITE_COPY.to(invitation.accountName)}`,
    lines: [
      INVITE_COPY.role[invitation.role],
      invitation.everyClient ? INVITE_COPY.everyClient : INVITE_COPY.someClients,
    ],
    notice: line,
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
