/**
 * The account Changes log (D3) against values worked out by hand from bad-site at its as_of
 * (2026-10-30T10:05Z): eight changes on four sites (drivepei.ca has none).
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { changesLogView, CHANGES_LOG_SINCE, type ChangesLogView } from './changes-log';

const links = (i: number) => (v: ChangesLogView) => v.filters[i]!.links;
const siteLinks = links(0);
const kindLinks = links(1);
const sinceLinks = links(2);

const bad = fixture('bad-site');
const viewer = { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of };
const BASE = '/v2-preview/screens/changes-log';
const log = (query: Record<string, string> = {}) => changesLogView(bad, viewer, query, BASE);
const ids = (v: ReturnType<typeof log>) => v.rows.map((r) => r.key.slice(-3));

describe('the Changes log', () => {
  it('lists every change of the account, newest first, the site first, ties by id', () => {
    const v = log();
    expect(ids(v)).toEqual(['001', '002', '003', '004', '005', '008', '006', '007']);
    expect(v.rows.map((r) => r.site)).toEqual([
      'example-outfitter.com',
      'example-outfitter.com',
      'example-outfitter.com',
      'example-outfitter.com',
      'nahltech.com',
      'redbirdaviation.com',
      'staging.example-outfitter.dev',
      'example-outfitter.com',
    ]);
    expect(v.headline).toBe('8 changes across 4 sites, newest first.');
    // The rail's "3 new": Claude-SearchBot, ClaudeBot (opened) and nahltech's orphans (resolved).
    expect(v.newNote).toBe('Three are new since each site’s previous check.');
    expect(v.shell.nav.find((n) => n.current)!.label).toBe('Changes');
  });

  it('dates each row, since a log spans weeks: Sat 24 Oct 22:34 for the first audit’s change', () => {
    // 2026-10-25T02:34Z is 22:34 the evening before in Indiana (EDT, UTC−4).
    expect(log().rows.at(-1)!.when).toBe('Sat 24 Oct 22:34');
    expect(log().rows[0]!.when).toBe('Fri 30 Oct 06:02');
  });

  it('filters by kind, and says how many of how many match', () => {
    const v = log({ kind: 'opened' });
    expect(ids(v)).toEqual(['001', '002', '007']);
    expect(v.headline).toBe('3 of 8 changes match: opened.');
    expect(v.newNote).toBeNull();
  });

  it('filters by site and by since, together', () => {
    const outfitter = '50000000-0000-4000-8000-000000000001';
    expect(ids(log({ site: outfitter }))).toEqual(['001', '002', '003', '004', '007']);
    // The last 24 hours from Fri 30 Oct 10:05Z: everything detected that morning.
    expect(ids(log({ since: '24h' }))).toEqual(['001', '002', '003', '004', '005', '008']);
    expect(ids(log({ site: outfitter, since: '24h', kind: 'changed' }))).toEqual(['003', '004']);
  });

  it('offers the kinds the account’s changes hold, and every site, as links that keep the other filters', () => {
    const v = log({ kind: 'opened' });
    expect(kindLinks(v).map((l) => l.label)).toEqual([
      'All kinds',
      'opened',
      'resolved',
      'changed',
      'baseline',
    ]);
    expect(kindLinks(v).find((l) => l.current)!.label).toBe('opened');
    expect(siteLinks(v).map((l) => l.label)).toEqual([
      'All sites',
      'example-outfitter.com',
      'nahltech.com',
      'redbirdaviation.com',
      'drivepei.ca',
      'staging.example-outfitter.dev',
    ]);
    const nahl = siteLinks(v).find((l) => l.label === 'nahltech.com')!;
    expect(nahl.href).toBe(`${BASE}?site=50000000-0000-4000-8000-000000000002&kind=opened`);
    expect(kindLinks(v)[0]!.href).toBe(BASE);
    expect(sinceLinks(v).map((l) => l.label)).toEqual(CHANGES_LOG_SINCE.map((s) => s.label));
  });

  it('says when nothing matches, and ignores a value outside the account or the contract', () => {
    const none = log({ site: '50000000-0000-4000-8000-000000000004' });
    expect(none.rows).toEqual([]);
    expect(none.empty).toBe('No change matches these filters.');
    expect(ids(log({ site: 'not-a-site', kind: 'nonsense', since: 'forever' }))).toHaveLength(8);
    // A contract kind filters even on a day the account has none of it.
    const day0 = changesLogView(
      bad,
      { ...viewer, now: '2026-10-25T02:41:00Z' },
      { kind: 'baseline' },
      BASE,
    );
    expect(day0.rows).toEqual([]);
    expect(kindLinks(day0).map((l) => [l.label, l.current])).toEqual([
      ['All kinds', false],
      ['opened', false],
      ['baseline', true],
    ]);
  });

  it('reads a notification sent after now as not yet sent', () => {
    // 10:02:30Z: the morning's changes are found, their email goes out at 10:03.
    const early = changesLogView(bad, { ...viewer, now: '2026-10-30T10:02:30Z' }, {}, BASE);
    expect(early.rows.find((r) => r.key.endsWith('001'))!.told).toBe('nobody was notified');
    expect(log().rows[0]!.told).toBe('email and Slack #seo, Fri 30 Oct 06:03');
  });
});
