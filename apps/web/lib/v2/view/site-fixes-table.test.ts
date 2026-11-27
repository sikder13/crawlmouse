/**
 * F-099: the site page's fixes table lists what the tier opens first, agrees with what Free opens,
 * offers no packet it would refuse, and "Show all" shows all. On bad-site's example-outfitter.com the
 * live fixes in rank order are numbers 1, 2, 0, 3, 5, 4, then 6 to 15: sixteen, and Free opens the
 * first three of that order.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { siteView, wantsAllFixes } from './site';

const BAD = 'a0000000-0000-4000-8000-000000000001';
const SITE = '50000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');
const viewer = ACCOUNT_VIEWERS.home();

const onFree = (d: FixtureDataset = bad): FixtureDataset => ({
  ...d,
  accounts: d.accounts.map((a) =>
    a.id === BAD
      ? {
          ...a,
          state: 'free' as const,
          trial_ends_at: null,
          state_history: [{ state: 'free' as const, since: '2026-10-01T00:00:00.000Z' }],
        }
      : a,
  ),
});

/** The site's fixes with `rank` moved: number 7 becomes the largest, so Free opens 7, 1 and 2. */
const sevenFirst = (d: FixtureDataset): FixtureDataset => ({
  ...d,
  fixes: d.fixes.map((f) => (f.site_id !== SITE ? f : f.number === 7 ? { ...f, rank: 0 } : f)),
});

describe('on Pro', () => {
  const t = () => siteView(bad, viewer, SITE).fixes;

  it('lists the fixes in impact order, by the engine’s rank', () => {
    expect(t().rows.map((r) => r.number)).toEqual([1, 2, 0, 3, 5]);
  });

  it('does not mark any row as Pro, and every row has its packet', () => {
    expect(t().rows.every((r) => !r.pro && !r.status.includes('Pro'))).toBe(true);
    expect(t().rows.every((r) => r.packet !== null)).toBe(true);
    expect(t().rest!.status).toBe('open');
  });

  it('names the places it folds (F-276: places, not the fixes’ numbers)', () => {
    expect(t().rest).toMatchObject({ numbers: '6–16', count: 11 });
  });
});

describe('on Free', () => {
  const view = (d = onFree()) => siteView(d, viewer, SITE);

  it('lists the three it opens first, even when a locked fix has a lower number', () => {
    expect(view(onFree(sevenFirst(bad))).fixes.rows.map((r) => [r.number, r.pro])).toEqual([
      [7, false],
      [1, false],
      [2, false],
      [0, true],
      [3, true],
    ]);
  });

  it('names the places it folds, one run after the rows shown (F-276)', () => {
    expect(view(onFree(sevenFirst(bad))).fixes.rest).toMatchObject({
      numbers: '6–16',
      count: 11,
      status: 'open · Pro',
    });
  });

  it('offers no packet or Mark done on a locked row', () => {
    const rows = view().fixes.rows;
    expect(rows.filter((x) => x.pro).map((r) => r.number)).toEqual([3, 5]);
    for (const r of rows.filter((x) => x.pro)) {
      expect(r.packet).toBeNull();
      expect(r.markDone).toBeNull();
      expect(r.status).toBe('open · Pro');
    }
    for (const r of rows.filter((x) => !x.pro)) expect(r.packet).not.toBeNull();
  });

  it('never points the main button at a fix Free does not open', () => {
    // Fix 5, past Free's three, is made the only fix new at the latest check.
    const first = bad.checks
      .filter((c) => c.site_id === SITE && c.finished_at !== null)
      .sort((x, y) => Date.parse(x.finished_at!) - Date.parse(y.finished_at!));
    const latest = first.filter((c) => c.status !== 'failed').at(-1)!;
    const fiveIsNew = onFree({
      ...bad,
      fixes: bad.fixes.map((f) =>
        f.site_id !== SITE
          ? f
          : {
              ...f,
              first_seen_check_id: f.number === 5 ? latest.id : first[0]!.id,
            },
      ),
    });
    const fixOne = bad.fixes.find((f) => f.site_id === SITE && f.number === 1)!;
    const primary = siteView(fiveIsNew, viewer, SITE).header.actions.find((a) => a.primary)!;
    expect(primary.href).toContain(fixOne.id);
  });
});

describe('the folded row', () => {
  it('is not used to fold a single fix', () => {
    const live = new Set([0, 1, 2, 3, 4, 5]);
    const six: FixtureDataset = {
      ...bad,
      fixes: bad.fixes.filter((f) => f.site_id !== SITE || live.has(f.number)),
    };
    const t = siteView(six, viewer, SITE).fixes;
    expect(t.rows.map((r) => r.number)).toEqual([1, 2, 0, 3, 5, 4]);
    expect(t.rest).toBeNull();
  });

  it('opens up to every fix on "Show all"', () => {
    const t = siteView(bad, viewer, SITE, undefined, { allFixes: true }).fixes;
    expect(t.rows).toHaveLength(16);
    expect(t.rest).toBeNull();
  });

  it('reads "Show all" from the address it links to', () => {
    const show = siteView(bad, viewer, SITE).fixes.rest!.show;
    const query = Object.fromEntries(new URL(show.href!, 'https://x.test').searchParams);
    expect(wantsAllFixes(query)).toBe(true);
    expect(wantsAllFixes({})).toBe(false);
    expect(wantsAllFixes({ fixes: ['all', 'all'] })).toBe(false);
    expect(wantsAllFixes({ fixes: 'some' })).toBe(false);
  });

  it('is read by the live page', () => {
    const page = readFileSync(join(process.cwd(), 'app/sites/[id]/page.tsx'), 'utf8');
    expect(page).toMatch(/allFixes:\s*wantsAllFixes\(query\)/);
  });
});
