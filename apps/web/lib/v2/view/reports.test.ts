/**
 * Reports and exports (Final-Reports) against values worked out by hand: bad-site at its as_of
 * (Fri 30 Oct 10:05Z, EDT), Northwind's Agency account at challenged-site's (Mon 2 Nov 12:00Z,
 * EST after the 1 Nov change), and the stand-in Free account.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWERS,
  CLEAN_VIEWER,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '../../billing/prices';
import { gateMessage } from '../agency/gates';
import { fixture } from '../fixtures';
import { reportsView, SHARE_LINK_DAYS, type ReportsSide } from './reports';

const bad = fixture('bad-site');
const BASE = '/v2-preview/screens/reports';
const home = (q = {}) => reportsView(bad, ACCOUNT_VIEWERS.home(), q, BASE);
const northwind = () =>
  reportsView(fixture('challenged-site'), ACCOUNT_VIEWERS.withheld(), {}, BASE);

describe('Reports, the header and Make a report', () => {
  it('counts the sites, names the plan exports are on, and the trial’s days in the account’s zone', () => {
    expect(home().header.line).toBe('5 sites · exports and PDF on Pro · 8 days of Pro left');
  });

  it('makes reports for the primary site’s latest check by default', () => {
    const m = home().make;
    expect(m.sub).toBe('For example-outfitter.com, latest check Fri 30 Oct 06:02');
    expect(m.sites.map((o) => o.label)).toEqual([
      'example-outfitter.com',
      'nahltech.com',
      'redbirdaviation.com',
      'drivepei.ca',
      'staging.example-outfitter.dev',
    ]);
    expect(m.selected).toBe('50000000-0000-4000-8000-000000000001');
    expect(m.compare.text).toBe(
      'Thu 29 vs Fri 30 Oct. What moved and why, with the evidence for each change.',
    );
    expect(m.pdf.text).toBe('Grades, crawler table, every open fix, the link map’s figures.');
    expect(m.pdf.action).toMatchObject({
      label: 'Make the PDF',
      href: '/api/reports',
      method: 'post',
      primary: true,
      fields: {
        siteId: '50000000-0000-4000-8000-000000000001',
        checkId: 'c0000000-0000-4000-8000-000000000006',
        kind: 'audit_pdf',
      },
    });
    expect(m.raw.actions.map((a) => [a.label, a.fields.kind, a.fields.format])).toEqual([
      ['CSV', 'raw_export', 'csv'],
      ['JSON', 'raw_export', 'json'],
      ['Link map', 'raw_export', 'edge_list'],
    ]);
  });

  it('follows the site the page’s query picks, and ignores one the account does not hold', () => {
    const m = home({ site: '50000000-0000-4000-8000-000000000002' }).make;
    expect(m.sub).toMatch(/^For nahltech\.com, latest check /);
    expect(m.pdf.action!.fields.siteId).toBe('50000000-0000-4000-8000-000000000002');
    expect(home({ site: 'elsewhere' }).make.selected).toBe('50000000-0000-4000-8000-000000000001');
  });
});

describe('Reports made', () => {
  it('lists the account’s reports newest first, without the public audit link (owner ruling 7)', () => {
    // bad-site's four reports: the weekly PDF, a compare, a CSV and the public link of 24 Oct.
    expect(
      home().made.rows.map((r) => [
        r.made,
        r.site,
        r.type,
        r.covers,
        r.actions.map((a) => a.label),
      ]),
    ).toEqual([
      [
        'Fri 30 Oct 06:04',
        'example-outfitter.com',
        'PDF audit report',
        'check of Fri 30 Oct · made by the weekly check',
        ['Download · 1.2 MB', 'Link'],
      ],
      [
        'Thu 29 Oct 09:40',
        'example-outfitter.com',
        'Compare',
        'Sat 24 Oct vs Thu 29 Oct',
        ['Open', 'Link'],
      ],
      // The share link of 25 Oct 07:10Z expires 24 Nov 07:10Z, Tue 24 Nov 02:10 in Indiana (EST).
      [
        'Sun 25 Oct 03:10',
        'example-outfitter.com',
        'CSV, all responses',
        'first audit',
        ['Download · 310 KB', 'New link', 'Withdraw link'],
      ],
    ]);
  });

  it('a report that has a link says until when as text; replacing the link and withdrawing it are the two actions', () => {
    const [pdf, , csv] = home().made.rows;
    // The status is not a control: no action is labelled with the expiry.
    expect(csv!.linkUntil).toBe('Link · until Tue 24 Nov');
    expect(csv!.actions.map((a) => [a.label, a.method, a.fields])).toEqual([
      ['Download · 310 KB', 'get', {}],
      ['New link', 'post', {}],
      ['Withdraw link', 'post', { _method: 'DELETE' }],
    ]);
    for (const row of home().made.rows) {
      expect(row.actions.map((a) => a.label).join(' ')).not.toContain('until');
    }
    // A report with no link has nothing to state, and its one share action makes the first.
    expect([pdf!.linkUntil, pdf!.actions.map((a) => a.label)]).toEqual([
      null,
      ['Download · 1.2 MB', 'Link'],
    ]);
  });

  it('opens a proof page at /reports/<id>, downloads a file from its route, and posts the share forms to the share route', () => {
    const [pdf, compare, csv] = home().made.rows;
    const routes = (r: typeof pdf) => r!.actions.map((a) => [a.method, a.href, a.fields]);
    expect(routes(pdf)).toEqual([
      ['get', '/api/report-files/60000000-0000-4000-8000-000000000001/download', {}],
      ['post', '/api/report-files/60000000-0000-4000-8000-000000000001/share', {}],
    ]);
    expect(routes(compare)).toEqual([
      ['get', '/reports/60000000-0000-4000-8000-000000000002', {}],
      ['post', '/api/report-files/60000000-0000-4000-8000-000000000002/share', {}],
    ]);
    expect(routes(csv)).toEqual([
      ['get', '/api/report-files/60000000-0000-4000-8000-000000000003/download', {}],
      ['post', '/api/report-files/60000000-0000-4000-8000-000000000003/share', {}],
      [
        'post',
        '/api/report-files/60000000-0000-4000-8000-000000000003/share',
        { _method: 'DELETE' },
      ],
    ]);
    for (const row of home().made.rows) {
      expect([row.state, row.madeLink]).toEqual([null, null]);
    }
  });

  it('words the share link and the gate from constants', () => {
    expect(SHARE_LINK_DAYS).toBe(30);
    // Every share link the fixtures hold lasts exactly that long.
    for (const d of [bad, fixture('challenged-site')]) {
      for (const r of d.reports.filter((x) => x.share_expires_at)) {
        expect(Date.parse(r.share_expires_at!) - Date.parse(r.created_at)).toBe(
          SHARE_LINK_DAYS * 86_400_000,
        );
      }
    }
    expect(home().made.sub).toBe(
      'Kept with the account; a share link to one expires after 30 days',
    );
    expect(home().made.foot).toBe(
      'Files stay here; a share link to one works for 30 days and needs no account to open. Making new reports and raw-data exports is Pro; what is listed here stays downloadable. The public audit link on each site page is free.',
    );
  });

  it('on Pro, schedules nothing and says client reports are Agency’s', () => {
    const s = home().scheduled;
    expect(s.rows).toEqual([]);
    expect(s.sub).toBe('None');
    expect(s.foot).toBe(gateMessage('clientReports', 'pro'));
    expect(s.foot).toBe(
      `Reports sent to a client are made on Agency. Agency is ${usd(AGENCY_MONTHLY)} a month.`,
    );
    expect(s.compare).toMatchObject({ label: 'Compare plans', href: '/pricing' });
  });
});

describe('how long a share link works', () => {
  it('is the interval create_share_link adds to the moment it is made, in days', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../../../infra/supabase/migrations/20261114000002_v2_031_agency.sql',
      ),
      'utf8',
    );
    const create = /create or replace function public\.create_share_link[\s\S]*?\n\$\$;/.exec(
      sql,
    )![0];
    // The one interval of the function: the link's expiry, which the row and the report both get.
    expect([...create.matchAll(/interval '([^']+)'/g)].map((m) => m[1])).toEqual([
      `${SHARE_LINK_DAYS} days`,
    ]);
    expect(create).toMatch(/v_expires := p_now \+ interval '\d+ days';/);
    // The screen's two sentences state that number and no other.
    const said = [home().made.sub, home().made.foot].join(' ');
    expect(said.match(/\d+ days/g)).toEqual([`${SHARE_LINK_DAYS} days`, `${SHARE_LINK_DAYS} days`]);
  });
});

describe('Reports, on Northwind’s Agency account (challenged-site)', () => {
  it('lists what was made and sent, and schedules the held and the coming client reports', () => {
    const v = northwind();
    expect(v.header.line).toBe('2 sites · exports and PDF on Agency');
    expect(v.make.sub).toBe('For harborlight.example, latest check Fri 30 Oct 06:01');
    expect(v.make.pdf.text).toBe('Grades, crawler table, every open fix, the link map’s figures.');
    expect(v.made.rows.map((r) => [r.made, r.site, r.type, r.covers])).toEqual([
      ['Sat 31 Oct 11:01', 'harborlight.example', 'Link map, edge list', 'check of Fri 30 Oct'],
      ['Sat 31 Oct 11:00', 'harborlight.example', 'JSON, all responses', 'check of Fri 30 Oct'],
      [
        'Mon 26 Oct 09:55',
        'granitepeak.example',
        'Client report',
        'first audit · sent to ops@granitepeak.example',
      ],
      ['Sat 24 Oct 10:20', 'granitepeak.example', 'Prospect one-pager', 'first audit'],
    ]);
    expect(v.scheduled.rows.map((r) => [r.when, r.site, r.type, r.to, r.status])).toEqual([
      [
        'Mon 2 Nov 09:00',
        'harborlight.example',
        'Client report',
        'hello@harborlight.example',
        'scheduled',
      ],
      [
        'Mon 2 Nov 10:00',
        'granitepeak.example',
        'Client report',
        'ops@granitepeak.example',
        'held back',
      ],
    ]);
    expect(v.scheduled.sub).toBe('2 reports to send');
    // The fixture's account records a sender of its own. No mail is sent from it (Branding is not
    // in this step: D11), so the foot names none.
    const sender = fixture('challenged-site').accounts.find((a) => a.branding?.sender_email)!
      .branding!.sender_email!;
    expect(sender).toBe('reports@northwind-digital.example');
    expect(v.scheduled.foot).toBe(
      'Client reports are sent for you weekly or monthly, to each client’s contact.',
    );
    expect(JSON.stringify(v.scheduled)).not.toContain(sender);
    expect(v.scheduled.compare).toBeNull();
  });
});

describe('Reports, read by a seat that covers some of the account’s clients', () => {
  const d = fixture('challenged-site');
  const NORTHWIND = ACCOUNT_VIEWERS.withheld().accountId;
  const seat = (name: string) => d.seats.find((s) => s.name === name)!;
  const sam = seat('Sam');
  const [harborlight] = sam.client_scope as string[];
  /** What Sam's session reads of Northwind (spec 31 §4): his one client, and what is recorded of it. */
  const samReads = (over: Partial<typeof d> = {}) => {
    const checks = new Set(d.checks.filter((c) => c.site_id === harborlight).map((c) => c.id));
    return {
      ...d,
      sites: d.sites.filter((s) => s.id === harborlight),
      checks: d.checks.filter((c) => checks.has(c.id)),
      fixes: d.fixes.filter((f) => f.site_id === harborlight),
      fix_events: [],
      changes: d.changes.filter((c) => checks.has(c.check_id)),
      reports: d.reports.filter((r) => r.site_id === harborlight),
      seats: d.seats.filter((s) => s.id === sam.id || s.role === 'owner'),
      ...over,
    };
  };
  const as = (seatId: string, data = samReads()) =>
    reportsView(data, { ...ACCOUNT_VIEWERS.withheld(), seatId }, {}, BASE);

  it('counts its sites as the seat’s, and its reports to send as theirs: the account has more of both', () => {
    expect(sam.client_scope).toHaveLength(1);
    const clients = d.sites.filter((s) => s.account_id === NORTHWIND);
    expect(clients).toHaveLength(2);
    const v = as(sam.id);
    expect(v.header.line).toBe('1 site in your seat · exports and PDF on Agency');
    expect(v.scheduled.rows.map((r) => r.site)).toEqual(['harborlight.example']);
    expect(v.scheduled.sub).toBe('1 report to send for the sites in your seat');
    // The account, as a seat that covers every client reads it.
    const whole = reportsView(
      d,
      { ...ACCOUNT_VIEWERS.withheld(), seatId: seat('Lee').id },
      {},
      BASE,
    );
    expect([seat('Lee').role, seat('Lee').client_scope]).toEqual(['developer', 'all']);
    expect(whole.header.line).toBe('2 sites · exports and PDF on Agency');
    expect(whole.scheduled.sub).toBe('2 reports to send');
    expect(as(seat('Alex').id, d).header.line).toBe(whole.header.line);
  });

  it('says of nothing made, nothing to send and no site that it is so for the seat’s sites', () => {
    const empty = as(sam.id, samReads({ reports: [] }));
    expect(empty.made.empty).toBe('No reports yet for the sites in your seat.');
    expect(empty.scheduled.sub).toBe('None for the sites in your seat');
    const noSite = as(
      sam.id,
      samReads({ sites: [], checks: [], fixes: [], changes: [], reports: [] }),
    );
    expect(noSite.header.line).toBe('0 sites in your seat · exports and PDF on Agency');
    expect(noSite.make.sub).toBe(
      'No site is in your seat yet: reports are made from a site’s checks.',
    );
    // The same records read by the owner are the account's, and are said of it.
    const owner = as(seat('Alex').id, samReads({ reports: [] }));
    expect(owner.made.empty).toBe('No reports yet.');
    expect(owner.scheduled.sub).toBe('None');
    expect(
      as(seat('Alex').id, samReads({ sites: [], checks: [], fixes: [], changes: [], reports: [] }))
        .make.sub,
    ).toBe('No sites yet: reports are made from a site’s checks.');
  });

  it('a preview, which names no seat, reads as the owner', () => {
    expect(northwind().header.line).toBe('2 sites · exports and PDF on Agency');
  });
});

