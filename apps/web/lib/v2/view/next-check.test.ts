/**
 * The next scheduled check, as the live dashboard and site page show it (CC-28 D8): the scheduler's
 * own column, `sites.next_check_at`, passed in by the page, and no time computed here. It is shown
 * only for a site the scheduler claims: not paused, and on Free only the first site (Q4). A preview
 * passes no column (fixtures hold none) and keeps its weekly stand-in.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { dashboardView } from './dashboard';
import { siteView, type NextChecks } from './site';

const BAD_ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const OUTFITTER = '50000000-0000-4000-8000-000000000001';
const NAHLTECH = '50000000-0000-4000-8000-000000000002';
const bad = fixture('bad-site');
const home = { accountId: BAD_ACCOUNT, now: bad.as_of };
// After the no-card trial ended (8 Nov): the account is on Free.
const free = { accountId: BAD_ACCOUNT, now: '2026-11-09T12:00:00Z' };

// 11:37 UTC is 06:37 in Indianapolis (UTC−5 after 1 Nov): a minute the weekly stand-in, which
// reads only the saved hour, could not produce.
const AT = '2026-11-13T11:37:00.000Z';
const next = (entries: [string, string | null][]): NextChecks => new Map(entries);

describe('the dashboard’s header', () => {
  it('names the column’s time for the first site, with no cadence it cannot vouch for', () => {
    const line = dashboardView(bad, home, next([[OUTFITTER, AT]])).header.line;
    expect(line).toContain('next check Fri 13 Nov around 06:37');
    expect(line).not.toContain('weekly');
  });

  it('says nothing of a next check when the column is null', () => {
    expect(dashboardView(bad, home, next([[OUTFITTER, null]])).header.line).not.toContain('next');
  });

  it('without the column (a preview) keeps the weekly stand-in', () => {
    expect(dashboardView(bad, home).header.line).toContain('next weekly check');
  });

  it('on Free still names the first site’s, which the scheduler runs monthly', () => {
    expect(dashboardView(bad, free, next([[OUTFITTER, AT]])).header.line).toContain(
      'next check Fri 13 Nov around 06:37',
    );
  });
});

describe('the site page’s header', () => {
  it('names the column’s time for a site of a paid tier', () => {
    expect(siteView(bad, home, NAHLTECH, next([[NAHLTECH, AT]])).header.line).toContain(
      'next Fri 13 Nov around 06:37',
    );
  });

  it('names none for a paused site, whatever the column holds', () => {
    const d = structuredClone(bad);
    d.sites.find((s) => s.id === NAHLTECH)!.paused = true;
    expect(siteView(d, home, NAHLTECH, next([[NAHLTECH, AT]])).header.line).not.toContain('next');
  });

  it('on Free names none for a site after the first: it waits, unchecked', () => {
    expect(siteView(bad, free, NAHLTECH, next([[NAHLTECH, AT]])).header.line).not.toContain('next');
    expect(siteView(bad, free, OUTFITTER, next([[OUTFITTER, AT]])).header.line).toContain(
      'next Fri 13 Nov around 06:37',
    );
  });

  it('a site the map does not name has no next check', () => {
    expect(siteView(bad, home, NAHLTECH, next([])).header.line).not.toContain('next');
  });
});

describe('a next check already due (N2)', () => {
  // The column left in the past: a site the global ceiling or CRAWL_PAUSED left waiting.
  const past = new Date(Date.parse(bad.as_of) - 2 * 86_400_000).toISOString();

  it('reads as due now on the dashboard, with no time in the past', () => {
    const line = dashboardView(bad, home, next([[OUTFITTER, past]])).header.line;
    expect(line).toContain('next check due now');
    expect(line).not.toContain('around');
  });

  it('reads as due now on the site page, at the column’s exact instant too', () => {
    expect(siteView(bad, home, NAHLTECH, next([[NAHLTECH, past]])).header.line).toContain(
      'next due now',
    );
    expect(siteView(bad, home, NAHLTECH, next([[NAHLTECH, bad.as_of]])).header.line).toContain(
      'next due now',
    );
  });

  it('a time still ahead is named as before', () => {
    const ahead = new Date(Date.parse(bad.as_of) + 60_000).toISOString();
    expect(siteView(bad, home, NAHLTECH, next([[NAHLTECH, ahead]])).header.line).not.toContain(
      'due now',
    );
  });
});
