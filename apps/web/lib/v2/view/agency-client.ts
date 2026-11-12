/**
 * One client of an agency (Final-Ag-Client) as data, built from the site page's own view
 * (`siteView`): the header, the two grades with their moves, the fixes still to raise with their
 * effects and packet links, and what the agency holds about the client (contact, report schedule,
 * owning seat). The grades, moves, effects and fix titles are the site page's values, so the client
 * page cannot say of a site what the site page does not.
 *
 * A client whose first check has not ended with a result reads as its site page does
 * (`FirstCheckView`). A staging copy is not a client: `agencyClientView` is null for one, as it is
 * for a site the reader's records do not hold.
 */
import type { Fix, Seat, Site } from '@crawlmouse/types/v2';
import { roleMay } from '../agency/guard';
import { CLIENT_COPY as COPY } from '../copy/agency';
import { fixesAsOf } from '../fixtures';
import {
  readerRole,
  resultChecks,
  viewAt,
  type AccountDataset,
  type AccountView,
  type Viewer,
} from './account';
import { action, type ActionView } from './account-actions';
import { accountShellView, type ShellView, type SwitcherAccount } from './account-shell';
import {
  sitePage,
  siteView,
  type FirstCheckView,
  type FixRowView,
  type GradeCardView,
} from './site';

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A fix still to raise with the client, as the site page counts a fix still to do: open, open
 * again after a check disagreed, or one a check could not verify.
 */
const TO_RAISE = new Set<Fix['status']>(['open', 'reopened', 'unable_to_verify']);

export interface ClientRowView {
  label: string;
  value: string;
  /** An address or a host: the data face. */
  mono: boolean;
  /** Where the row is changed, for a seat that may change it. */
  change: ActionView | null;
}

export interface ClientView {
  kind: 'client';
  shell: ShellView;
  header: {
    /** The client's name, or the site's host where it has none. */
    title: string;
    /** "granitepeak.example · Mon 2 Nov · last check Wed 15:13 · …": the host, then the site page's line. */
    line: string;
    actions: ActionView[];
  };
  grades: {
    title: string;
    sub: string;
    /** The site page's two grades and their moves, without the parts under each. */
    cards: [GradeCardView, GradeCardView];
    /** "Site page, all checks". */
    site: ActionView;
  };
  fixes: {
    /** "Open fixes · 4 to raise". */
    title: string;
    rows: FixRowView[];
    /** "11 more on the site page", when the site page lists more than these. */
    more: ActionView | null;
    /** In place of the table when nothing is open. */
    empty: string | null;
  };
  client: { title: string; rows: ClientRowView[] };
}

export type ClientPageView = ClientView | { kind: 'first_check'; first: FirstCheckView };

export interface ClientReader {
  accounts?: readonly SwitcherAccount[];
  /** The account the reader acts in, where it may not be the client's (`withSwitcher`). */
  actingIn?: string;
}

const link = (href: string, label: string, context: string): ActionView => ({
  label,
  route: href,
  href,
  method: 'get',
  fields: {},
  primary: false,
  context,
});

/** A grade as the client page draws it: the letter, the score and its move, or why it is withheld. */
const letterOnly = (g: GradeCardView): GradeCardView => ({ ...g, parts: null, verdicts: [] });

function contactOf(s: Site): string {
  const parts = [s.client_contact_name, s.client_contact_email].filter(Boolean);
  return parts.length ? parts.join(' · ') : COPY.none;
}

function reportOf(s: Site): string {
  const r = s.client_report;
  if (!r) return COPY.noReport;
  const when = COPY.reportWhen(r.cadence, WEEKDAYS[r.iso_weekday]!, r.time_local);
  return r.paused_by_recipient_at ? `${when} · ${COPY.pausedByRecipient}` : when;
}

/** The seat that owns the client, as far as the reader's records name it. */
function seatOf(v: AccountView, s: Site): string {
  if (s.owner_seat_id === null) return COPY.none;
  const seat: Seat | undefined = v.d.seats.find((x) => x.id === s.owner_seat_id);
  return seat ? COPY.seat(seat.name ?? seat.email, COPY.roles[seat.role]) : COPY.seatNotListed;
}

/**
 * The client page of `siteId` for the reader of `viewer`'s account: null when the reader's records
 * hold no such site, or it is a staging copy.
 */
export function agencyClientView(
  d: AccountDataset,
  viewer: Viewer,
  siteId: string,
  { accounts, actingIn }: ClientReader = {},
): ClientPageView | null {
  const v = viewAt(d, viewer);
  const site = v.d.sites.find((s) => s.id === siteId);
  if (!site || site.staging_of_site_id !== null) return null;
  const role = readerRole(v) ?? 'developer';
  const shell = accountShellView(v, 'Clients', {
    role,
    ...(accounts ? { accounts } : {}),
    ...(actingIn ? { actingIn } : {}),
  });

  const page = sitePage(d, viewer, siteId);
  if (page.kind === 'first_check') return { kind: 'first_check', first: { ...page.first, shell } };

  const s = siteView(d, viewer, siteId);
  const result = resultChecks(v, site.id).at(-1)!;
  const open = fixesAsOf(v.d, result).filter((f) => TO_RAISE.has(f.status));
  const openIds = new Set(open.map((f) => f.id));
  const rows = s.fixes.rows.filter((r) => openIds.has(r.key));
  const more = open.length - rows.length;
  const sitePageOf = (label: string) => action('sitePage', label, { id: site.id });
  const name = site.client_name?.trim() || null;
  const mayReport = roleMay(role, 'schedule_report');
  return {
    kind: 'client',
    shell,
    header: {
      title: name ?? site.host,
      line: [site.host, s.header.line].join(' · '),
      actions: s.header.actions,
    },
    grades: {
      title: COPY.gradesTitle,
      sub: s.grades.sub,
      cards: [letterOnly(s.grades.cards[0]), letterOnly(s.grades.cards[1])],
      site: sitePageOf(COPY.sitePage),
    },
    fixes: {
      title: COPY.fixesTitle(open.length),
      rows,
      more: more > 0 ? sitePageOf(COPY.more(more)) : null,
      empty: open.length ? null : COPY.noFixes,
    },
    client: {
      title: COPY.clientTitle,
      rows: [
        {
          label: COPY.contact,
          value: contactOf(site),
          mono: site.client_contact_email !== null,
          change: mayReport ? link('/agency/reports', COPY.change, COPY.contact) : null,
        },
        {
          label: COPY.report,
          value: reportOf(site),
          mono: false,
          change: mayReport ? link('/agency/reports', COPY.change, COPY.report) : null,
        },
        {
          label: COPY.seatLabel,
          value: seatOf(v, site),
          mono: false,
          change: roleMay(role, 'change_seat') ? link('/seats', COPY.change, COPY.seatLabel) : null,
        },
      ],
    },
  };
}
