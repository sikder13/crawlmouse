/**
 * F-276 (D-13, CTO 081, option C): rows stay in rank order; the first column is the row's place in
 * the list (1, 2, 3 …); the fix's stored number is its name ("Fix 2"), never its order. The vector
 * is QA's hand-counted large site: fix 1 at rank 9, fix 2 at rank 1, so the first row is place 1,
 * named "Fix 2".
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixesAsOf, fixture } from '../fixtures';
import { agencyClientView } from './agency-client';
import { dashboardView } from './dashboard';
import { fixView } from './fix';
import { siteView } from './site';
import { ordinalWord } from '../words';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';

import { GRANITEPEAK_SITE as GRANITEPEAK } from '../../../app/(v2-preview)/v2-preview/_preview/agency';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const SITE = '50000000-0000-4000-8000-000000000001';

/** The bad site, its live fixes re-ranked so that fix 2 is rank 1 and fix 1 is rank 9. */
function largeVector(): FixtureDataset {
  const d = structuredClone(fixture('bad-site'));
  const latest = d.checks
    .filter((c) => c.site_id === SITE && c.finished_at)
    .sort((a, b) => Date.parse(b.finished_at!) - Date.parse(a.finished_at!))[0]!;
  const live = fixesAsOf(d, latest);
  const one = live.find((f) => f.number === 1)!;
  const two = live.find((f) => f.number === 2)!;
  const others = live.filter((f) => f !== one && f !== two);
  const order = [two, ...others.slice(0, 7), one, ...others.slice(7)];
  order.forEach((f, i) => (d.fixes.find((x) => x.id === f.id)!.rank = i + 1));
  expect(order.indexOf(one) + 1).toBe(9);
  return d;
}

describe('the site page’s fixes table', () => {
  const d = largeVector();
  // A crawler fix's button names its crawlers, not a number; here every fix is a numbered one.
  for (const f of d.fixes) f.crawler_uas = [];
  const v = siteView(d, { accountId: ACCOUNT, now: d.as_of }, SITE, undefined, { allFixes: true });

  it('numbers its rows 1, 2, 3 … in rank order; the first is named "Fix 2", the ninth "Fix 1"', () => {
    const rows = v.fixes.rows;
    expect(rows.map((r) => r.place)).toEqual(rows.map((_, i) => i + 1));
    expect(rows[0]).toMatchObject({ place: 1, name: 'Fix 2' });
    expect(rows[8]).toMatchObject({ place: 9, name: 'Fix 1' });
  });

  it('the main button names the place of the row it opens, then that fix’s name', () => {
    const button = v.header.actions.find((a) => a.primary)!.label;
    const m = /^Open the (\w+) fix · (Fix \d+)/.exec(button);
    expect(m, button).not.toBeNull();
    const row = v.fixes.rows.find((r) => r.name === m![2])!;
    expect(m![1]).toBe(ordinalWord(row.place));
  });

  it('folds the rows past the fold by place', () => {
    const folded = siteView(d, { accountId: ACCOUNT, now: d.as_of }, SITE).fixes;
    const shown = folded.rows.length;
    expect(folded.rows.map((r) => r.place)).toEqual(folded.rows.map((_, i) => i + 1));
    expect(folded.rest!.numbers).toBe(`${shown + 1}–${shown + folded.rest!.count}`);
  });
});

describe('the ordinal words', () => {
  it('spell the places a button names', () => {
    expect([1, 2, 3, 9, 10, 12, 13, 21, 22, 23, 111].map(ordinalWord)).toEqual([
      'first',
      'second',
      'third',
      'ninth',
      'tenth',
      'twelfth',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '111th',
    ]);
  });
});

describe('the fix page', () => {
  it('names the fix and gives its place separately, even where they match', () => {
    const d = largeVector();
    const check = d.checks
      .filter((c) => c.site_id === SITE && c.finished_at)
      .sort((a, b) => Date.parse(b.finished_at!) - Date.parse(a.finished_at!))[0]!;
    const live = fixesAsOf(d, check);
    const two = live.find((f) => f.number === 2)!;
    const atOwnPlace = live.find((f, i) => f.number === i + 1);
    const label = (id: string) => fixView(d, check.id, id, { plan: 'pro' }).frame.position;
    expect(label(two.id)).toBe(`Fix 2 · 1 of ${live.length}`);
    if (atOwnPlace) {
      const k = live.indexOf(atOwnPlace) + 1;
      expect(label(atOwnPlace.id)).toBe(`Fix ${k} · ${k} of ${live.length}`);
    }
  });
});

describe('the dashboard’s top fixes', () => {
  it('give places from 1, each named by its fix, and the start button names the first by place', () => {
    const d = largeVector();
    const first = d.checks
      .filter((c) => c.site_id === SITE && c.trigger === 'first_audit')
      .sort((a, b) => Date.parse(a.finished_at!) - Date.parse(b.finished_at!))[0]!;
    const dash = dashboardView(d, ACCOUNT_VIEWERS.day0());
    const top = dash.topFixes!;
    expect(top.rows.map((r) => r.place)).toEqual(top.rows.map((_, i) => i + 1));
    const lead = fixesAsOf(d, first)[0]!;
    expect(top.rows[0]!.name).toBe(`Fix ${lead.number}`);
    const start = dash.header.actions.find((a) => a.primary)!.label;
    expect(start.startsWith(`Start with the first fix · Fix ${lead.number}`)).toBe(true);
  });
});

describe('the agency client page', () => {
  it('numbers its own rows from 1, each named by its fix', () => {
    const d = structuredClone(fixture('challenged-site'));
    // The fix not to raise (marked done) ranks first, so the site page's place of the one to raise
    // is 2, and the client page's own list starts it at 1.
    const mine = d.fixes.filter((f) => f.site_id === GRANITEPEAK);
    const done = mine.find((f) => f.status === 'marked_done')!;
    const other = mine.find((f) => f !== done)!;
    [done.rank, other.rank] = [1, 2];
    const v = agencyClientView(d, ACCOUNT_VIEWERS.withheld(), GRANITEPEAK)!;
    if (v.kind !== 'client') throw new Error(`client page kind ${v.kind}`);
    const rows = v.fixes.rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.place)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.every((r) => /^Fix \d+$/.test(r.name))).toBe(true);
  });
});
