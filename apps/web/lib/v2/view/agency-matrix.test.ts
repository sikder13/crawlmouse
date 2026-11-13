/**
 * The client matrix's view model against challenged-site, whose values are worked out by hand
 * below: Northwind Digital (granitepeak.example, a problem opened and its AI readability withheld;
 * harborlight.example, A 91 and A- 89 with no change) and Kestrel Creative (one client, its first
 * check queued).
 */
import type { FixtureDataset, Seat } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWERS,
  BAD_ACCOUNT_ID,
  NORTHWIND_ACCOUNT_ID,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import {
  GRANITEPEAK_SITE,
  HARBORLIGHT_SITE,
  KESTREL_ACCOUNT_ID,
  PRIYA_SEAT,
} from '../../../app/(v2-preview)/v2-preview/_preview/agency';
import { AGENCY_MONTHLY } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { fixture } from '../fixtures';
import type { Viewer } from './account';
import { agencyGate, agencyHomeView, type MatrixView } from './agency-matrix';
import { dashboardView } from './dashboard';

const d = fixture('challenged-site');
const northwind: Viewer = ACCOUNT_VIEWERS.withheld();
const kestrel: Viewer = { accountId: KESTREL_ACCOUNT_ID, now: d.as_of };
const ALEX = 'e0000000-0000-4000-8000-0000000000c9';
const LEE = 'e0000000-0000-4000-8000-0000000000cc';
const PINECREST = '50000000-0000-4000-8000-0000000000cb';

const matrix = (data: FixtureDataset, viewer: Viewer): MatrixView => {
  const view = agencyHomeView(data, viewer);
  if (view.kind !== 'matrix') throw new Error(`expected the matrix, got ${view.kind}`);
  return view;
};
const edit = (over: (x: FixtureDataset) => Partial<FixtureDataset>): FixtureDataset => ({
  ...d,
  ...over(d),
});
const seatAs = (seatId: string, over: Partial<Seat>) =>
  edit((x) => ({ seats: x.seats.map((s) => (s.id === seatId ? { ...s, ...over } : s)) }));

