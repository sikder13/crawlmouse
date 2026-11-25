/**
 * F-276, review #2: the fix tables' first column is a row's place, so no fix table heads it "No." or
 * "#", which would label the place as a number beside the name "Fix 2". Each screen that lists fixes
 * by place is swept: the site page, the dashboard's top fixes, and each agency client page.
 */
import { JSDOM } from 'jsdom';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardScreen } from '../../components/v2/screens/dashboard/DashboardScreen';
import { SiteScreen } from '../../components/v2/screens/site/SiteScreen';
import {
  dashboardPreview,
  shellPreview,
  sitePreview,
} from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { CC31_ELEMENTS } from './_lib/screens';

// The client pages that list fixes: a client with none to raise draws no fixes table.
const CLIENTS = Object.entries(CC31_ELEMENTS).filter(
  ([path, el]) =>
    /\/agency\/client/.test(path) && renderToStaticMarkup(el()).includes('aria-label="Open fixes"'),
);

const SCREENS: [string, string, () => ReactElement][] = [
  ['site', 'Fixes', () => <SiteScreen data={sitePreview('home')} shell={shellPreview('home')} />],
  ['dashboard day0', 'Top fixes', () => <DashboardScreen data={dashboardPreview('day0')} />],
  ...CLIENTS.map(([path, el]) => [path, 'Open fixes', el] as [string, string, () => ReactElement]),
];

/** The column headers of the table labelled `label`, as text. */
function headers(el: ReactElement, label: string): string[] {
  const doc = new JSDOM(renderToStaticMarkup(el)).window.document;
  const table = [...doc.querySelectorAll('table')].find(
    (t) =>
      t.getAttribute('aria-label') === label || t.querySelector('caption')?.textContent === label,
  );
  if (!table) throw new Error(`no table labelled ${label}`);
  return [...table.querySelectorAll('thead th')].map((th) => th.textContent!.trim());
}

describe('the fix tables’ place column', () => {
  it('sweeps the site page, the dashboard and at least one client page', () => {
    expect(CLIENTS.length).toBeGreaterThan(0);
  });

  it.each(SCREENS)('%s: heads it "Order", never "No." or "#"', (_name, label, el) => {
    const heads = headers(el(), label);
    expect(heads[0]).toBe('Order');
    expect(heads.some((h) => h === 'No.' || h === '#')).toBe(false);
  });
});
