/**
 * The dashboard's layout fixes that render as markup, against literal text read from the bad-site
 * fixture: a host and a last-check line break only between their pieces, each sites-table value
 * carries its column's name for a phone, and day 0's add-site action sits beside the sentence that
 * says what it starts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardScreen } from './DashboardScreen';
import {
  dashboardPreview,
  noSitePreview,
} from '../../../../app/(v2-preview)/v2-preview/_preview/accounts';

const dom = (data: Parameters<typeof DashboardScreen>[0]['data']) =>
  new JSDOM(renderToStaticMarkup(<DashboardScreen data={data} />)).window.document;

/** A card by its heading's text. */
const card = (doc: Document, title: string) =>
  [...doc.querySelectorAll('section')].find(
    (s) => s.querySelector('h2, h3')?.textContent === title,
  )!;

describe('the sites card (home)', () => {
  const doc = dom(dashboardPreview('home'));
  const sites = card(doc, 'Sites');

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
      ['Fri 06:01 · ', 'check queued'],
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
    const box = card(doc, 'Sites').querySelector('[data-v2-no-site-add]')!;
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
