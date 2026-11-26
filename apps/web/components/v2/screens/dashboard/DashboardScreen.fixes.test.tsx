/**
 * What the dashboard draws, against literal text read from the bad-site fixture. From PR 1 (QA's
 * dashboard walk, 24 Nov): the set-up card's title counts the rows it lists as left and the schedule is a line under
 * them, the sites card says which row holds no slot, the crawler panels name their site and a block on
 * another site is listed, the health tile shows a true figure when the mean has none, the set-up
 * links land on an anchor the site page has, and no control on a dashboard preview goes nowhere.
 * From PR 2 (layout): a host and a last-check line break only between their pieces, each
 * sites-table value carries its column's name for a phone, day 0's add-site action sits beside its
 * sentence, the history legend, the chart's caption, a long host, and the by-check rows' padding.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('the sites card, laid out for a phone (home)', () => {
  const doc = dom(dashboardPreview('home'));
  const sites = card(doc, 'Sites')!;

  it('breaks a host only after a dot, and a last-check line only after " · "', () => {
    const link = [...sites.querySelectorAll('tbody th a')].find(
      (a) => a.textContent === 'staging.example-outfitter.dev',
    )!;
    expect([...link.querySelectorAll('span')].map((s) => s.textContent)).toEqual([
      'staging.',
      'example-outfitter.',
      'dev',
    ]);
    expect(link.querySelectorAll('wbr')).toHaveLength(2);
    const queued = [...sites.querySelectorAll('tbody tr')].find((r) =>
      r.textContent!.includes('drivepei.ca'),
    )!;
    const last = queued.querySelector('td:last-child')!;
    expect([...last.querySelectorAll('span:not([aria-hidden])')].map((s) => s.textContent)).toEqual(
      ['Fri 06:01 EDT · ', 'check queued'],
    );
  });

  it('labels each value with its column only for a phone, hidden from a screen reader', () => {
    const row = sites.querySelector('tbody tr')!;
    const names = [...row.querySelectorAll('[aria-hidden="true"][data-v2-addition]')];
    expect(names.map((n) => n.textContent)).toEqual([
      'Technical SEO',
      'AI readability',
      'Since last crawl',
      'Schedule',
      'Last check',
    ]);
  });
});

describe('day 0 with no site', () => {
  it('puts the add-site action beside the sentence that says what adding a site starts', () => {
    const doc = dom(noSitePreview());
    expect(doc.querySelector('main header form')).toBeNull();
    const box = card(doc, 'Sites')!.querySelector('[data-v2-no-site-add]')!;
    expect(box.querySelector('p')!.textContent).toMatch(
      / Adding a site starts its first check\. Its grades, crawlers and fixes appear here when that check ends\.$/,
    );
    const button = box.querySelector('button[data-v2-primary]')!;
    expect(button.textContent).toBe('Add a site · 0 of 5 on Pro');
    expect(doc.querySelectorAll('[data-v2-primary]')).toHaveLength(1);
  });
});

describe('the history legend (QA dashboard walk D-25)', () => {
  it('does not name a line no check gave a score for', () => {
    const data = dashboardPreview('home');
    const legend = (d: typeof data) =>
      [...dom(d).querySelectorAll('section')]
        .find((s) => s.querySelector('h2, h3')?.textContent === d.history!.title)!
        .querySelector('h2, h3')!.parentElement!.parentElement!.textContent;
    expect(legend(data)).toContain('AI readability');
    const noAi = {
      ...data,
      history: { ...data.history!, points: data.history!.points.map((p) => ({ ...p, ai: null })) },
    };
    expect(legend(noAi)).not.toContain('AI readability');
    expect(legend(noAi)).toContain('Technical SEO');
  });
});

describe('the chart’s words under a phone chart are read once, in its caption (PR 2 review, item 4)', () => {
  it('the caption holds the score runs, the note and the marker’s words; the list under it is hidden', () => {
    const d = dom(dashboardPreview('home'));
    expect(
      d
        .querySelector('svg[data-v2-chart]')!
        .closest('div')!
        .parentElement!.querySelector('caption')!.textContent,
    ).toBe(
      'Technical SEO 79 at checks 1 to 2, then 80 at checks 3 to 5, then 79 at check 6; AI readability 41 at checks 1 to 5, then 22 at check 6. AI readability · 41 since the first audit. Claude-SearchBot and ClaudeBot blocked · 22',
    );
    const notes = d.querySelector('ul[aria-hidden="true"]')!;
    expect([...notes.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'AI readability · 41 since the first audit',
      'Claude-SearchBot and ClaudeBot blocked · 22',
    ]);
  });
});

describe('a long host on the sites table (PR 2 review, item 6)', () => {
  it('lets a 63-character label break inside itself, and keeps a short one whole', () => {
    const label = `xn--${'a'.repeat(59)}`;
    expect(label).toHaveLength(63);
    const data = dashboardPreview('home');
    const host = `${label}.example-outfitter.dev`;
    const withLong = {
      ...data,
      sites: {
        ...data.sites,
        rows: data.sites.rows.map((r, i) => (i === 0 ? { ...r, host } : r)),
      },
    };
    const link = dom(withLong).querySelector('table[aria-label="Watched sites"] tbody th a')!;
    expect(link.textContent).toBe(host);
    expect(
      [...link.querySelectorAll('[data-v2-part]')].map((s) => [
        s.textContent,
        s.getAttribute('data-v2-part'),
      ]),
    ).toEqual([
      [`${label}.`, 'long'],
      ['example-outfitter.', 'whole'],
      ['dev', 'whole'],
    ]);
    // The class a long part carries is the stylesheet's rule that lets it break anywhere.
    const css = readFileSync(join(__dirname, 'DashboardScreen.module.css'), 'utf8');
    const long = link.querySelector('[data-v2-part="long"]')!;
    const cls = long.getAttribute('class')!.match(/_(\w+)_/)![1]!;
    expect(cls).toBe('longPart');
    expect(css).toMatch(new RegExp(`\\n\\.${cls} \\{[^}]*overflow-wrap: anywhere;`));
  });
});

describe('the by-check rows keep the locked 4px 0 padding (CI layout.spec.ts:517)', () => {
  const css = readFileSync(join(__dirname, 'DashboardScreen.module.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*byCheckTable[^{]*)\{([^}]*)\}/g)].map(
    (m): [string, string] => [m[1]!.trim(), m[2]!],
  );

  it('no by-check cell rule pads beyond 4px 0; the markers keep 12px from the name by their margin', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const [selector, body] of rules) {
      expect(body, selector).not.toMatch(/padding-(left|right)|padding: (?!4px 0;)/);
    }
    const markers = rules.find(([s]) => s.endsWith('td > *'))!;
    expect(markers[1]).toMatch(/margin-left: 12px;/);
  });
});