describe('the client matrix', () => {
  const view = matrix(d, northwind);

  it('has one row per client, the one with a new problem first', () => {
    expect(view.clients.rows.map((r) => [r.host, r.client, r.href])).toEqual([
      ['granitepeak.example', 'Granite Peak Supply', `/agency/clients/${GRANITEPEAK_SITE}`],
      ['harborlight.example', 'Harbor Light Studio', `/agency/clients/${HARBORLIGHT_SITE}`],
    ]);
    expect(view.clients.rows.map((r) => r.since.opened)).toEqual([1, 0]);
  });

  it('puts the client with a new problem first wherever its record and its host would sort it', () => {
    // The same two clients, recorded in the other order and with the problem site's host last by
    // name: only its opened problem puts it first.
    const moved = edit((x) => ({
      sites: x.sites
        .map((s) => (s.id === GRANITEPEAK_SITE ? { ...s, host: 'zz-granitepeak.example' } : s))
        .reverse(),
    }));
    expect(matrix(moved, northwind).clients.rows.map((r) => r.host)).toEqual([
      'zz-granitepeak.example',
      'harborlight.example',
    ]);
    // With nothing opened anywhere, the hosts decide.
    const quiet = { ...moved, changes: [] };
    expect(matrix(quiet, northwind).clients.rows.map((r) => r.host)).toEqual([
      'harborlight.example',
      'zz-granitepeak.example',
    ]);
  });

  it('gives both grades, and says a withheld one is withheld', () => {
    const [granite, harbor] = view.clients.rows;
    expect(granite).toMatchObject({
      seo: { letter: 'C+', score: 66 },
      ai: null,
      aiWithheld: true,
    });
    expect(harbor).toMatchObject({
      seo: { letter: 'A', score: 91 },
      ai: { letter: 'A-', score: 89 },
      aiWithheld: false,
      sinceLabel: 'no change',
    });
  });

  it('reads each row’s grades, pills and last check as the dashboard’s site row does', () => {
    const dash = new Map(dashboardView(d, northwind).sites.rows.map((r) => [r.key, r]));
    for (const row of view.clients.rows) {
      const site = dash.get(row.key)!;
      expect({
        seo: row.seo,
        ai: row.ai,
        aiWithheld: row.aiWithheld,
        since: row.since,
        sinceLabel: row.sinceLabel,
        lastCheck: row.lastCheck,
      }).toEqual({
        seo: site.seo,
        ai: site.ai,
        aiWithheld: site.aiWithheld,
        since: site.since,
        sinceLabel: site.sinceLabel,
        lastCheck: site.lastCheck,
      });
    }
  });

  it('gives each row its next check, and its schedule with the report’s', () => {
    expect(view.clients.rows.map((r) => [r.nextCheck, r.schedule])).toEqual([
      ['Fri 6 Nov around 06:00', 'weekly, Fri · report weekly, Mon'],
      ['Fri 6 Nov around 06:00', 'weekly, Fri · report monthly, first Mon'],
    ]);
    const unscheduled = edit((x) => ({
      sites: x.sites.map((s) =>
        s.id === HARBORLIGHT_SITE ? { ...s, schedule: null, client_report: null } : s,
      ),
    }));
    expect(matrix(unscheduled, northwind).clients.rows[1]).toMatchObject({
      nextCheck: 'none scheduled',
      schedule: 'not scheduled · no report',
    });
  });

  it('leaves a staging copy out: it is not a client', () => {
    const copy = { ...d.sites[0]!, id: 'copy', host: 'staging.granitepeak.example' };
    const withCopy = edit((x) => ({
      sites: [...x.sites, { ...copy, staging_of_site_id: GRANITEPEAK_SITE }],
    }));
    const v = matrix(withCopy, northwind);
    expect(v.clients.rows.map((r) => r.host)).toEqual([
      'granitepeak.example',
      'harborlight.example',
    ]);
    expect(v.clients.title).toBe('Clients · 2');
  });

  it('counts the header from the account’s limits, and names the next weekly check', () => {
    expect(view.header.title).toBe('Since each client’s last check');
    expect(view.header.line).toBe(
      'Mon 2 Nov · 2 client sites, 23 of 25 unused · next weekly check Fri 6 Nov around 06:00',
    );
    expect(view.clients).toMatchObject({
      title: 'Clients · 2',
      sub: 'All 2 client sites, both grades, what changed. Sites with a new problem first; select a site to open it.',
      empty: null,
    });
  });

  it('the strip counts what the rows hold, and has no cell for a count of nothing', () => {
    expect(view.strip).toEqual({
      label: 'Since each client’s last check',
      calls: { count: 1, detail: 'granitepeak.example · of 2 compared' },
      opened: { count: 1, detail: 'at granitepeak.example' },
      resolved: null,
    });
    const quiet = edit(() => ({ changes: [] }));
    expect(matrix(quiet, northwind).strip).toEqual({
      label: 'Since each client’s last check',
      calls: { count: 0, detail: 'of 2 compared' },
      opened: null,
      resolved: null,
    });
  });

  it('has no strip until a client has two results to compare', () => {
    expect(matrix(d, kestrel).strip).toBeNull();
    expect(matrix(d, kestrel).header.title).toBe('Clients');
  });
});

