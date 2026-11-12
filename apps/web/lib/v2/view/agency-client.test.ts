/**
 * The client page's view model against challenged-site's Northwind Digital: granitepeak.example
 * (fix 1 could not be verified, fix 2 is marked done, AI readability withheld) and
 * harborlight.example (no fix), and Kestrel Creative's client before its first result.
 */
import type { FixtureDataset, Seat } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import {
  GRANITEPEAK_SITE,
  HARBORLIGHT_SITE,
  KESTREL_ACCOUNT_ID,
  PRIYA_SEAT,
} from '../../../app/(v2-preview)/v2-preview/_preview/agency';
import { fixture } from '../fixtures';
import type { Viewer } from './account';
import { agencyClientView, type ClientView } from './agency-client';
import { siteView } from './site';

const d = fixture('challenged-site');
const northwind: Viewer = ACCOUNT_VIEWERS.withheld();
const ALEX = 'e0000000-0000-4000-8000-0000000000c9';
const LEE = 'e0000000-0000-4000-8000-0000000000cc';
const PINECREST = '50000000-0000-4000-8000-0000000000cb';

const client = (data: FixtureDataset, viewer: Viewer, siteId: string): ClientView => {
  const view = agencyClientView(data, viewer, siteId);
  if (view?.kind !== 'client') throw new Error(`expected a client page, got ${view?.kind}`);
  return view;
};
const edit = (over: (x: FixtureDataset) => Partial<FixtureDataset>): FixtureDataset => ({
  ...d,
  ...over(d),
});
const siteAs = (id: string, over: Partial<FixtureDataset['sites'][number]>) =>
  edit((x) => ({ sites: x.sites.map((s) => (s.id === id ? { ...s, ...over } : s)) }));

