/**
 * The account Changes log (D3) against values worked out by hand from bad-site at its as_of
 * (2026-10-30T10:05Z): eight changes on four sites (drivepei.ca has none), and six re-checks that
 * recorded no change (F-214): example-outfitter.com's checks …002 to …005, drivepei.ca's …020 and
 * the staging copy's deploy check …02a.
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
/** The check of bad-site's one first-audit finding, change …007. */
const firstAuditCheck = bad.changes.find((c) => c.id.endsWith('007'))!.check_id;

describe('the Changes log', () => {
  it('lists every change of the account, newest first, the site first, ties by id', () => {
    const v = log();
    // The last row is example-outfitter.com's first audit, one row for what it found (F-100). The
    // re-checks that changed nothing sit among the changes by when they finished.
    expect(ids(v)).toEqual([
      '001',
      '002',
      '003',
      '004',
      '005',
      '008',
      '020',
      '02a',
      '005',
      '004',
      '006',
      '003',
      '002',
      '001',
    ]);
    expect(v.rows.at(-1)!.key).toBe('first-audit-' + firstAuditCheck);
    expect(v.rows.map((r) => r.site)).toEqual([
      'example-outfitter.com',
      'example-outfitter.com',
      'example-outfitter.com',
      'example-outfitter.com',
      'nahltech.com',
      'redbirdaviation.com',
      'drivepei.ca',
      'staging.example-outfitter.dev',
      'example-outfitter.com',
      'example-outfitter.com',
      'staging.example-outfitter.dev',
      'example-outfitter.com',
      'example-outfitter.com',
      'example-outfitter.com',
    ]);
    // The headline counts changes, not the re-checks that found none.
    expect(v.headline).toBe('7 changes across 4 sites, newest first.');
    // The rail's "3 new": Claude-SearchBot, ClaudeBot (opened) and nahltech's orphans (resolved).
    expect(v.newNote).toBe('Three were opened or resolved at a site’s latest check.');
    expect(v.shell.nav.find((n) => n.current)!.label).toBe('Changes');
  });

  it('dates each row, since a log spans weeks: Sat 24 Oct 22:34 EDT for the first audit’s change', () => {
    // 2026-10-25T02:34Z is 22:34 EDT the evening before in Indiana (EDT, UTC−4).
    expect(log().rows.at(-1)!.when).toBe('Sat 24 Oct 22:34 EDT');
    expect(log().rows[0]!.when).toBe('Fri 30 Oct 06:02 EDT');
  });

  it('filters by kind, and says how many of how many match', () => {
    const v = log({ kind: 'opened' });
    expect(ids(v)).toEqual(['001', '002']);
    expect(v.headline).toBe('2 of 14 entries match: opened.');
    expect(v.newNote).toBeNull();
  });

  it('filters by site and by since, together', () => {
    const outfitter = '50000000-0000-4000-8000-000000000001';
    expect(ids(log({ site: outfitter }))).toEqual([
      '001',
      '002',
      '003',
      '004',
      '005',
      '004',
      '003',
      '002',
      '001',
    ]);
    // The last 24 hours from Fri 30 Oct 10:05Z: everything detected that morning, and the re-checks
    // that finished after 10:05Z on the 29th (…020 that morning, …02a at 22:23, …005 at 12:42).
    expect(ids(log({ since: '24h' }))).toEqual([
      '001',
      '002',
      '003',
      '004',
      '005',
      '008',
      '020',
      '02a',
      '005',
    ]);
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
    const none = log({ site: '50000000-0000-4000-8000-000000000004', kind: 'opened' });
    expect(none.rows).toEqual([]);
    expect(none.empty).toBe('No change matches these filters.');
    expect(ids(log({ site: 'not-a-site', kind: 'nonsense', since: 'forever' }))).toHaveLength(14);
    // A contract kind filters even on a day the account has none of it.
    const day0 = changesLogView(
      bad,
      { ...viewer, now: '2026-10-25T02:41:00Z' },
      { kind: 'baseline' },
      BASE,
    );
    // That day the account holds its first audit, which is a baseline row and not an opened one.
    expect(day0.rows.map((r) => r.kind)).toEqual(['baseline']);
    expect(kindLinks(day0).map((l) => [l.label, l.current])).toEqual([
      ['All kinds', false],
      ['baseline', true],
    ]);
    const opened = changesLogView(
      bad,
      { ...viewer, now: '2026-10-25T02:41:00Z' },
      { kind: 'opened' },
      BASE,
    );
    expect(opened.rows).toEqual([]);
  });

  it('reads a notification sent after now as not yet sent', () => {
    // 10:02:30Z: the morning's changes are found, their email goes out at 10:03 EDT.
    const early = changesLogView(bad, { ...viewer, now: '2026-10-30T10:02:30Z' }, {}, BASE);
    expect(early.rows.find((r) => r.key.endsWith('001'))!.told).toBe('nobody was notified');
    expect(log().rows[0]!.told).toBe('email and Slack #seo, Fri 30 Oct 06:03 EDT');
  });
});