describe('Reports, on the stand-in Free account', () => {
  it('offers the plans instead of making anything', () => {
    const v = reportsView(fixture('clean-site'), CLEAN_VIEWER, {}, BASE);
    expect(v.header.line).toBe('1 site · exports and PDF are Pro');
    expect(v.make.pdf.action).toMatchObject({
      label: 'Compare plans',
      href: '/pricing',
      method: 'get',
    });
    expect(v.make.raw.actions).toEqual([]);
    expect(v.made.rows).toEqual([]);
    expect(v.made.empty).toBe('No reports yet.');
  });

  it('says which plan makes reports, in the gate’s words; a plan that makes them says nothing', () => {
    const free = reportsView(fixture('clean-site'), CLEAN_VIEWER, {}, BASE);
    expect(free.make.gate).toBe(gateMessage('exports', 'free'));
    expect(free.make.gate).toBe(
      `Reports and exports are made on Pro. Pro is ${usd(PRO_MONTHLY)} a month.`,
    );
    expect(free.scheduled.foot).toBe(gateMessage('clientReports', 'pro'));
    expect(home().make.gate).toBeNull();
    expect(northwind().make.gate).toBeNull();
  });
});

describe('Reports, with what a live page knows', () => {
  const PDF = '60000000-0000-4000-8000-000000000001';
  const COMPARE = '60000000-0000-4000-8000-000000000002';
  const CSV = '60000000-0000-4000-8000-000000000003';
  const live = (side: ReportsSide) => reportsView(bad, ACCOUNT_VIEWERS.home(), {}, BASE, side);
  const row = (v: ReturnType<typeof live>, id: string) => v.made.rows.find((r) => r.key === id)!;
  const labels = (v: ReturnType<typeof live>, id: string) => row(v, id).actions.map((a) => a.label);

  it('a pending report and a failed one say so and offer nothing; a stored one is offered', () => {
    const v = live({
      fileStates: new Map([
        [PDF, 'pending'],
        [COMPARE, 'failed'],
        [CSV, 'stored'],
      ]),
    });
    expect([row(v, PDF).state, labels(v, PDF)]).toEqual(['Being made', []]);
    expect([row(v, COMPARE).state, labels(v, COMPARE)]).toEqual(['Could not be made', []]);
    expect([row(v, CSV).state, labels(v, CSV)]).toEqual([
      null,
      ['Download · 310 KB', 'New link', 'Withdraw link'],
    ]);
  });

  it('a client report that was mailed opens, and is offered no new link: its link is the mail’s, which may be withdrawn', () => {
    // The comparison's row as a client report the schedule sent, its mailed link still open.
    const mailed = {
      ...bad,
      reports: bad.reports.map((r) =>
        r.id === COMPARE
          ? { ...r, kind: 'client_report' as const, share_expires_at: '2026-11-24T09:00:00Z' }
          : r,
      ),
    };
    const v = reportsView(mailed, ACCOUNT_VIEWERS.home(), {}, BASE, {
      fileStates: new Map([[COMPARE, 'stored']]),
    });
    expect(labels(v, COMPARE)).toEqual(['Open', 'Withdraw link']);
    expect(row(v, COMPARE).linkUntil).toBe('Link · until Tue 24 Nov');
    // The same row as a comparison is offered the link itself.
    const plain = live({ fileStates: new Map([[COMPARE, 'stored']]) });
    expect(labels(plain, COMPARE)).toContain('Link');
  });

  it('with the file states given, a report they do not name has no file to offer, whatever its row says', () => {
    const v = live({ fileStates: new Map([[CSV, 'stored']]) });
    expect([row(v, PDF).state, labels(v, PDF)]).toEqual([null, []]);
    expect([row(v, COMPARE).state, labels(v, COMPARE)]).toEqual([null, []]);
    expect(row(v, PDF).linkUntil).toBeNull();
  });

  it('a developer gets the file and no share form, and a rail without the owner’s billing; an account manager shares', () => {
    const v = live({ role: 'developer' });
    expect(labels(v, PDF)).toEqual(['Download · 1.2 MB']);
    expect(labels(v, COMPARE)).toEqual(['Open']);
    expect(labels(v, CSV)).toEqual(['Download · 310 KB']);
    expect(row(v, CSV).linkUntil).toBe('Link · until Tue 24 Nov');
    expect(labels(live({ role: 'account_manager' }), PDF)).toEqual(['Download · 1.2 MB', 'Link']);
    expect(v.shell).toEqual(
      reportsView(bad, ACCOUNT_VIEWERS.home(), {}, BASE, {
        role: 'account_manager',
      }).shell,
    );
    expect(v.shell).not.toEqual(home().shell);
  });

  it('shows a link just made on its own report’s row and no other', () => {
    const url = 'https://crawlmouse.com/s/kJ8sT2mQ9x_p4VnR7bWc-A';
    const v = live({ madeLink: { reportId: COMPARE, url } });
    expect(row(v, COMPARE).madeLink).toEqual({
      label: 'The link, shown here for a short while:',
      url,
    });
    expect([row(v, PDF).madeLink, row(v, CSV).madeLink]).toEqual([null, null]);
    const pending = live({
      madeLink: { reportId: COMPARE, url },
      fileStates: new Map([[COMPARE, 'pending']]),
    });
    expect(row(pending, COMPARE).madeLink).toBeNull();
  });
});