describe('the matrix, adding a client', () => {
  const add = (data: FixtureDataset, viewer: Viewer) => matrix(data, viewer).header.actions;

  it('offers the owner the form, posting the address to the add-site route', () => {
    expect(add(d, northwind)).toMatchObject([
      {
        label: 'Add a client site · 2 of 25',
        href: '/api/sites',
        method: 'post',
        primary: true,
        inputs: [{ kind: 'text', name: 'url', required: true }],
      },
    ]);
  });

  it('offers none to a developer, nor to a seat that covers only some clients', () => {
    expect(add(d, { ...northwind, seatId: LEE })).toEqual([]);
    expect(add(d, { ...northwind, seatId: PRIYA_SEAT })).toEqual([]);
    expect(
      add(seatAs(PRIYA_SEAT, { client_scope: 'all' }), { ...northwind, seatId: PRIYA_SEAT }),
    ).toHaveLength(1);
  });

  it('offers none once every site of the plan is in use', () => {
    const full = edit((x) => ({
      accounts: x.accounts.map((a) =>
        a.id === NORTHWIND_ACCOUNT_ID ? { ...a, limits: { ...a.limits, sites: 2 } } : a,
      ),
    }));
    expect(add(full, northwind)).toEqual([]);
    expect(matrix(full, northwind).header.line).toContain('2 client sites, 0 of 2 unused');
  });

  it('at the plan’s limit, where seats and sites are sold, the owner is shown the way to buy sites; nobody else is, and nobody below the limit', () => {
    const full = edit((x) => ({
      accounts: x.accounts.map((a) =>
        a.id === NORTHWIND_ACCOUNT_ID ? { ...a, limits: { ...a.limits, sites: 2 } } : a,
      ),
    }));
    const actions = (data: FixtureDataset, viewer: Viewer, billing: boolean) => {
      const v = agencyHomeView(data, viewer, { billing });
      if (v.kind !== 'matrix') throw new Error(`not the matrix: ${v.kind}`);
      return v.header.actions.map((a) => [a.label, a.href, a.method]);
    };
    expect(actions(full, northwind, true)).toEqual([
      ['Add sites to the plan', '/seats#buy', 'get'],
    ]);
    // Billing off: /seats draws no buy form, so there is nothing to link.
    expect(actions(full, northwind, false)).toEqual([]);
    // A seat that is not the owner's may not buy.
    expect(actions(full, { ...northwind, seatId: PRIYA_SEAT }, true)).toEqual([]);
    // Below the limit the header's action is the add form, not the link.
    expect(actions(d, northwind, true).map((a) => a[1])).not.toContain('/seats#buy');
  });

  it('a seat that covers some clients is told how many are in it, not how many slots are unused', () => {
    const line = matrix(d, { ...northwind, seatId: PRIYA_SEAT }).header.line;
    expect(line).toContain('2 client sites in your seat');
    expect(line).not.toContain('unused');
  });
});

describe('the matrix, first run: the next step is the first not done', () => {
  const none = edit(() => ({ sites: [], checks: [], fixes: [], changes: [], reports: [] }));
  const notChecked = edit((x) => ({ checks: x.checks.filter((c) => c.site_id !== PINECREST) }));
  const oneSeat = edit((x) => ({ seats: x.seats.filter((s) => s.role === 'owner') }));
  const nothingSent = edit((x) => ({ reports: x.reports.filter((r) => r.status !== 'sent') }));
  const step = (data: FixtureDataset, viewer: Viewer) => matrix(data, viewer).next;

  it('no client: add one, and the header’s form is the orange element', () => {
    const v = matrix(none, northwind);
    expect(v.next).toMatchObject({ step: 'add', title: 'Add your first client', action: null });
    expect(v.header.title).toBe('Add your first client');
    expect(v.header.actions[0]!.primary).toBe(true);
    expect(v.clients).toMatchObject({ rows: [], sub: '' });
    expect(v.clients.empty).toContain('Enter a client’s site.');
  });

  it('no client, and a seat that cannot add one: told who can, with nothing to press', () => {
    const v = matrix(none, { ...northwind, seatId: LEE });
    expect(v.next).toBeNull();
    expect(v.header.actions).toEqual([]);
    expect(v.clients.empty).toContain('The account’s owner chooses which clients a seat covers.');
  });

  it('a client with no check: its row says so, and running it is the step', () => {
    const v = matrix(notChecked, kestrel);
    expect(v.clients.rows[0]!.first).toMatchObject({
      label: 'Not checked yet',
      action: {
        label: 'Run the first check',
        method: 'post',
        href: `/api/sites/${PINECREST}/checks`,
      },
    });
    expect(v.next).toMatchObject({
      step: 'check',
      title: 'Run the first check of pinecrest.example',
      action: {
        label: 'Run it now',
        href: `/api/sites/${PINECREST}/checks`,
        method: 'post',
        primary: true,
      },
    });
    // One orange element: the step's, so the header's form is not.
    expect(v.header.actions[0]!.primary).toBe(false);
  });

  it('a first check under way: the row links to it, and there is no step to take', () => {
    const v = matrix(d, kestrel);
    expect(v.clients.rows[0]!.first).toMatchObject({
      label: 'First check queued',
      action: {
        method: 'get',
        href: '/audit/c0000000-0000-4000-8000-0000000000dd',
        primary: false,
      },
    });
    expect(v.next).toBeNull();
    expect(v.header.actions[0]!.primary).toBe(true);
  });

  it('a first check done and one seat: the owner is asked to invite a colleague', () => {
    expect(step(oneSeat, northwind)).toMatchObject({
      step: 'invite',
      action: { href: '/seats', method: 'get', primary: true },
    });
    expect(step(oneSeat, northwind)!.body).toContain(`${d.accounts[0]!.limits.seats} seats`);
  });

  it('nobody but the owner is asked to invite, whatever seats their records hold', () => {
    // Records that hold one seat, and it is an account manager's: seats are the owner's to give.
    const onlyPriya = edit((x) => ({ seats: x.seats.filter((s) => s.id === PRIYA_SEAT) }));
    expect(step(onlyPriya, { ...northwind, seatId: PRIYA_SEAT })).toBeNull();
  });

  it('seats and no report sent: an owner or account manager is asked to send the first', () => {
    expect(step(nothingSent, northwind)).toMatchObject({
      step: 'report',
      action: { href: '/agency/reports', method: 'get', primary: true },
    });
    expect(step(nothingSent, { ...northwind, seatId: PRIYA_SEAT })?.step).toBe('report');
    // A developer may neither invite nor send a client report (the Guard column).
    expect(step(nothingSent, { ...northwind, seatId: LEE })).toBeNull();
    expect(step(oneSeat, { ...northwind, seatId: ALEX })?.step).toBe('invite');
  });

  it('takes the page’s word for whether a report was sent over the dataset’s, which a live page’s records leave empty', () => {
    const stepWith = (reportSent: boolean) => {
      const v = agencyHomeView(d, northwind, { reportSent });
      if (v.kind !== 'matrix') throw new Error(v.kind);
      return v.next?.step ?? null;
    };
    // The fixture holds a sent client report; told that none was sent, the step is to send one.
    expect(stepWith(false)).toBe('report');
    expect(stepWith(true)).toBeNull();
  });

  it('with a report sent, setup has no step left, and Add a client site is the orange element', () => {
    const v = matrix(d, northwind);
    expect(v.next).toBeNull();
    expect(v.header.actions[0]!.primary).toBe(true);
  });
});

