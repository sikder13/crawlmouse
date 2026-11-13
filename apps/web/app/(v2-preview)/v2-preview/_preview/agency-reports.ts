/**
 * What each client-reports preview renders (CC-31 D8), from the contract fixtures. challenged-site's
 * Northwind Digital has two clients, each with a schedule, and one client report sent; Kestrel
 * Creative is in its Agency trial. The contract holds no field for whether a contact has confirmed
 * or when a schedule runs next, so each preview states them here, in the open; the states neither
 * agency is in are made here too, from stand-in clients that are not fixture records.
 */
import type { FixtureDataset, Site } from '@crawlmouse/types/v2';
import { fixture } from '../../../../lib/v2/fixtures';
import type { Viewer } from '../../../../lib/v2/view/account';
import {
  agencyReportsView,
  type ClientReportsSide,
  type ScheduleSide,
} from '../../../../lib/v2/view/agency-reports';
import { ACCOUNT_VIEWERS } from './accounts';
import { GRANITEPEAK_SITE, HARBORLIGHT_SITE, KESTREL_ACCOUNT_ID } from './agency';

/** Lee, Northwind's developer: a seat that may not schedule reports. */
const LEE_SEAT = 'e0000000-0000-4000-8000-0000000000cc';
/** The fixture's one client report that was sent (to granitepeak.example's contact, 26 Oct). */
const SENT_REPORT = '60000000-0000-4000-8000-0000000000c9';

const challenged = () => fixture('challenged-site');
const northwind = (): Viewer => ACCOUNT_VIEWERS.withheld();

const side = (schedules: Record<string, ScheduleSide>): ClientReportsSide => ({
  schedules: new Map(Object.entries(schedules)),
});

/**
 * Northwind's two schedules as the fixture's own reports imply them: each contact confirmed (a
 * report was sent to one and is scheduled to the other), and each next run the slot the fixture's
 * waiting report is scheduled for (its `scheduled_for`).
 */
const NORTHWIND_SIDE = {
  [GRANITEPEAK_SITE]: {
    nextRunAt: '2026-11-02T15:00:00Z',
    confirmSentAt: '2026-10-24T15:00:00Z',
    confirmedAt: '2026-10-24T16:10:00Z',
  },
  [HARBORLIGHT_SITE]: {
    nextRunAt: '2026-11-02T14:00:00Z',
    confirmSentAt: '2026-10-24T15:00:00Z',
    confirmedAt: '2026-10-25T13:00:00Z',
  },
} satisfies Record<string, ScheduleSide>;

/** A stand-in client of Northwind, made from harborlight.example. Not a fixture record. */
function standIn(n: number, host: string, over: Partial<Site>): Site {
  const base = challenged().sites.find((s) => s.id === HARBORLIGHT_SITE)!;
  return {
    ...base,
    id: `50000000-0000-4000-8000-0000000000f${n}`,
    host,
    client_name: null,
    client_contact_name: null,
    owner_seat_id: null,
    ...over,
  };
}

const CEDAR = standIn(1, 'cedarpoint.example', {
  client_name: 'Cedar Point Cabins',
  client_contact_email: 'stay@cedarpoint.example',
  client_report: {
    cadence: 'weekly',
    iso_weekday: 3,
    time_local: '09:30',
    timezone: 'America/Toronto',
    send_when_unchanged: false,
    open_tracking: false,
    page_slug: 'cedarpoint',
    paused_by_recipient_at: '2026-10-30T13:20:00Z',
  },
});
const MAPLE = standIn(2, 'maplerow.example', {
  client_name: 'Maple Row Bakery',
  client_contact_email: 'hello@maplerow.example',
  client_report: null,
});
const NORTHFIELD = standIn(3, 'northfield.example', {
  client_contact_email: null,
  client_report: null,
});
const REDBIRD = standIn(4, 'redbird.example', {
  client_name: 'Redbird Aviation',
  client_contact_email: 'ops@redbird.example',
  client_report: {
    cadence: 'monthly',
    iso_weekday: 5,
    time_local: '07:00',
    timezone: 'Europe/London',
    send_when_unchanged: true,
    open_tracking: false,
    page_slug: 'redbird',
    paused_by_recipient_at: null,
  },
});

