/**
 * The client reports page's view model against challenged-site's Northwind Digital (two clients,
 * four seats, one client report sent) and Kestrel Creative (an Agency trial), with the records
 * edited in the open where a state is in neither.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TimeZoneSchema, type FixtureDataset } from '@crawlmouse/types/v2';
import fc from 'fast-check';
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
} from '../../../app/(v2-preview)/v2-preview/_preview/agency';
import { AGENCY_MONTHLY } from '../../billing/prices';
import { ZONES } from '../account/profile';
import { agencyGateMessage, gateMessage } from '../agency/gates';
import { parseScheduleBody } from '../agency/schedules';
import { fixture } from '../fixtures';
import type { Viewer } from './account';
import {
  CLIENT_REPORT_ROUTES,
  SENT_SHOWN,
  agencyReportsView,
  type ClientReportsSide,
  type ClientReportsView,
  type ScheduleSide,
} from './agency-reports';

const d = fixture('challenged-site');
const northwind: Viewer = ACCOUNT_VIEWERS.withheld();
const BASE = '/agency/reports';
const ALEX = 'e0000000-0000-4000-8000-0000000000c9';
const PRIYA = 'e0000000-0000-4000-8000-0000000000ca';
const SAM = 'e0000000-0000-4000-8000-0000000000cb';
const LEE = 'e0000000-0000-4000-8000-0000000000cc';
const PINECREST = '50000000-0000-4000-8000-0000000000cb';
const SENT_REPORT = '60000000-0000-4000-8000-0000000000c9';

type Site = FixtureDataset['sites'][number];
type Report = FixtureDataset['reports'][number];

const as = (seatId: string): Viewer => ({ ...northwind, seatId });
const edit = (over: (x: FixtureDataset) => Partial<FixtureDataset>): FixtureDataset => ({
  ...d,
  ...over(d),
});
const siteAs = (id: string, over: Partial<Site>, from: FixtureDataset = d): FixtureDataset => ({
  ...from,
  sites: from.sites.map((s) => (s.id === id ? { ...s, ...over } : s)),
});
const sideOf = (entries: Record<string, Partial<ScheduleSide>>): ClientReportsSide => ({
  schedules: new Map(
    Object.entries(entries).map(([id, s]) => [
      id,
      { nextRunAt: null, confirmSentAt: null, confirmedAt: null, ...s },
    ]),
  ),
});

function reports(
  data: FixtureDataset,
  viewer: Viewer,
  query: { client?: string } = {},
  side: ClientReportsSide = {},
): ClientReportsView {
  const view = agencyReportsView(data, viewer, query, BASE, side);
  if (view.kind !== 'reports') throw new Error(`expected the reports page, got ${view.kind}`);
  return view;
}
const row = (view: ClientReportsView, siteId: string) => {
  const r = view.clients.rows.find((x) => x.key === siteId);
  if (!r) throw new Error(`no row for ${siteId}`);
  return r;
};

/** A stand-in client of Northwind, cloned from harborlight.example with another id and host. */
const standIn = (n: number, over: Partial<Site> = {}): Site => ({
  ...d.sites.find((s) => s.id === HARBORLIGHT_SITE)!,
  id: `50000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  host: `client-${String(n).padStart(2, '0')}.example`,
  client_name: null,
  ...over,
});
const weekly = d.sites.find((s) => s.id === GRANITEPEAK_SITE)!.client_report!;
const monthly = d.sites.find((s) => s.id === HARBORLIGHT_SITE)!.client_report!;

describe('the header', () => {
  it('is titled Client reports and counts the clients by their schedule', () => {
    const view = reports(d, northwind);
    expect(view.header.title).toBe('Client reports');
    expect(view.header.line).toBe('1 weekly, 1 monthly');
  });

  it('counts each cadence and the clients with no schedule from the sites it reads', () => {
    // Three weekly, one monthly and two with none, in an order that is not grouped.
    const sites = [
      standIn(1, { client_report: null }),
      standIn(2, { client_report: weekly }),
      standIn(3, { client_report: monthly }),
      standIn(4, { client_report: weekly }),
      standIn(5, { client_report: null }),
      standIn(6, { client_report: weekly }),
    ];
    expect(
      reports(
        edit(() => ({ sites })),
        northwind,
      ).header.line,
    ).toBe('3 weekly, 1 monthly, 2 not scheduled');
  });

  it('leaves out a count of nothing, and says so when there is no client', () => {
    const none = edit((x) => ({ sites: x.sites.map((s) => ({ ...s, client_report: null })) }));
    expect(reports(none, northwind).header.line).toBe('2 not scheduled');
    expect(
      reports(
        edit(() => ({ sites: [] })),
        northwind,
      ).header.line,
    ).toBe('No client site yet');
  });

  it('counts whatever mix of schedules the clients hold (property)', () => {
    const kinds = ['weekly', 'monthly', 'none'] as const;
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...kinds), { maxLength: 30 }), (mix) => {
        const sites = mix.map((k, i) =>
          standIn(i, { client_report: k === 'none' ? null : k === 'weekly' ? weekly : monthly }),
        );
        const n = (k: (typeof kinds)[number]) => mix.filter((x) => x === k).length;
        const expected = [
          n('weekly') ? `${n('weekly')} weekly` : null,
          n('monthly') ? `${n('monthly')} monthly` : null,
          n('none') ? `${n('none')} not scheduled` : null,
        ].filter(Boolean);
        expect(
          reports(
            edit(() => ({ sites })),
            northwind,
          ).header.line,
        ).toBe(expected.length ? expected.join(', ') : 'No client site yet');
      }),
      { numRuns: 60 },
    );
  });

  it('does not count a staging copy or another account’s client', () => {
    const copy = standIn(7, { staging_of_site_id: GRANITEPEAK_SITE, client_report: null });
    const view = reports(
      edit((x) => ({ sites: [...x.sites, copy] })),
      northwind,
    );
    // Kestrel's pinecrest.example is in the fixture and has no schedule: it is not Northwind's.
    expect(view.header.line).toBe('1 weekly, 1 monthly');
    expect(view.clients.rows.map((r) => r.key)).not.toContain(copy.id);
    expect(view.clients.rows.map((r) => r.key)).not.toContain(PINECREST);
  });
});

describe('the clients', () => {
  const side = sideOf({
    [GRANITEPEAK_SITE]: {
      nextRunAt: '2026-11-02T15:00:00Z',
      confirmSentAt: '2026-10-24T15:00:00Z',
      confirmedAt: '2026-10-24T16:00:00Z',
    },
    [HARBORLIGHT_SITE]: {
      nextRunAt: '2026-11-02T14:00:00Z',
      confirmSentAt: '2026-10-31T15:00:00Z',
    },
  });
  const view = reports(d, northwind, {}, side);

  it('lists one row a client site, by host, with its name and its page', () => {
    expect(view.clients.title).toBe('Clients · 2');
    expect(view.clients.rows.map((r) => [r.key, r.client, r.host, r.href])).toEqual([
      [
        GRANITEPEAK_SITE,
        'Granite Peak Supply',
        'granitepeak.example',
        `/agency/clients/${GRANITEPEAK_SITE}`,
      ],
      [
        HARBORLIGHT_SITE,
        'Harbor Light Studio',
        'harborlight.example',
        `/agency/clients/${HARBORLIGHT_SITE}`,
      ],
    ]);
    expect(view.clients.empty).toBeNull();
  });

  it('lists the clients the reader’s records hold and no other', () => {
    // What a seat that covers granitepeak.example alone is handed: that site's records.
    const scoped = edit((x) => ({
      sites: x.sites.filter((s) => s.id === GRANITEPEAK_SITE),
      reports: x.reports.filter((r) => r.site_id === GRANITEPEAK_SITE),
    }));
    const mine = reports(scoped, as(PRIYA), {}, side);
    expect(mine.clients.rows.map((r) => r.host)).toEqual(['granitepeak.example']);
    expect(JSON.stringify(mine)).not.toContain('harborlight.example');
    expect(mine.header.line).toBe('1 weekly, of the client sites in your seat');
  });

  it('says where the contact stands: confirmed, asked, not asked, paused, or none', () => {
    expect(row(view, GRANITEPEAK_SITE).contact).toEqual({
      address: 'ops@granitepeak.example',
      state: 'confirmed',
      mayAsk: true,
      label: 'confirmed',
    });
    // Asked on Sat 31 Oct in the account's zone (America/Indiana/Indianapolis), not yet confirmed.
    expect(row(view, HARBORLIGHT_SITE).contact).toEqual({
      address: 'hello@harborlight.example',
      state: 'asked',
      mayAsk: true,
      label: 'asked to confirm Sat 31 Oct',
    });

    const never = reports(d, northwind, {}, sideOf({ [GRANITEPEAK_SITE]: {} }));
    expect(row(never, GRANITEPEAK_SITE).contact).toMatchObject({
      state: 'not_asked',
      mayAsk: true,
      label: 'not asked to confirm yet',
    });

    const paused = siteAs(GRANITEPEAK_SITE, {
      client_report: { ...weekly, paused_by_recipient_at: '2026-11-01T09:00:00Z' },
    });
    expect(row(reports(paused, northwind, {}, side), GRANITEPEAK_SITE).contact).toMatchObject({
      state: 'paused',
      mayAsk: true,
      label: 'paused by the recipient',
    });

    const none = siteAs(GRANITEPEAK_SITE, {
      client_contact_email: null,
      client_contact_name: null,
    });
    expect(row(reports(none, northwind, {}, side), GRANITEPEAK_SITE).contact).toEqual({
      address: null,
      state: 'none',
      mayAsk: true,
      label: 'no contact',
    });
  });

  it('does not call a contact confirmed that the page was not told has confirmed', () => {
    // No side read at all, a schedule with no entry, and a confirmation asked for and not given.
    for (const s of [
      {},
      sideOf({}),
      sideOf({ [GRANITEPEAK_SITE]: { confirmSentAt: '2026-10-24T15:00:00Z' } }),
    ]) {
      const v = reports(d, northwind, {}, s);
      expect(v.clients.rows.map((r) => r.contact.state)).not.toContain('confirmed');
      expect(JSON.stringify(v.clients)).not.toContain('"confirmed"');
    }
    // A client with no schedule has no confirmation, whatever the page was told.
    const unscheduled = siteAs(GRANITEPEAK_SITE, { client_report: null });
    expect(row(reports(unscheduled, northwind, {}, side), GRANITEPEAK_SITE).contact.state).toBe(
      'not_asked',
    );
  });

  it('words the schedule as the client page does, or says there is none', () => {
    expect(row(view, GRANITEPEAK_SITE).schedule).toBe('weekly, Mon 08:00 their time');
    expect(row(view, HARBORLIGHT_SITE).schedule).toBe('monthly, first Mon 08:00 their time');
    const none = siteAs(GRANITEPEAK_SITE, { client_report: null });
    expect(row(reports(none, northwind, {}, side), GRANITEPEAK_SITE).schedule).toBe(
      'not scheduled',
    );
  });

  it('gives the next run on the schedule’s own clock, and names the zone', () => {
    // 15:00 UTC is 08:00 in Denver and 10:00 in the account's zone: the row reads the schedule's.
    expect(row(view, GRANITEPEAK_SITE).nextRun).toBe('Mon 2 Nov 08:00 America/Denver');
    expect(row(view, HARBORLIGHT_SITE).nextRun).toBe('Mon 2 Nov 08:00 America/Chicago');
    // The same instant on a clock a day ahead.
    const tokyo = siteAs(GRANITEPEAK_SITE, {
      client_report: { ...weekly, timezone: 'Asia/Tokyo', time_local: '00:00', iso_weekday: 2 },
    });
    expect(row(reports(tokyo, northwind, {}, side), GRANITEPEAK_SITE).nextRun).toBe(
      'Tue 3 Nov 00:00 Asia/Tokyo',
    );
  });

  it('gives no next run for a schedule that is paused, has none recorded, or does not exist', () => {
    const paused = siteAs(GRANITEPEAK_SITE, {
      client_report: { ...weekly, paused_by_recipient_at: '2026-11-01T09:00:00Z' },
    });
    expect(row(reports(paused, northwind, {}, side), GRANITEPEAK_SITE).nextRun).toBe(
      'none while paused',
    );
    expect(row(reports(d, northwind), GRANITEPEAK_SITE).nextRun).toBe('none');
    const none = siteAs(GRANITEPEAK_SITE, { client_report: null });
    expect(row(reports(none, northwind, {}, side), GRANITEPEAK_SITE).nextRun).toBe('none');
  });

  it('names the owning seat, as far as the reader’s records hold it', () => {
    expect(row(view, GRANITEPEAK_SITE).seat).toBe('Priya (account manager)');
    expect(row(view, HARBORLIGHT_SITE).seat).toBe('Sam (account manager)');
    const unowned = siteAs(GRANITEPEAK_SITE, { owner_seat_id: null });
    expect(row(reports(unowned, northwind), GRANITEPEAK_SITE).seat).toBe('none');
    const hidden = edit((x) => ({ seats: x.seats.filter((s) => s.id !== PRIYA) }));
    expect(row(reports(hidden, northwind), GRANITEPEAK_SITE).seat).toBe(
      'a seat yours is not shown',
    );
  });

  it('says so in place of the table when there is no client', () => {
    const empty = reports(
      edit(() => ({ sites: [] })),
      northwind,
    );
    expect(empty.clients).toMatchObject({ rows: [], empty: 'No client site yet' });
    const scoped = reports(
      edit(() => ({ sites: [] })),
      as(PRIYA),
    );
    expect(scoped.clients.empty).toBe('No client site is in your seat yet');
    expect(scoped.header.line).toBe('No client site is in your seat yet');
  });
});

describe('what a seat that may schedule reports is offered', () => {
  const side = sideOf({
    [GRANITEPEAK_SITE]: {
      confirmSentAt: '2026-10-24T15:00:00Z',
      confirmedAt: '2026-10-24T16:00:00Z',
    },
    [HARBORLIGHT_SITE]: { confirmSentAt: '2026-10-31T15:00:00Z' },
  });
  const posts = (href: string, fields: Record<string, string> = {}) => ({
    href,
    method: 'post',
    fields,
  });
  const api = (siteId: string, tail = '') => `/api/report-files/schedules/site/${siteId}${tail}`;

  it.each([
    ['the owner', ALEX],
    ['an account manager', SAM],
  ])('%s: each row’s Change, and the ask while its contact has not confirmed', (_who, seat) => {
    const view = reports(d, as(seat), {}, side);
    expect(row(view, GRANITEPEAK_SITE).actions).toMatchObject([
      { label: 'Change', method: 'get', href: `${BASE}?client=${GRANITEPEAK_SITE}#change` },
    ]);
    expect(row(view, HARBORLIGHT_SITE).actions).toMatchObject([
      { label: 'Ask again', ...posts(api(HARBORLIGHT_SITE, '/confirm')) },
      { label: 'Change', method: 'get', href: `${BASE}?client=${HARBORLIGHT_SITE}#change` },
    ]);
  });

  it('asks for the first time where no confirmation was sent, and asks a contact who paused to confirm again', () => {
    const never = reports(d, northwind, {}, sideOf({}));
    expect(row(never, GRANITEPEAK_SITE).actions[0]).toMatchObject({
      label: 'Ask to confirm',
      ...posts(api(GRANITEPEAK_SITE, '/confirm')),
    });
    const paused = siteAs(GRANITEPEAK_SITE, {
      client_report: { ...weekly, paused_by_recipient_at: '2026-11-01T09:00:00Z' },
    });
    expect(row(reports(paused, northwind, {}, side), GRANITEPEAK_SITE).actions).toMatchObject([
      { label: 'Ask to confirm again', ...posts(api(GRANITEPEAK_SITE, '/resume')) },
      { label: 'Change' },
    ]);
    // The card says what a pause means: the reports start again when the contact confirms again.
    expect(reports(paused, northwind, {}, side).clients.sub).toBe(
      'A report goes to a client’s contact once the contact has confirmed. The pause link in a report stops them, and they start again only when the contact confirms again.',
    );
  });

  it('a contact that answered “Don’t ask me again” reads declined and is offered no ask, whatever the schedule holds', () => {
    const paused = siteAs(GRANITEPEAK_SITE, {
      client_report: { ...weekly, paused_by_recipient_at: '2026-11-01T09:00:00Z' },
    });
    const labels = (
      data: FixtureDataset,
      site: string,
      refusals: ClientReportsSide['refusals'],
    ) => {
      const r = row(reports(data, northwind, {}, { ...side, refusals }), site);
      return { contact: r.contact, actions: r.actions.map((a) => a.label) };
    };
    const declined = new Map([[GRANITEPEAK_SITE, { refused: 'declined' as const }]]);
    // Paused, confirmed and waiting alike: the recipient's answer is what the row says.
    for (const data of [paused, d]) {
      expect(labels(data, GRANITEPEAK_SITE, declined)).toEqual({
        contact: {
          address: 'ops@granitepeak.example',
          state: 'declined',
          mayAsk: false,
          label: 'declined: answered “Don’t ask me again”',
        },
        actions: ['Change'],
      });
    }
    const asked = new Map([[HARBORLIGHT_SITE, { refused: 'declined' as const }]]);
    expect(labels(d, HARBORLIGHT_SITE, asked).actions).toEqual(['Change']);
    // Another client's refusal is not this one's.
    expect(labels(paused, GRANITEPEAK_SITE, asked).actions).toEqual([
      'Ask to confirm again',
      'Change',
    ]);
  });

  it('a contact asked again since its pause is offered no other ask, and the row says from when it can be', () => {
    const recent = (site: string) =>
      new Map([[site, { refused: 'asked_recently' as const, nextAt: '2026-12-01T15:00:00Z' }]]);
    const paused = siteAs(GRANITEPEAK_SITE, {
      client_report: { ...weekly, paused_by_recipient_at: '2026-11-01T09:00:00Z' },
    });
    const again = row(
      reports(paused, northwind, {}, { ...side, refusals: recent(GRANITEPEAK_SITE) }),
      GRANITEPEAK_SITE,
    );
    expect(again.contact).toMatchObject({
      state: 'paused',
      mayAsk: false,
      label: 'paused by the recipient; asked again since, and can be asked again from Tue 1 Dec',
    });
    expect(again.actions.map((a) => a.label)).toEqual(['Change']);
    // The day is the account's (America/Indiana/Indianapolis): 03:00 UTC on 1 Dec is 30 Nov there.
    const late = new Map([
      [GRANITEPEAK_SITE, { refused: 'asked_recently' as const, nextAt: '2026-12-01T03:00:00Z' }],
    ]);
    expect(
      row(reports(paused, northwind, {}, { ...side, refusals: late }), GRANITEPEAK_SITE).contact
        .label,
    ).toContain('can be asked again from Mon 30 Nov');
    // Asked and waiting (the schedule was removed and saved again): no "Ask again" either.
    const waiting = row(
      reports(d, northwind, {}, { ...side, refusals: recent(HARBORLIGHT_SITE) }),
      HARBORLIGHT_SITE,
    );
    expect(waiting.contact).toMatchObject({ state: 'asked', mayAsk: false });
    expect(waiting.contact.label).toContain('can be asked again from Tue 1 Dec');
    expect(waiting.actions.map((a) => a.label)).toEqual(['Change']);
  });

  it('offers no ask where there is nothing to confirm: no schedule, or no contact', () => {
    const unscheduled = siteAs(GRANITEPEAK_SITE, { client_report: null });
    const uncontacted = siteAs(HARBORLIGHT_SITE, { client_contact_email: null }, unscheduled);
    const view = reports(uncontacted, northwind, {}, sideOf({}));
    for (const id of [GRANITEPEAK_SITE, HARBORLIGHT_SITE]) {
      expect(row(view, id).actions.map((a) => a.label)).toEqual(['Change']);
    }
  });

  it('opens the chosen client’s forms with what the client holds', () => {
    const view = reports(d, northwind, { client: GRANITEPEAK_SITE }, side);
    const { zones, ...schedule } = view.change!.schedule;
    expect(zones.map((z) => z.value)).toContain('America/Denver');
    expect({ ...view.change, schedule }).toEqual({
      id: 'change',
      title: 'Change Granite Peak Supply',
      host: 'granitepeak.example',
      client: {
        action: api(GRANITEPEAK_SITE, '/client'),
        method: 'PATCH',
        name: 'Granite Peak Supply',
        email: 'ops@granitepeak.example',
        seat: PRIYA,
        seats: [
          { value: '', label: 'none' },
          { value: ALEX, label: 'Alex (owner)' },
          { value: PRIYA, label: 'Priya (account manager)' },
          { value: LEE, label: 'Lee (developer)' },
        ],
      },
      schedule: {
        action: api(GRANITEPEAK_SITE),
        method: 'PUT',
        cadence: 'weekly',
        cadences: [
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly, on the first such weekday' },
        ],
        weekday: '1',
        weekdays: [
          { value: '1', label: 'Monday' },
          { value: '2', label: 'Tuesday' },
          { value: '3', label: 'Wednesday' },
          { value: '4', label: 'Thursday' },
          { value: '5', label: 'Friday' },
          { value: '6', label: 'Saturday' },
          { value: '7', label: 'Sunday' },
        ],
        time: '08:00',
        zone: 'America/Denver',
        unchanged: true,
        primary: true,
      },
      stop: {
        label: 'Stop the schedule',
        route: '/api/report-files/schedules/site/[siteId]',
        href: api(GRANITEPEAK_SITE),
        method: 'post',
        fields: { _method: 'DELETE' },
        primary: false,
        context: 'granitepeak.example',
      },
    });
  });

  it('starts a client with no schedule from weekly, Monday 08:00 in the account’s zone, and has nothing to stop', () => {
    const data = siteAs(HARBORLIGHT_SITE, {
      client_report: null,
      client_name: null,
      client_contact_email: null,
      owner_seat_id: null,
    });
    const change = reports(data, northwind, { client: HARBORLIGHT_SITE }).change!;
    expect(change.title).toBe('Change harborlight.example');
    expect(change.client).toMatchObject({ name: '', email: '', seat: '' });
    expect(change.schedule).toMatchObject({
      cadence: 'weekly',
      weekday: '1',
      time: '08:00',
      zone: 'America/Indiana/Indianapolis',
      unchanged: false,
    });
    expect(change.stop).toBeNull();
  });

  it('offers the zones the account’s own zone is chosen from, and the schedule’s own where it is another', () => {
    const offered = (data: FixtureDataset, client: string) =>
      reports(data, northwind, { client }).change!.schedule.zones.map((z) => z.value);
    const names = offered(d, GRANITEPEAK_SITE);
    expect(names).toEqual([...ZONES].sort((a, b) => a.localeCompare(b, 'en')));
    expect(names).toContain('UTC');
    expect(names.length).toBeGreaterThan(300);
    // A new schedule starts in the account's zone, which this runtime lists under another name.
    expect(ZONES.has('America/Indiana/Indianapolis')).toBe(false);
    const unscheduled = siteAs(HARBORLIGHT_SITE, { client_report: null });
    const withAlias = offered(unscheduled, HARBORLIGHT_SITE);
    expect(withAlias).toContain('America/Indiana/Indianapolis');
    expect(withAlias).toHaveLength(names.length + 1);
  });

  it('offers no zone that the contract or the schedule route refuses', () => {
    // The route takes names the contract does not ("Japan", "utc"); the form offers none of those.
    const fields = { cadence: 'weekly', isoWeekday: '1', timeLocal: '08:00' };
    for (const timezone of [...ZONES, 'America/Indiana/Indianapolis']) {
      expect(TimeZoneSchema.safeParse(timezone).success, timezone).toBe(true);
      expect(
        parseScheduleBody({ kind: 'form', fields: { ...fields, timezone } }),
        timezone,
      ).not.toBeNull();
    }
    expect(TimeZoneSchema.safeParse('Japan').success).toBe(false);
    expect(ZONES.has('Japan')).toBe(false);
  });

  it('offers as owning seat the accepted seats that cover the client', () => {
    const invited = edit((x) => ({
      seats: x.seats.map((s) => (s.id === LEE ? { ...s, accepted_at: null } : s)),
    }));
    // Sam's seat covers harborlight.example alone, and Lee has not accepted.
    expect(
      reports(invited, northwind, { client: GRANITEPEAK_SITE }).change!.client.seats!.map(
        (o) => o.value,
      ),
    ).toEqual(['', ALEX, PRIYA]);
  });

  it('leaves the owning seat out of the form when that seat no longer covers the client, so a save does not clear it', () => {
    // Priya owns granitepeak.example; her seat is narrowed to the other client, which leaves
    // `sites.owner_seat_id` as it is (`change_seat`). She is then not one of the seats the field
    // offers, and a select whose value is not an option posts its first one, "none".
    const narrowed = edit((x) => ({
      seats: x.seats.map((s) => (s.id === PRIYA ? { ...s, client_scope: [HARBORLIGHT_SITE] } : s)),
    }));
    expect(narrowed.sites.find((s) => s.id === GRANITEPEAK_SITE)!.owner_seat_id).toBe(PRIYA);
    const view = reports(narrowed, northwind, { client: GRANITEPEAK_SITE });
    expect(view.change!.client.seats).toBeNull();
    // The row still names the seat that owns the client.
    expect(row(view, GRANITEPEAK_SITE).seat).toBe('Priya (account manager)');
    // While the owning seat covers the client, or the client has none, the field is offered.
    const offered = (data: FixtureDataset) =>
      reports(data, northwind, { client: GRANITEPEAK_SITE }).change!.client.seats!.map(
        (o) => o.value,
      );
    expect(offered(d)).toEqual(['', ALEX, PRIYA, LEE]);
    expect(offered(siteAs(GRANITEPEAK_SITE, { owner_seat_id: null }, narrowed))).toEqual([
      '',
      ALEX,
      LEE,
    ]);
  });

  it('leaves the owning seat out of the form when the reader’s records do not hold it', () => {
    // Posted, the field would replace a seat the reader cannot see with one they can.
    const hidden = edit((x) => ({ seats: x.seats.filter((s) => s.id !== PRIYA) }));
    const change = reports(hidden, northwind, { client: GRANITEPEAK_SITE }).change!;
    expect(change.client.seats).toBeNull();
  });

  it('opens no forms for a client that is not one of the reader’s', () => {
    for (const client of [PINECREST, 'not-an-id', '']) {
      expect(reports(d, northwind, { client }).change).toBeNull();
    }
    expect(reports(d, northwind).change).toBeNull();
  });

  it('heads the page with the first client that has no schedule, until one is chosen', () => {
    expect(reports(d, northwind).header.action).toBeNull();
    const data = siteAs(HARBORLIGHT_SITE, { client_report: null });
    expect(reports(data, northwind).header.action).toMatchObject({
      label: 'Schedule a report for harborlight.example',
      href: `${BASE}?client=${HARBORLIGHT_SITE}#change`,
      method: 'get',
      primary: true,
    });
    // With a client chosen, the form's own submit is the page's one orange element.
    const chosen = reports(data, northwind, { client: HARBORLIGHT_SITE });
    expect(chosen.header.action).toBeNull();
    expect(chosen.change!.schedule.primary).toBe(true);
  });

  it('keeps the page a preview is on when it links to a client’s forms', () => {
    const view = agencyReportsView(
      siteAs(HARBORLIGHT_SITE, { client_report: null }),
      northwind,
      {},
      '/v2-preview/screens/agency/reports',
    );
    if (view.kind !== 'reports') throw new Error(view.kind);
    expect(view.header.action!.href).toBe(
      `/v2-preview/screens/agency/reports?client=${HARBORLIGHT_SITE}#change`,
    );
  });
});