describe('a first audit in the Changes log (F-100)', () => {
  const FIRST = bad.changes.find((c) => c.id.endsWith('007'))!;
  /** The fixture with `n` findings on one site's first audit and nothing after it. */
  function firstAuditOnly(n: number, sites = 1) {
    const siteIds = bad.sites.slice(0, sites).map((s) => s.id);
    const checks = siteIds.map((siteId, i) => ({
      ...bad.checks.find((c) => c.id === FIRST.check_id)!,
      id: `c0000000-0000-4000-8000-00000000000${i}`,
      site_id: siteId,
    }));
    const changes = checks.flatMap((check, s) =>
      Array.from({ length: n }, (_, i) => ({
        ...FIRST,
        id: `d0000000-0000-4000-8000-0000000${s}${String(i).padStart(4, '0')}`,
        site_id: check.site_id,
        check_id: check.id,
        summary: `finding ${i}`,
      })),
    );
    // Only these sites, each with this one check, so "nothing after it" is true of the account.
    return {
      ...bad,
      sites: bad.sites.filter((s) => siteIds.includes(s.id)),
      checks,
      changes,
      fixes: [],
      fix_events: [],
      reports: [],
    };
  }

  it('is one row for the site, saying how many issues it found', () => {
    const v = changesLogView(firstAuditOnly(26), viewer, {}, BASE);
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0]).toMatchObject({
      kind: 'baseline',
      summary: 'First audit: 26 issues found.',
      subject: null,
      where: 'the whole site',
      pages: null,
      effect: 'none',
      verdict: null,
      diff: [],
      cause: 'Nothing to compare yet. The next check of this site is compared with this one.',
    });
  });

  it('says one issue in the singular', () => {
    expect(changesLogView(firstAuditOnly(1), viewer, {}, BASE).rows[0]!.summary).toBe(
      'First audit: 1 issue found.',
    );
  });

  it('with only first audits, the headline does not call them changes', () => {
    expect(changesLogView(firstAuditOnly(20, 1), viewer, {}, BASE).headline).toBe(
      'One first audit. Changes appear once a site has been checked again.',
    );
    expect(changesLogView(firstAuditOnly(16, 5), viewer, {}, BASE).headline).toBe(
      'Five first audits. Changes appear once a site has been checked again.',
    );
  });

  it('once a site has been checked again, it no longer says the next check will compare', () => {
    const v = log();
    const row = v.rows.find((r) => r.key.startsWith('first-audit-'))!;
    expect(row.cause).toBe(
      'What the first audit found. Later changes are listed as their own rows.',
    );
  });

  it('two identical checks: a first audit, and no later change', () => {
    const d = firstAuditOnly(3, 1);
    const site = d.checks.find(
      (c) => c.previous_check_id === null && d.changes.some((x) => x.check_id === c.id),
    )!;
    const again = {
      ...site,
      id: 'c9000000-0000-4000-8000-000000000001',
      trigger: 'manual' as const,
      previous_check_id: site.id,
      queued_at: viewer.now,
      started_at: viewer.now,
      finished_at: viewer.now,
    };
    const v = changesLogView({ ...d, checks: [...d.checks, again] }, viewer, {}, BASE);
    expect(v.headline).toBe('One first audit. No later check has found a change.');
    expect(v.rows.map((r) => r.key)).toEqual([`check-${again.id}`, `first-audit-${site.id}`]);
    expect(v.rows[1]!.cause).toBe(
      'What the first audit found. Later changes are listed as their own rows.',
    );
  });

  /** `d` with a second, identical check of its `i`th first-audited site. */
  function checkedAgain(d: ReturnType<typeof firstAuditOnly>, i: number) {
    const site = d.sites[i]!;
    const first = d.checks.find((c) => c.site_id === site.id)!;
    const again = {
      ...first,
      id: `c9000000-0000-4000-8000-00000000000${i}`,
      trigger: 'manual' as const,
      previous_check_id: first.id,
      queued_at: viewer.now,
      started_at: viewer.now,
      finished_at: viewer.now,
    };
    return { ...d, checks: [...d.checks, again] };
  }

  it('one of five sites checked again, with no change: all five, and no later change', () => {
    const v = changesLogView(checkedAgain(firstAuditOnly(3, 5), 2), viewer, {}, BASE);
    expect(v.headline).toBe('Five first audits. No later check has found a change.');
  });

  it('a clean first audit has no row, and still counts as a first audit', () => {
    const d = firstAuditOnly(3, 5);
    const clean = d.checks.find((c) => c.site_id === d.sites[4]!.id)!;
    const v = changesLogView(
      { ...d, changes: d.changes.filter((c) => c.check_id !== clean.id) },
      viewer,
      {},
      BASE,
    );
    expect(v.rows).toHaveLength(4);
    expect(v.headline).toBe(
      'Five first audits. Changes appear once a site has been checked again.',
    );
  });

  it('counts only the sites with a change, not those with just a first audit', () => {
    const d = checkedAgain(firstAuditOnly(3, 2), 0);
    const later = d.checks.find((c) => c.previous_check_id !== null && c.id.startsWith('c9'))!;
    const real = {
      ...d.changes[0]!,
      id: 'd9000000-0000-4000-8000-000000000001',
      check_id: later.id,
      previous_check_id: later.previous_check_id,
      detected_at: viewer.now,
      summary: 'a real change',
    };
    const v = changesLogView({ ...d, changes: [...d.changes, real] }, viewer, {}, BASE);
    expect(v.headline).toBe('1 change across 1 site, newest first.');
  });

  it('five sites’ first audits are five rows, one each', () => {
    const v = changesLogView(firstAuditOnly(16, 5), viewer, {}, BASE);
    expect(v.rows).toHaveLength(5);
    expect(new Set(v.rows.map((r) => r.site)).size).toBe(5);
  });

  it('a change found by a later check stays its own row, and is counted as a change', () => {
    const v = log();
    expect(v.rows.filter((r) => r.summary.startsWith('First audit'))).toHaveLength(1);
    expect(v.rows.filter((r) => r.kind === 'opened').length).toBeGreaterThan(0);
    expect(v.headline).toBe('7 changes across 4 sites, newest first.');
  });

  it('a non-finding row of a first check (a deploy audited) is not folded in', () => {
    expect(log().rows.some((r) => r.key.endsWith('006'))).toBe(true);
  });

  it('the opened filter leaves first audits out, and the baseline filter finds them', () => {
    expect(log({ kind: 'opened' }).rows.some((r) => r.key.startsWith('first-audit-'))).toBe(false);
    expect(log({ kind: 'baseline' }).rows.map((r) => r.key)).toContain(
      'first-audit-' + firstAuditCheck,
    );
  });
});