describe('/agency for an account that is not on Agency', () => {
  const bad = fixture('bad-site');
  const home = ACCOUNT_VIEWERS.home();
  const PERSONAL = { id: BAD_ACCOUNT_ID, kind: 'personal' as const, name: null };
  const AGENCY = { id: NORTHWIND_ACCOUNT_ID, kind: 'agency' as const, name: 'Northwind Digital' };

  it('is the gate: what Agency keeps and its price, and the way to the plans', () => {
    const view = agencyHomeView(bad, home);
    expect(view).toMatchObject({
      kind: 'gate',
      title: 'Clients',
      message: `Clients, their matrix and their pages are on Agency, which keeps ${GATES.agency.sites} sites and ${GATES.agency.seats} seats: Agency is $${AGENCY_MONTHLY} a month.`,
      action: { href: '/pricing', method: 'get', primary: true },
    });
    // The account's own rail, with no entry marked: this page is none of its links.
    expect(view.shell.nav.map((n) => n.label)).toContain('Sites');
    expect(view.shell.nav.some((n) => n.current)).toBe(false);
  });

  it('for a reader with a seat on an agency: the switch to it, and no gate', () => {
    expect(agencyHomeView(bad, home, { accounts: [PERSONAL, AGENCY] })).toMatchObject({
      kind: 'open',
      agencies: [
        {
          label: 'Open Northwind Digital',
          href: '/api/seats/switch',
          method: 'post',
          fields: { accountId: NORTHWIND_ACCOUNT_ID },
          primary: true,
        },
      ],
    });
  });

  it('an agency account with no plan is told the same as any account below Agency', () => {
    // Northwind once its grace has run out: the tier is Free, though the account is an agency's.
    const lapsed: Viewer = { ...northwind, now: '2026-12-01T12:00:00Z' };
    expect(agencyHomeView(d, lapsed, { accounts: [PERSONAL, AGENCY] }).kind).toBe('gate');
  });

  it('agencyGate is nothing on the Agency tier', () => {
    expect(agencyGate(d, northwind)).toBeNull();
    expect(agencyGate(bad, home)?.kind).toBe('gate');
  });
});