describe('what a developer is shown', () => {
  const side = sideOf({ [HARBORLIGHT_SITE]: { confirmSentAt: '2026-10-31T15:00:00Z' } });
  const unscheduled = siteAs(HARBORLIGHT_SITE, { client_report: null });

  it('the rows, and no form, link to one or action', () => {
    for (const client of [undefined, GRANITEPEAK_SITE]) {
      const view = reports(unscheduled, as(LEE), client ? { client } : {}, side);
      expect(view.clients.rows).toHaveLength(2);
      expect(view.clients.rows.flatMap((r) => r.actions)).toEqual([]);
      expect(view.change).toBeNull();
      expect(view.header.action).toBeNull();
      expect(JSON.stringify(view)).not.toContain('/api/report-files/schedules');
    }
  });

  it('still reads each client’s contact, schedule and owning seat', () => {
    const view = reports(d, as(LEE), {}, side);
    expect(row(view, HARBORLIGHT_SITE)).toMatchObject({
      contact: { address: 'hello@harborlight.example', state: 'asked' },
      schedule: 'monthly, first Mon 08:00 their time',
      seat: 'Sam (account manager)',
    });
  });
});

describe('an account in its Agency trial', () => {
  const kestrel: Viewer = { accountId: KESTREL_ACCOUNT_ID, now: d.as_of };

  it('is told once where a report is sent while the trial runs', () => {
    const view = reports(d, kestrel);
    expect(view.trialNote).toContain('Agency trial');
    expect(view.trialNote).toContain('the account owner’s own address');
    expect(JSON.stringify(view).split(view.trialNote!)).toHaveLength(2);
  });

  it('no other account is told it', () => {
    expect(reports(d, northwind).trialNote).toBeNull();
  });

  // Kestrel's one client, with a schedule; the account's address is its owner's (Jo's).
  const scheduled = (contact: string) =>
    siteAs(PINECREST, { client_contact_email: contact, client_report: weekly });
  const owners = d.accounts.find((a) => a.id === KESTREL_ACCOUNT_ID)!.email;
  const labels = (view: ClientReportsView) => row(view, PINECREST).actions.map((a) => a.label);

  it('a contact that is not the owner’s own address is offered no ask, and its row says when it is asked', () => {
    expect(owners).toBe('jo@kestrel-creative.example');
    for (const sideOfIt of [
      sideOf({}),
      sideOf({ [PINECREST]: { confirmSentAt: '2026-11-02T11:58:00Z' } }),
    ]) {
      const view = reports(scheduled('client@pinecrest.example'), kestrel, {}, sideOfIt);
      expect(row(view, PINECREST).contact).toEqual({
        address: 'client@pinecrest.example',
        state: 'trial',
        mayAsk: true,
        label: 'asked to confirm once the trial has become the plan',
      });
      // Nothing is sent to it while the trial runs, so the row names no next run.
      expect(row(view, PINECREST).nextRun).toBe('none during the trial');
      expect(labels(view)).toEqual(['Change']);
    }
  });

  it('the owner’s own address is asked as on any account, whatever its capitals', () => {
    for (const contact of [owners, 'Jo@Kestrel-Creative.example']) {
      const view = reports(scheduled(contact), kestrel, {}, sideOf({}));
      expect(row(view, PINECREST).contact.state).toBe('not_asked');
      expect(labels(view)).toEqual(['Ask to confirm', 'Change']);
    }
    const asked = reports(
      scheduled(owners),
      kestrel,
      {},
      sideOf({ [PINECREST]: { confirmSentAt: '2026-11-02T11:58:00Z' } }),
    );
    expect(labels(asked)).toEqual(['Ask again', 'Change']);
  });

  it('the same outside contact on the plan is offered the ask', () => {
    const paid = siteAs(GRANITEPEAK_SITE, { client_contact_email: 'client@pinecrest.example' });
    const view = reports(paid, northwind, {}, sideOf({}));
    expect(row(view, GRANITEPEAK_SITE).contact.state).toBe('not_asked');
    expect(row(view, GRANITEPEAK_SITE).actions.map((a) => a.label)).toEqual([
      'Ask to confirm',
      'Change',
    ]);
  });
});

