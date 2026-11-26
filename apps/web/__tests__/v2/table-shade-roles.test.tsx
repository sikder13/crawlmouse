/**
 * The Table's two opt-ins (PR 2 review, items 2 and 7): the scroll shade and the explicit ARIA roles
 * render only where a screen asks for them. The public pages ask for neither, so their tables'
 * markup is what it was (OPERATING-RULES §13); the dashboard's sites table and the site page's
 * settings table, which a phone lays out as grids, carry the roles.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { Table } from '../../components/v2/Table';
import { PricingScreen } from '../../components/v2/screens/pricing/PricingScreen';
import { DashboardScreen } from '../../components/v2/screens/dashboard/DashboardScreen';
import { SiteScreen } from '../../components/v2/screens/site/SiteScreen';
import { PublicReportPreview } from '../../app/(v2-preview)/v2-preview/_preview/PublicReportPreview';
import { pricingSignedOut } from '../../app/(v2-preview)/v2-preview/_preview/pricing';
import {
  dashboardPreview,
  shellPreview,
  sitePreview,
} from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { homeElement } from './_lib/screens';

const doc = (el: ReactElement) => new JSDOM(renderToStaticMarkup(el)).window.document;
const shaded = (d: Document) => d.querySelectorAll('[class*="_shade_"]').length;
const roled = (d: Document) => d.querySelectorAll('table [role], table[role]').length;

describe('the public pages’ tables are as they were', () => {
  it.each([
    ['/', () => homeElement()],
    ['/pricing', () => <PricingScreen view={pricingSignedOut()} />],
    ['/r/', () => <PublicReportPreview name="bad-site" />],
  ] as const)('%s: no table shade and no added role', (_, el) => {
    const d = doc(el());
    expect(d.querySelectorAll('table').length).toBeGreaterThan(0);
    expect(shaded(d)).toBe(0);
    expect(roled(d)).toBe(0);
  });

  it('a Table given neither opt-in renders its scroll region, table and cells without them', () => {
    const html = renderToStaticMarkup(
      <Table label="T" columns={[{ header: 'A' }]} rows={[{ key: 'r', cells: ['x'] }]} />,
    );
    expect(html).not.toMatch(/_shade_|role="(table|rowgroup|row|columnheader|cell|rowheader)"/);
    expect(html).toContain('<td>x</td>');
  });
});

describe('the app’s tables opt in', () => {
  it('the dashboard’s tables shade, and its sites table names its rows, headers and cells', () => {
    const d = doc(<DashboardScreen data={dashboardPreview('home')} />);
    expect(shaded(d)).toBeGreaterThan(0);
    const sites = d.querySelector('table[aria-label="Watched sites"]')!;
    expect(sites.getAttribute('role')).toBe('table');
    expect(
      [...sites.querySelectorAll('thead [role="columnheader"]')].map((h) => h.textContent),
    ).toEqual([
      'Site',
      'Technical SEO',
      'AI readability',
      'Since last crawl',
      'Schedule',
      'Last check',
    ]);
    const row = sites.querySelector('tbody tr')!;
    expect(row.getAttribute('role')).toBe('row');
    expect([...row.children].map((c) => c.getAttribute('role'))).toEqual([
      'rowheader',
      'cell',
      'cell',
      'cell',
      'cell',
      'cell',
    ]);
  });

  it('the site page’s settings table carries the same roles', () => {
    const d = doc(<SiteScreen data={sitePreview('home')} shell={shellPreview('home')} />);
    const settings = d.querySelector('table[aria-label="Site settings"]')!;
    expect(settings.getAttribute('role')).toBe('table');
    const row = settings.querySelector('tbody tr')!;
    expect(row.getAttribute('role')).toBe('row');
    expect([...row.children].map((c) => c.getAttribute('role'))).toEqual([
      'rowheader',
      'cell',
      'cell',
    ]);
  });
});

describe('the shade is laid over the region, never behind its text (CI run 45600609996, axe)', () => {
  const css = readFileSync(
    join(__dirname, '..', '..', 'components', 'v2', 'Table.module.css'),
    'utf8',
  );
  const rule = (sel: string) => css.match(new RegExp(`\\n${sel} \\{([^}]*)\\}`))![1]!;

  it('no rule on the wrapper or the scroll region paints a background behind the cells', () => {
    expect(rule('\\.shade')).not.toMatch(/background/);
    expect(rule('\\.scroll')).not.toMatch(/background/);
  });

  it('the two strips take no pointer events and sit beside the region, not around its table', () => {
    expect(rule('\\.edgeStart,\\n\\.edgeEnd')).toMatch(/pointer-events: none;/);
    const d = doc(<DashboardScreen data={dashboardPreview('home')} />);
    const wrap = d.querySelector('[class*="_shade_"]')!;
    expect([...wrap.children].map((c) => c.getAttribute('class')!.match(/_(\w+)_/)![1])).toEqual([
      'scroll',
      'edgeStart',
      'edgeEnd',
    ]);
    for (const strip of wrap.querySelectorAll('[class*="_edge"]')) {
      expect(strip.querySelector('table')).toBeNull();
      expect(strip.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