describe('the client page', () => {
  const view = client(d, northwind, GRANITEPEAK_SITE);
  const site = siteView(d, northwind, GRANITEPEAK_SITE);

  it('is headed by the client’s name, then the host and the site page’s own line and actions', () => {
    expect(view.header.title).toBe('Granite Peak Supply');
    expect(view.header.line).toBe(`granitepeak.example · ${site.header.line}`);
    expect(view.header.actions).toEqual(site.header.actions);
    expect(
      client(siteAs(GRANITEPEAK_SITE, { client_name: null }), northwind, GRANITEPEAK_SITE),
    ).toMatchObject({ header: { title: 'granitepeak.example' } });
  });

  it('gives the site page’s two grades and their moves, without the parts under each', () => {
    expect(view.grades.cards.map((c) => [c.label, c.letter, c.score, c.move])).toEqual([
      ['Technical SEO', 'C+', 66, '−1 since Sat'],
      ['AI readability', null, null, null],
    ]);
    expect(view.grades.cards.map((c) => c.parts)).toEqual([null, null]);
    expect(site.grades.cards[0].parts).not.toBeNull();
    // A withheld grade keeps the reason it is withheld.
    expect(view.grades.cards[1].withheld).toBe(site.grades.cards[1].withheld);
    expect(view.grades.cards[1].withheld).toContain('edge blocks all automation');
    expect(view.grades.site.href).toBe(`/sites/${GRANITEPEAK_SITE}`);
  });

  it('lists the fixes still to do, as the site page’s own rows, and counts them', () => {
    // Fix 1 could not be verified, so it is still to raise; fix 2 is marked done, so it is not.
    expect(view.fixes.title).toBe('Open fixes · 1 to raise');
    expect(view.fixes.rows).toEqual(site.fixes.rows.filter((r) => r.number === 1));
    expect(view.fixes.rows[0]!.packet.href).toMatch(/^\/audit\/[^/]+\/fix\/[^/]+$/);
    expect(view.fixes).toMatchObject({ more: null, empty: null });
  });

  it('says so when nothing is open', () => {
    expect(client(d, northwind, HARBORLIGHT_SITE).fixes).toEqual({
      title: 'Open fixes · 0 to raise',
      rows: [],
      more: null,
      empty: 'Nothing is open to raise with this client.',
    });
  });

  it('points to the site page for the fixes its table does not show', () => {
    // The site page shows five fixes; with seven open, two are on the site page alone.
    const one = d.fixes.find((f) => f.site_id === GRANITEPEAK_SITE && f.number === 1)!;
    const many = edit((x) => ({
      fixes: [
        ...x.fixes,
        ...[11, 12, 13, 14, 15, 16].map((n) => ({
          ...one,
          id: `f0000000-0000-4000-8000-0000000000${n}`,
          number: n,
          rank: n,
        })),
      ],
    }));
    const v = client(many, northwind, GRANITEPEAK_SITE);
    expect(v.fixes.title).toBe('Open fixes · 7 to raise');
    expect(v.fixes.more).toMatchObject({
      label: `${7 - v.fixes.rows.length} more on the site page`,
      href: `/sites/${GRANITEPEAK_SITE}`,
    });
    expect(v.fixes.rows.length).toBeLessThan(7);
  });

  it('says what the agency holds about the client: contact, report, owning seat', () => {
    expect(view.client.rows.map((r) => [r.label, r.value, r.mono])).toEqual([
      ['Contact', 'Jordan · ops@granitepeak.example', true],
      ['Report', 'weekly, Mon 08:00 their time', false],
      ['Seat', 'Priya (account manager)', false],
    ]);
    expect(client(d, northwind, HARBORLIGHT_SITE).client.rows.map((r) => r.value)).toEqual([
      'Rosa · hello@harborlight.example',
      'monthly, first Mon 08:00 their time',
      'Sam (account manager)',
    ]);
  });

  it('says none where the client has no contact, report or seat, and when the recipient paused it', () => {
    const bare = siteAs(GRANITEPEAK_SITE, {
      client_contact_name: null,
      client_contact_email: null,
      client_report: null,
      owner_seat_id: null,
    });
    expect(client(bare, northwind, GRANITEPEAK_SITE).client.rows.map((r) => r.value)).toEqual([
      'none',
      'not scheduled',
      'none',
    ]);
    const report = d.sites.find((s) => s.id === GRANITEPEAK_SITE)!.client_report!;
    const paused = siteAs(GRANITEPEAK_SITE, {
      client_report: { ...report, paused_by_recipient_at: '2026-11-01T12:00:00Z' },
    });
    expect(client(paused, northwind, GRANITEPEAK_SITE).client.rows[1]!.value).toBe(
      'weekly, Mon 08:00 their time · paused by the recipient',
    );
  });

  it('does not name a seat the reader’s records do not hold', () => {
    const hidden = edit((x) => ({ seats: x.seats.filter((s: Seat) => s.id !== PRIYA_SEAT) }));
    expect(client(hidden, northwind, GRANITEPEAK_SITE).client.rows[2]!.value).toBe(
      'a seat yours is not shown',
    );
  });

  it('offers each change to the roles the Guard column gives it', () => {
    const changes = (seatId: string) =>
      client(d, { ...northwind, seatId }, GRANITEPEAK_SITE).client.rows.map(
        (r) => r.change?.href ?? null,
      );
    expect(changes(ALEX)).toEqual(['/agency/reports', '/agency/reports', '/seats']);
    // An account manager edits and sends client reports; seats are the owner's.
    expect(changes(PRIYA_SEAT)).toEqual(['/agency/reports', '/agency/reports', null]);
    expect(changes(LEE)).toEqual([null, null, null]);
  });

  it('sits under Clients on the agency rail', () => {
    expect(view.shell.nav.filter((n) => n.current).map((n) => n.label)).toEqual(['Clients']);
  });
});

describe('what is not a client page', () => {
  it('a site the reader’s records do not hold, and a staging copy, have none', () => {
    expect(agencyClientView(d, northwind, PINECREST)).toBeNull();
    expect(agencyClientView(d, northwind, '50000000-0000-4000-8000-00000000ffff')).toBeNull();
    const copy = siteAs(HARBORLIGHT_SITE, { staging_of_site_id: GRANITEPEAK_SITE });
    expect(agencyClientView(copy, northwind, HARBORLIGHT_SITE)).toBeNull();
    expect(agencyClientView(copy, northwind, GRANITEPEAK_SITE)).not.toBeNull();
  });

  it('a client with no result yet reads as its site page does, on the agency rail', () => {
    const kestrel: Viewer = { accountId: KESTREL_ACCOUNT_ID, now: d.as_of };
    const view = agencyClientView(d, kestrel, PINECREST);
    expect(view).toMatchObject({
      kind: 'first_check',
      first: { title: 'pinecrest.example', state: 'queued' },
    });
    if (view?.kind !== 'first_check') throw new Error('expected the first check');
    expect(view.first.shell.nav.filter((n) => n.current).map((n) => n.label)).toEqual(['Clients']);
  });
});