describe('a site filter for a site outside the account (F-130)', () => {
  const OWN = '50000000-0000-4000-8000-000000000001';
  const SENTENCE = 'That site is not one you can see here, so the filter on it is not applied.';

  it('says so, and shows the account’s own changes', () => {
    const v = log({ site: 'e0000000-0000-4000-8000-000000000001' });
    expect(v.notice).toBe(SENTENCE);
    expect(v.rows).toHaveLength(log().rows.length);
  });

  it('answers the same for one id, another, and a malformed one', () => {
    const answers = [
      'e0000000-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-00000000abcd',
      'not-a-site',
    ].map((site) => {
      const { notice, rows, headline } = log({ site });
      return JSON.stringify({ notice, rows, headline });
    });
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).not.toContain('e0000000');
  });

  it('answers the same for a real site of another account as for an id that names nothing', () => {
    const FOREIGN = 'e0000000-0000-4000-8000-0000000000aa';
    const own = bad.sites.find((s) => s.id === OWN)!;
    const withForeign = {
      ...bad,
      sites: [
        ...bad.sites,
        {
          ...own,
          id: FOREIGN,
          account_id: 'a0000000-0000-4000-8000-0000000000ff',
          host: 'someone-else.example',
        },
      ],
    };
    const read = (site: string) => {
      const { notice, rows, headline, filters } = changesLogView(
        withForeign,
        viewer,
        { site },
        BASE,
      );
      return JSON.stringify({ notice, rows, headline, filters }).replaceAll(site, 'ID');
    };
    expect(read(FOREIGN)).toBe(read('f0000000-0000-4000-8000-00000000abcd'));
    expect(read(FOREIGN)).not.toContain('someone-else');
  });

  it('says nothing for a site of the account, with no filter, or with an empty one', () => {
    expect(log({ site: OWN }).notice).toBeNull();
    expect(log().notice).toBeNull();
    expect(log({ site: '' }).notice).toBeNull();
  });
});

