/**
 * What each agency-workspace preview renders (CC-31), from the contract fixtures. challenged-site
 * holds two agencies: Northwind Digital (two clients with results, four seats, a report sent) and
 * Kestrel Creative (one client, its first check queued). The states neither is in are made from
 * them here, in the open, by taking records out; nothing is added to a fixture.
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { fixture } from '../../../../lib/v2/fixtures';
import type { Viewer } from '../../../../lib/v2/view/account';
import type { SwitcherAccount } from '../../../../lib/v2/view/account-shell';
import { agencyClientView } from '../../../../lib/v2/view/agency-client';
import { agencyHomeView } from '../../../../lib/v2/view/agency-matrix';
import { ACCOUNT_VIEWERS, BAD_ACCOUNT_ID, NORTHWIND_ACCOUNT_ID } from './accounts';

/** Kestrel Creative: an Agency trial begun three minutes before the fixture's as_of. */
export const KESTREL_ACCOUNT_ID = 'a0000000-0000-4000-8000-0000000000ca';
/** Northwind's owner, and Priya: an account manager whose seat covers granitepeak.example alone. */
const ALEX_SEAT = 'e0000000-0000-4000-8000-0000000000c9';
export const PRIYA_SEAT = 'e0000000-0000-4000-8000-0000000000ca';
/** granitepeak.example: Northwind's client with a problem opened and its AI readability withheld. */
export const GRANITEPEAK_SITE = '50000000-0000-4000-8000-0000000000c9';
/** harborlight.example: Northwind's client with both grades and nothing open. */
export const HARBORLIGHT_SITE = '50000000-0000-4000-8000-0000000000ca';

const challenged = () => fixture('challenged-site');
const northwind = (): Viewer => ACCOUNT_VIEWERS.withheld();
const kestrel = (): Viewer => ({ accountId: KESTREL_ACCOUNT_ID, now: challenged().as_of });

type Edit = (d: FixtureDataset) => Partial<FixtureDataset>;
const edited = (edit: Edit): FixtureDataset => {
  const d = challenged();
  return { ...d, ...edit(d) };
};

/** The records a seat scoped to `siteIds` reads, as `loadAccountDataset` returns them for it. */
function scopedTo(siteIds: readonly string[]): FixtureDataset {
  const keep = new Set(siteIds);
  return edited((d) => {
    const checks = new Set(d.checks.filter((c) => keep.has(c.site_id)).map((c) => c.id));
    const fixes = new Set(d.fixes.filter((f) => keep.has(f.site_id)).map((f) => f.id));
    return {
      sites: d.sites.filter((s) => keep.has(s.id)),
      checks: d.checks.filter((c) => checks.has(c.id)),
      page_results: d.page_results.filter((p) => checks.has(p.check_id)),
      link_edges: d.link_edges.filter((e) => checks.has(e.check_id)),
      access_tests: d.access_tests.filter((a) => checks.has(a.check_id)),
      fixes: d.fixes.filter((f) => fixes.has(f.id)),
      fix_events: d.fix_events.filter((e) => fixes.has(e.fix_id)),
      changes: d.changes.filter((c) => checks.has(c.check_id)),
      alert_rules: d.alert_rules.filter((r) => r.site_id === null || keep.has(r.site_id)),
      reports: d.reports.filter((r) => keep.has(r.site_id)),
      usage_events: d.usage_events.filter((u) => u.check_id === null || checks.has(u.check_id)),
      withheld: d.withheld.filter((w) => checks.has(w.check_id)),
    };
  });
}

/** bad-site's owner, also seated on Northwind: the reader of the "Open …" state. */
const TWO_SEATS: SwitcherAccount[] = [
  { id: BAD_ACCOUNT_ID, kind: 'personal', name: null },
  { id: NORTHWIND_ACCOUNT_ID, kind: 'agency', name: 'Northwind Digital' },
];

/** Each state of `/agency`: the records it reads, who reads them and when. */
export const AGENCY_PREVIEWS = {
  /** Final-Ag-Matrix: Northwind, read by its owner. */
  '/v2-preview/screens/agency': { d: challenged, viewer: northwind },
  /** First run, step one: an agency with no client yet. */
  '/v2-preview/screens/agency/no-client': {
    d: () => scopedTo([]),
    viewer: northwind,
  },
  /** Step two: Kestrel's one client before any check of it was asked for. */
  '/v2-preview/screens/agency/not-checked': {
    d: () => edited((d) => ({ checks: d.checks.filter((c) => c.status !== 'queued') })),
    viewer: kestrel,
  },
  /** Kestrel as the fixture has it: its client's first check queued. */
  '/v2-preview/screens/agency/first-check': { d: challenged, viewer: kestrel },
  /** Step three: Northwind with its owner's seat alone. */
  '/v2-preview/screens/agency/invite': {
    d: () => edited((d) => ({ seats: d.seats.filter((s) => s.role === 'owner') })),
    viewer: northwind,
  },
  /** Step four: Northwind before any report went to a client. */
  '/v2-preview/screens/agency/report': {
    d: () => edited((d) => ({ reports: d.reports.filter((r) => r.status !== 'sent') })),
    viewer: northwind,
  },
  /** A seat that covers one client: Priya's, with the records her seat reads. */
  '/v2-preview/screens/agency/scoped': {
    d: () => scopedTo([GRANITEPEAK_SITE]),
    viewer: (): Viewer => ({ ...northwind(), seatId: PRIYA_SEAT }),
  },
  /** An account below Agency: bad-site's, on its Pro trial. */
  '/v2-preview/screens/agency/gate': { d: () => fixture('bad-site'), viewer: ACCOUNT_VIEWERS.home },
  /** The same account, read by a person who also holds a seat on Northwind. */
  '/v2-preview/screens/agency/open': {
    d: () => fixture('bad-site'),
    viewer: ACCOUNT_VIEWERS.home,
    accounts: TWO_SEATS,
  },
} as const satisfies Record<
  string,
  { d: () => FixtureDataset; viewer: () => Viewer; accounts?: SwitcherAccount[] }
>;

export type AgencyPreview = keyof typeof AGENCY_PREVIEWS;

/** The `/agency` screen a preview renders. */
export function agencyPreview(path: AgencyPreview) {
  const p: { d: () => FixtureDataset; viewer: () => Viewer; accounts?: SwitcherAccount[] } =
    AGENCY_PREVIEWS[path];
  return agencyHomeView(p.d(), p.viewer(), p.accounts ? { accounts: p.accounts } : {});
}

/** Each client-page preview: the client it opens and who reads it. */
export const CLIENT_PREVIEWS = {
  /** Final-Ag-Client: granitepeak.example, a problem open and AI readability withheld. */
  '/v2-preview/screens/agency/client': {
    site: GRANITEPEAK_SITE,
    viewer: (): Viewer => ({ ...northwind(), seatId: ALEX_SEAT }),
  },
  /** harborlight.example: both grades, nothing open. */
  '/v2-preview/screens/agency/client/clean': {
    site: HARBORLIGHT_SITE,
    viewer: (): Viewer => ({ ...northwind(), seatId: ALEX_SEAT }),
  },
} as const satisfies Record<string, { site: string; viewer: () => Viewer }>;

export type ClientPreview = keyof typeof CLIENT_PREVIEWS;

/** The client page a preview renders. */
export function clientPreview(path: ClientPreview) {
  const p = CLIENT_PREVIEWS[path];
  return agencyClientView(challenged(), p.viewer(), p.site);
}
