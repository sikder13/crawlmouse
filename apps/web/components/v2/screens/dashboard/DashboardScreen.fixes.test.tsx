/**
 * What the dashboard draws, against literal text read from the bad-site fixture (QA's dashboard walk,
 * 24 Nov): the set-up card's title counts the rows it lists as left and the schedule is a line under
 * them, the sites card says which row holds no slot, the crawler panels name their site and a block on
 * another site is listed, the health tile shows a true figure when the mean has none, the set-up
 * links land on an anchor the site page has, and no control on a dashboard preview goes nowhere.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardScreen } from './DashboardScreen';
import { SiteScreen } from '../site/SiteScreen';
import {
  dashboardPreview,
  noSiteEarlierPreview,
  noSitePreview,
  shellPreview,
  sitePreview,
} from '../../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { dashboardView } from '../../../../lib/v2/view/dashboard';
import { fixture } from '../../../../lib/v2/fixtures';

type Data = Parameters<typeof DashboardScreen>[0]['data'];
const dom = (data: Data) =>
  new JSDOM(renderToStaticMarkup(<DashboardScreen data={data} />)).window.document;

/** A card by its heading's text. */
const card = (doc: Document, title: string) =>
  [...doc.querySelectorAll('section')].find(
    (s) => s.querySelector('h2, h3')?.textContent === title,
  );

const bad = fixture('bad-site');
const viewer = { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of };

describe('the set-up card (home)', () => {
  const setup = card(dom(dashboardPreview('home')), 'Everything is set up')!;

  it('lists no row as left when its title says nothing is (D-06)', () => {
    expect(setup).toBeDefined();
    const rows = [...setup.querySelectorAll('table[aria-label="Set-up"] tbody tr')];
    expect(rows.map((r) => r.querySelector('td:nth-child(2)')!.textContent)).toEqual([
      'Slack alerts connected',
    ]);
    expect(rows.filter((r) => r.querySelector('td')!.textContent === 'not done')).toEqual([]);
  });

  it('puts the schedule link under the table, never marked "not done" (Q8, D-16)', () => {
    const table = setup.querySelector('table[aria-label="Set-up"]')!;
    expect(table.textContent).not.toContain('Choose the day and hour');
    expect(setup.querySelector('[data-v2-setup-schedule]')!.textContent).toBe(
      'Choose the day and hour example-outfitter.com is checked weekly (now Fri around 06:00 EST)Set the day',
    );
  });
});

describe('the sites card (home)', () => {
  it('says beside "4 of 5 on Pro" that the fifth row is a staging copy holding no slot', () => {
    const sites = card(dom(dashboardPreview('home')), 'Sites')!;
    const head = sites.querySelector('h2, h3')!.parentElement!.parentElement!;
    expect(head.textContent).toBe('Sites4 of 5 on Pro · 1 staging copy holds no slot');
    expect(sites.querySelectorAll('table[aria-label="Watched sites"] tbody tr')).toHaveLength(5);
  });
});

describe('crawlers blocked on any site (D-09)', () => {
  it('names the site the crawler panels read', () => {
    const now = card(dom(dashboardPreview('home')), 'Crawler access now')!;
    expect(now.querySelector('[data-v2-crawlers-site]')!.textContent).toBe('example-outfitter.com');
  });

  it('lists a block on another site, with its site, crawler and verdict', () => {
    const copy = structuredClone(bad);
    copy.checks
      .find((c) => c.id === 'c0000000-0000-4000-8000-00000000000c')!
      .crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'disallowed_by_robots';
    const blocked = card(
      dom(dashboardView(copy, viewer)),
      'AI crawlers blocked on your other sites',
    )!;
    expect(
      [...blocked.querySelectorAll('tbody tr')].map((r) =>
        [...r.children].map((c) => c.textContent),
      ),
    ).toEqual([['nahltech.com', 'GPTBotProblem: blocked by robots.txt']]);
  });

  it('fits a phone: two columns, the crawler and its verdict in one cell that wraps (parity at 390)', () => {
    const blocked = card(dom(dashboardPreview('day0')), 'AI crawlers blocked on your sites')!;
    const row = blocked.querySelector('tbody tr')!;
    expect([...row.children].map((c) => c.textContent)).toEqual([
      'example-outfitter.com',
      'GPTBotProblem: blocked by a rule',
    ]);
    const access = row.querySelector('[data-v2-verdict]')!.parentElement!;
    expect([...access.children].map((c) => c.textContent)).toEqual([
      'GPTBot',
      'Problem: blocked by a rule',
    ]);
    expect(access.className).toMatch(/blockedAccess/);
    expect(row.querySelector('th > span')!.className).toMatch(/blockedHost/);
    // Named, not linked: the Sites table links the site (account-control-names, no repeated name).
    expect(row.querySelector('a')).toBeNull();
    // The site heads its row and the crawler and verdict are its data, so the row's header has a
    // data cell to name (axe: th-has-data-cells).
    expect([...row.children].map((c) => c.tagName)).toEqual(['TH', 'TD']);
    expect(row.children[0]!.getAttribute('scope')).toBe('row');
  });
});

describe('the health tile with no site carrying both grades (D-10)', () => {
  it('shows the Technical SEO mean under a label that says so', () => {
    const copy = structuredClone(bad);
    for (const c of copy.checks) {
      if (c.ai_readability) {
        c.ai_readability.withheld = true;
        c.ai_readability.withheld_reasons = ['readable_unmeasured'];
      }
    }
    const doc = dom(dashboardView(copy, viewer));
    const value = doc.querySelector('[data-v2-health-value]')!;
    expect(value.textContent).toBe('78');
    expect(value.parentElement!.previousElementSibling!.textContent).toBe(
      'Technical SEO, mean of 4 sites · no site has both grades',
    );
  });
});

describe('the set-up links land on the site page’s settings card (D-15)', () => {
  it('the anchor the dashboard links to is an element of the site page', () => {
    const href = dashboardPreview('home').setup!.schedule!.action!.href;
    const anchor = href.substring(href.indexOf('#') + 1);
    const site = new JSDOM(
      renderToStaticMarkup(<SiteScreen data={sitePreview('home')} shell={shellPreview('home')} />),
    ).window.document;
    const target = site.getElementById(anchor);
    expect(target).not.toBeNull();
    expect(target!.querySelector('h2, h3')!.textContent).toBe('Settings for this site');
  });
});

describe('on each dashboard preview: no empty or bare-# href, no link off-site, no button outside a form', () => {
  const previews: Record<string, () => Data> = {
    day0: () => dashboardPreview('day0'),
    home: () => dashboardPreview('home'),
    clean: () => dashboardPreview('clean'),
    withheld: () => dashboardPreview('withheld'),
    'no-site': noSitePreview,
    earlier: noSiteEarlierPreview,
  };

  it.each(Object.entries(previews))('%s', (_, data) => {
    const doc = dom(data());
    for (const a of doc.querySelectorAll('a')) {
      const href = a.getAttribute('href') ?? '';
      expect(href, a.outerHTML).not.toBe('');
      if (href.startsWith('#')) {
        // An in-page link names an element on the page (the skip link's target).
        expect(doc.getElementById(href.substring(1)), a.outerHTML).not.toBeNull();
      } else {
        expect(href, a.outerHTML).toMatch(/^\//);
      }
    }
    for (const b of doc.querySelectorAll('button')) {
      // A button with no script submits its form: one outside a form does nothing.
      expect(b.closest('form'), b.outerHTML).not.toBeNull();
      expect(b.closest('form')!.getAttribute('action'), b.outerHTML).toMatch(/^\//);
    }
  });
});