describe('a re-check that recorded no change, in the Changes log (F-214)', () => {
  const DRIVEPEI = '50000000-0000-4000-8000-000000000004';
  const OUTFITTER = '50000000-0000-4000-8000-000000000001';
  const row = (v: ChangesLogView, check: string) =>
    v.rows.find((r) => r.key === `check-c0000000-0000-4000-8000-000000000${check}`);

  it('lists a scheduled check that changed nothing, as QA reproduced it on drivepei.ca', () => {
    const v = log({ site: DRIVEPEI });
    expect(v.rows).toHaveLength(1);
    // Check …020 finished 2026-10-30T10:01:05Z, 06:01 in Indiana; the first audit …01f at 19:11Z
    // on the 26th, 15:11. Neither read without-JavaScript, structure or content, so the diff
    // compared crawler access only.
    expect(v.rows[0]).toEqual({
      key: 'check-c0000000-0000-4000-8000-000000000020',
      site: 'drivepei.ca',
      when: 'Fri 30 Oct 06:01 EDT',
      kind: 'checked',
      pill: { state: 'neutral', label: 'checked' },
      summary: 'Scheduled check: no change in what both checks measured.',
      subject: null,
      where: 'the whole site',
      pages: null,
      effect: 'none',
      verdict: null,
      cause: 'Compared with the check of Mon 26 Oct 15:11 EDT.',
      diff: [],
      told: 'nobody was notified',
    });
    expect(v.headline).toBe('1 of 14 entries match: drivepei.ca.');
  });

  it('says nothing changed when both checks measured every section, and names each trigger', () => {
    const v = log({ site: OUTFITTER });
    // …002 finished 2026-10-26T13:14:10Z (09:14 EDT), compared with the first audit at 22:34 on the 24th.
    expect(row(v, '002')).toMatchObject({
      when: 'Mon 26 Oct 09:14 EDT',
      summary: 'Re-run: nothing changed.',
      cause: 'Compared with the check of Sat 24 Oct 22:34 EDT.',
    });
    expect(row(v, '004')).toMatchObject({
      when: 'Wed 28 Oct 16:04 EDT',
      summary: 'Re-check after a fix: nothing changed.',
      cause: 'Compared with the check of Tue 27 Oct 10:32 EDT.',
    });
  });

  it('is not a change of any kind: a kind filter leaves it out', () => {
    for (const kind of ['opened', 'resolved', 'changed', 'baseline']) {
      expect(log({ kind }).rows.filter((r) => r.kind === 'checked')).toEqual([]);
    }
  });

  it('lists only a finished or partial re-check: none for a failed one or a first audit', () => {
    const d = structuredClone(bad);
    const failed = d.checks.find((c) => c.id.endsWith('020'))!;
    failed.status = 'failed';
    const v = changesLogView(d, viewer, { site: DRIVEPEI }, BASE);
    expect(v.rows).toEqual([]);
    // drivepei.ca's first audit …01f changed nothing and found nothing.
    expect(log().rows.filter((r) => r.key.endsWith('01f'))).toEqual([]);
    const partial = structuredClone(bad);
    partial.checks.find((c) => c.id.endsWith('020'))!.status = 'partial';
    expect(changesLogView(partial, viewer, { site: DRIVEPEI }, BASE).rows).toHaveLength(1);
  });

  it('leaves out a re-check that recorded a change: its changes are its rows', () => {
    expect(log().rows.some((r) => r.key.endsWith('000000000006') && r.kind === 'checked')).toBe(
      false,
    );
  });

  it('is counted by the since filter at the time the check finished', () => {
    // From 2026-10-29T10:05Z: …005 finished at 12:42Z that day, …004 the day before.
    const v = log({ site: OUTFITTER, since: '24h' });
    expect(v.rows.filter((r) => r.kind === 'checked').map((r) => r.when)).toEqual([
      'Thu 29 Oct 08:42 EDT',
    ]);
    const week = log({ site: OUTFITTER, since: '7d' });
    expect(week.rows.filter((r) => r.kind === 'checked').map((r) => r.when)).toEqual([
      'Thu 29 Oct 08:42 EDT',
      'Wed 28 Oct 16:04 EDT',
      'Tue 27 Oct 10:32 EDT',
      'Mon 26 Oct 09:14 EDT',
    ]);
  });

  it('orders entries of one instant: a change, then re-checks by id', () => {
    const d = structuredClone(bad);
    const at = '2026-10-30T10:02:00Z'; // when …001 to …004 were found at …006
    for (const id of ['020', '005']) {
      d.checks.find((c) => c.id.endsWith(id))!.finished_at = at;
    }
    const keys = changesLogView(d, viewer, {}, BASE)
      .rows.slice(0, 6)
      .map((r) => r.key.slice(-3));
    expect(keys).toEqual(['001', '002', '003', '004', '005', '020']);
  });

  it('places a re-check by when it finished, not when it was queued', () => {
    const d = structuredClone(bad);
    // …004 queued 30 hours before now and finished 20 hours before it: inside the last 24 hours.
    const check = d.checks.find((c) => c.id.endsWith('004'))!;
    check.queued_at = '2026-10-29T04:05:00Z';
    check.started_at = '2026-10-29T04:05:00Z';
    check.finished_at = '2026-10-29T14:05:00Z';
    const v = changesLogView(d, viewer, { site: OUTFITTER, since: '24h' }, BASE);
    expect(v.rows.filter((r) => r.kind === 'checked').map((r) => r.key.slice(-3))).toEqual([
      '004',
      '005',
    ]);
  });

  it('says where a reopened fix was first seen, with its day (F-213)', () => {
    const d = structuredClone(bad);
    const change = d.changes.find((c) => c.id.endsWith('001'))!;
    change.cause = {
      text: 'Marked done on 2026-10-28, and found again on this check.',
      changed_at: null,
      diff: null,
    };
    d.fixes.find((f) => f.id === change.fix_id)!.first_seen_check_id =
      'c0000000-0000-4000-8000-000000000001';
    const row = changesLogView(d, viewer, {}, BASE).rows.find((r) => r.key === change.id)!;
    expect(row.cause).toBe(
      'First seen at the Sat 24 Oct 22:34 EDT check. What we found: Marked done on 2026-10-28, and found again on this check.',
    );
  });
});