describe('the reports sent', () => {
  const html = (r: Report): Report => ({ ...r, format: 'html', byte_count: null });
  const sentAt = (r: Report, n: number): Report => {
    const at = new Date(Date.parse('2026-10-01T14:00:00Z') + n * 3_600_000).toISOString();
    return {
      ...html(r),
      id: `60000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
      created_at: at,
      scheduled_for: at,
      sent_at: at,
    };
  };
  const first = d.reports.find((r) => r.id === SENT_REPORT)!;

  it('lists a report that was sent, with when, the client and who it went to', () => {
    const view = reports(d, northwind);
    expect(view.sent.title).toBe('Sent');
    expect(view.sent.sub).toBe('1 of 1 shown, the newest first');
    expect(view.sent.rows).toEqual([
      {
        key: SENT_REPORT,
        // 14:00 UTC on 26 Oct is 10:00 in the account's zone.
        sent: 'Mon 26 Oct 10:00',
        host: 'granitepeak.example',
        to: 'ops@granitepeak.example',
        open: null,
      },
    ]);
  });

  it('does not list a report that is scheduled or held as sent', () => {
    // The fixture holds one of each for Northwind, beside the one sent.
    const waiting = d.reports.filter(
      (r) => r.kind === 'client_report' && (r.status === 'scheduled' || r.status === 'held'),
    );
    expect(waiting.map((r) => r.status).sort()).toEqual(['held', 'scheduled']);
    const keys = reports(d, northwind).sent.rows.map((r) => r.key);
    for (const r of waiting) expect(keys).not.toContain(r.id);
    // With the one sent report taken out there is nothing to list.
    const none = reports(
      edit((x) => ({ reports: x.reports.filter((r) => r.id !== SENT_REPORT) })),
      northwind,
    );
    expect(none.sent).toMatchObject({
      rows: [],
      empty: 'No report has been sent to a client yet.',
    });
  });

  it('a seat that covers some clients is told of its own clients, not of the account: what it reads is theirs alone', () => {
    // Sam's seat covers harborlight.example; the one report Northwind sent went to
    // granitepeak.example, which his session does not read (spec 31 §4).
    const sam = d.seats.find((s) => s.id === SAM)!;
    expect(sam.client_scope).toEqual([HARBORLIGHT_SITE]);
    expect(first.site_id).toBe(GRANITEPEAK_SITE);
    const read = edit((x) => ({
      sites: x.sites.filter((s) => s.id === HARBORLIGHT_SITE),
      reports: x.reports.filter((r) => r.site_id === HARBORLIGHT_SITE),
    }));
    const view = reports(read, as(SAM));
    expect(view.sent).toMatchObject({
      rows: [],
      empty: 'No report has been sent to a client in your seat yet.',
    });
    expect(view.header.line).toBe('1 monthly, of the client sites in your seat');
    // The owner, and a manager whose seat covers every client, read the account's.
    const all = edit((x) => ({ reports: x.reports.filter((r) => r.id !== SENT_REPORT) }));
    expect(reports(all, northwind).sent.empty).toBe('No report has been sent to a client yet.');
    expect(reports(d, northwind).header.line).toBe('1 weekly, 1 monthly');
    const unscoped = {
      ...all,
      seats: all.seats.map((x) => (x.id === SAM ? { ...x, client_scope: 'all' as const } : x)),
    };
    expect(reports(unscoped, as(SAM)).sent.empty).toBe('No report has been sent to a client yet.');
  });

  it('does not list a report of another kind, whatever its status', () => {
    const other: Report = {
      ...first,
      id: '60000000-0000-4000-8000-000000000299',
      kind: 'audit_pdf',
    };
    const view = reports(
      edit((x) => ({ reports: [...x.reports, other] })),
      northwind,
    );
    expect(view.sent.rows.map((r) => r.key)).toEqual([SENT_REPORT]);
  });

  it('lists the newest first, and says how many of how many it shows', () => {
    const many = Array.from({ length: SENT_SHOWN + 3 }, (_, n) => sentAt(first, n));
    const view = reports(
      edit((x) => ({ reports: [...many].reverse().concat(x.reports) })),
      northwind,
    );
    // The fixture's own sent report is of 26 Oct, later than each of these.
    expect(view.sent.rows).toHaveLength(SENT_SHOWN);
    expect(view.sent.sub).toBe(`${SENT_SHOWN} of ${SENT_SHOWN + 4} shown, the newest first`);
    expect(view.sent.rows[0]!.key).toBe(SENT_REPORT);
    expect(view.sent.rows[1]!.key).toBe(many.at(-1)!.id);
    expect(view.sent.rows.map((r) => r.key)).not.toContain(many[0]!.id);
  });

  it('opens a document at its page, when the page says its file is stored', () => {
    const data = edit((x) => ({
      reports: x.reports.map((r) => (r.id === SENT_REPORT ? html(r) : r)),
    }));
    const open = { label: 'Open', href: `/reports/${SENT_REPORT}`, method: 'get' };
    // A preview gives no file states: a document's row has its link.
    expect(reports(data, northwind).sent.rows[0]!.open).toMatchObject(open);
    expect(
      reports(data, northwind, {}, { fileStates: new Map([[SENT_REPORT, 'stored']]) }).sent.rows[0]!
        .open,
    ).toMatchObject(open);
    for (const fileStates of [new Map(), new Map([[SENT_REPORT, 'pending' as const]])]) {
      expect(reports(data, northwind, {}, { fileStates }).sent.rows[0]!.open).toBeNull();
    }
    // The fixture's own row is a PDF, which /reports/<id> does not open.
    expect(
      reports(d, northwind, {}, { fileStates: new Map([[SENT_REPORT, 'stored']]) }).sent.rows[0]!
        .open,
    ).toBeNull();
  });
});

describe('below Agency', () => {
  const pro: Viewer = ACCOUNT_VIEWERS.home();

  it('a Pro account gets the gate for client reports, from the gate messages, and no client', () => {
    const view = agencyReportsView(fixture('bad-site'), pro, {}, BASE);
    expect(view).toMatchObject({
      kind: 'gate',
      title: 'Client reports',
      message: gateMessage('clientReports', 'pro'),
      action: { href: '/pricing', primary: true },
    });
    expect(gateMessage('clientReports', 'pro')).toContain(`$${AGENCY_MONTHLY} a month`);
    expect(JSON.stringify(view)).not.toContain('/api/report-files');
  });

  it('a Free account, whose next plan has no client reports, is told what Agency is', () => {
    const view = agencyReportsView(fixture('clean-site'), ACCOUNT_VIEWERS.clean(), {}, BASE);
    expect(view).toMatchObject({ kind: 'gate', message: agencyGateMessage() });
  });

  it('a reader acting in another account with a seat on an agency gets the switch', () => {
    const view = agencyReportsView(
      fixture('bad-site'),
      pro,
      {},
      BASE,
      {},
      {
        accounts: [
          { id: BAD_ACCOUNT_ID, kind: 'personal', name: null },
          { id: NORTHWIND_ACCOUNT_ID, kind: 'agency', name: 'Northwind Digital' },
        ],
      },
    );
    expect(view).toMatchObject({ kind: 'open', agencies: [{ label: 'Open Northwind Digital' }] });
  });

  it('an Agency account gets the page', () => {
    expect(agencyReportsView(d, northwind, {}, BASE).kind).toBe('reports');
  });
});

describe('the frame', () => {
  it('is the agency rail with Reports marked, and the switcher for a person with two seats', () => {
    const view = agencyReportsView(
      d,
      northwind,
      {},
      BASE,
      {},
      {
        accounts: [
          { id: BAD_ACCOUNT_ID, kind: 'personal', name: null },
          { id: NORTHWIND_ACCOUNT_ID, kind: 'agency', name: 'Northwind Digital' },
        ],
      },
    );
    expect(view.shell.nav.filter((n) => n.current).map((n) => n.label)).toEqual(['Reports']);
    expect(view.shell.switcher?.current).toBe('Northwind Digital');
    expect(reports(d, northwind).shell.switcher).toBeNull();
  });

  it('gives a member who is not the owner no billing link', () => {
    expect(reports(d, northwind).shell.plan).toMatchObject({ billing: { href: '/settings/plan' } });
    expect(reports(d, as(LEE)).shell.plan).toMatchObject({ billing: null });
  });
});

describe('the routes the forms post to', () => {
  const APP = join(__dirname, '..', '..', '..', 'app');

  it.each(Object.entries(CLIENT_REPORT_ROUTES))('%s is a route that takes its verb', (_k, spec) => {
    const file = join(APP, ...spec.route.split('/').filter(Boolean), 'route.ts');
    expect(existsSync(file), file).toBe(true);
    const source = readFileSync(file, 'utf8');
    // A form posts, with the verb in `_method` where HTML has none.
    expect(source).toMatch(/export async function POST\(/);
    expect(source).toContain(`export async function ${spec.verb}(`);
  });
});
