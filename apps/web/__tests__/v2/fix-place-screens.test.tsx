/**
 * F-276, QA gate B1 on #207: the dashboard's top fixes and the agency client page draw each row's
 * place, not its stored number, in the first cell. The lock fixtures have place = number, so these
 * render vectors where the two differ:
 * - the large-site shape, fix 2 at rank 1 and fix 1 at rank 9: the dashboard's first row is place 1,
 *   named "Fix 2";
 * - the agency client whose done fix ranks first: its one fix to raise holds place 2, named "Fix 1".
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { JSDOM } from 'jsdom';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClientScreen } from '../../components/v2/screens/agency/ClientScreen';
import { DashboardScreen } from '../../components/v2/screens/dashboard/DashboardScreen';
import { ACCOUNT_VIEWERS } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { GRANITEPEAK_SITE } from '../../app/(v2-preview)/v2-preview/_preview/agency';
import { fixesAsOf, fixture } from '../../lib/v2/fixtures';
import { agencyClientView } from '../../lib/v2/view/agency-client';
import { dashboardView } from '../../lib/v2/view/dashboard';

const SITE = '50000000-0000-4000-8000-000000000001';

/** The bad site, its fixes re-ranked at its first audit so that fix 2 is rank 1 and fix 1 rank 9. */
function largeVector(): FixtureDataset {
  const d = structuredClone(fixture('bad-site'));
  const first = d.checks
    .filter((c) => c.site_id === SITE && c.trigger === 'first_audit')
    .sort((a, b) => Date.parse(a.finished_at!) - Date.parse(b.finished_at!))[0]!;
  const live = fixesAsOf(d, first);
  const one = live.find((f) => f.number === 1)!;
  const two = live.find((f) => f.number === 2)!;
  const others = live.filter((f) => f !== one && f !== two);
  const order = [two, ...others.slice(0, 7), one, ...others.slice(7)];
  order.forEach((f, i) => (d.fixes.find((x) => x.id === f.id)!.rank = i + 1));
  return d;
}

/** The first two cells of each body row of the table labelled `label`, as text. */
function cells(el: ReactElement, label: string): string[][] {
  const doc = new JSDOM(renderToStaticMarkup(el)).window.document;
  const table = doc.querySelector(`table[aria-label="${label}"]`);
  if (!table) throw new Error(`no table labelled ${label}`);
  return [...table.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.children].slice(0, 2).map((c) => c.textContent!.trim()),
  );
}

describe('the dashboard’s top fixes, where place and number differ', () => {
  it('the first row reads 1, named Fix 2', () => {
    const data = dashboardView(largeVector(), ACCOUNT_VIEWERS.day0());
    const rows = cells(<DashboardScreen data={data} />, 'Top fixes');
    expect(rows.map((r) => r[0])).toEqual(['1', '2', '3']);
    expect(rows[0]![1]!.startsWith('Fix 2 · ')).toBe(true);
  });
});

describe('the agency client page, where place and number differ', () => {
  it('its one fix to raise reads 2, its place on the site page, named Fix 1', () => {
    const d = structuredClone(fixture('challenged-site'));
    const mine = d.fixes.filter((f) => f.site_id === GRANITEPEAK_SITE);
    const done = mine.find((f) => f.status === 'marked_done')!;
    const other = mine.find((f) => f !== done)!;
    [done.rank, other.rank] = [1, 2];
    expect(other.number).toBe(1);
    const view = agencyClientView(d, ACCOUNT_VIEWERS.withheld(), GRANITEPEAK_SITE)!;
    if (view.kind !== 'client') throw new Error(`client page kind ${view.kind}`);
    const rows = cells(<ClientScreen data={view} />, 'Open fixes');
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('2');
    expect(rows[0]![1]!.startsWith('Fix 1 · ')).toBe(true);
  });
});