/**
 * Northwind with a client in each state: confirmed (granitepeak), asked and not yet confirmed
 * (harborlight), paused by its recipient (cedarpoint), a contact and no schedule (maplerow), neither
 * (northfield), and a schedule saved whose contact was not asked yet (redbird). The sent report is
 * a document, as a schedule writes one (`write_client_report`), so its row has Open.
 */
function everyState(): FixtureDataset {
  const d = challenged();
  return {
    ...d,
    sites: [...d.sites, CEDAR, MAPLE, NORTHFIELD, REDBIRD],
    reports: d.reports.map((r) =>
      r.id === SENT_REPORT ? { ...r, format: 'html', byte_count: null } : r,
    ),
  };
}

const EVERY_STATE_SIDE = {
  [GRANITEPEAK_SITE]: NORTHWIND_SIDE[GRANITEPEAK_SITE],
  [HARBORLIGHT_SITE]: {
    nextRunAt: '2026-11-02T14:00:00Z',
    confirmSentAt: '2026-10-31T15:00:00Z',
    confirmedAt: null,
  },
  [CEDAR.id]: {
    nextRunAt: '2026-11-04T14:30:00Z',
    confirmSentAt: '2026-10-20T15:00:00Z',
    confirmedAt: '2026-10-20T18:00:00Z',
  },
  [REDBIRD.id]: { nextRunAt: '2026-11-06T07:00:00Z', confirmSentAt: null, confirmedAt: null },
} satisfies Record<string, ScheduleSide>;

interface Preview {
  d: () => FixtureDataset;
  viewer: () => Viewer;
  side: ClientReportsSide;
  /** The client whose forms are open. */
  client?: string;
}

/** Each state of `/agency/reports`: the records it reads, who reads them, and what the page adds. */
export const CLIENT_REPORTS_PREVIEWS = {
  /** Final-Ag-Reports: Northwind, read by its owner. */
  '/v2-preview/screens/agency/reports': {
    d: challenged,
    viewer: northwind,
    side: side(NORTHWIND_SIDE),
  },
  /** A client in each state of its contact and schedule. */
  '/v2-preview/screens/agency/reports/states': {
    d: everyState,
    viewer: northwind,
    side: side(EVERY_STATE_SIDE),
  },
  /** The forms of one client, open: granitepeak.example's. */
  '/v2-preview/screens/agency/reports/change': {
    d: everyState,
    viewer: northwind,
    side: side(EVERY_STATE_SIDE),
    client: GRANITEPEAK_SITE,
  },
  /** The same clients read by a developer: the rows, and no form. */
  '/v2-preview/screens/agency/reports/developer': {
    d: everyState,
    viewer: (): Viewer => ({ ...northwind(), seatId: LEE_SEAT }),
    side: side(EVERY_STATE_SIDE),
  },
  /** Kestrel Creative, in its Agency trial: its one client has no contact and no schedule. */
  '/v2-preview/screens/agency/reports/trial': {
    d: challenged,
    viewer: (): Viewer => ({ accountId: KESTREL_ACCOUNT_ID, now: challenged().as_of }),
    side: {},
  },
  /** An account below Agency: bad-site's, on its Pro trial. */
  '/v2-preview/screens/agency/reports/gate': {
    d: () => fixture('bad-site'),
    viewer: ACCOUNT_VIEWERS.home,
    side: {},
  },
} as const satisfies Record<string, Preview>;

export type ClientReportsPreview = keyof typeof CLIENT_REPORTS_PREVIEWS;

/** The `/agency/reports` screen a preview renders; its links reload the preview's own page. */
export function clientReportsPreview(path: ClientReportsPreview) {
  const p: Preview = CLIENT_REPORTS_PREVIEWS[path];
  return agencyReportsView(p.d(), p.viewer(), p.client ? { client: p.client } : {}, path, p.side);
}