describe('Reports, a share link after it expires', () => {
  it('shows the link while it works and not once it has expired; off the plan it can be withdrawn and not remade', () => {
    // The CSV's link expires 24 Nov 07:10Z; read a second before and at that moment. By then the
    // account's Pro trial has ended, so it is on Free: no new link, and the one it has is stated.
    const at = (now: string) => {
      const row = reportsView(
        bad,
        { accountId: 'a0000000-0000-4000-8000-000000000001', now },
        {},
        BASE,
      ).made.rows.find((r) => r.type === 'CSV, all responses')!;
      return [row.actions.map((a) => a.label), row.linkUntil];
    };
    expect(at('2026-11-24T07:09:59Z')).toEqual([
      ['Download · 310 KB', 'Withdraw link'],
      'Link · until Tue 24 Nov',
    ]);
    expect(at('2026-11-24T07:10:00Z')).toEqual([['Download · 310 KB'], null]);
  });
});

describe('Reports, the compare form', () => {
  it('posts the latest two results of the site: the latest as checkId, the one before as previousCheckId', () => {
    expect(home().make.compare.action).toMatchObject({
      label: 'Compare these two',
      href: '/api/reports',
      fields: {
        siteId: '50000000-0000-4000-8000-000000000001',
        checkId: 'c0000000-0000-4000-8000-000000000006',
        kind: 'compare',
        previousCheckId: 'c0000000-0000-4000-8000-000000000005',
      },
      context: 'Thu 29 vs Fri 30 Oct',
    });
  });
});
