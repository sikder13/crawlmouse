import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { LinksScreen } from '../../components/v2/screens/segment/LinksScreen';
import { linksBuiltPreview } from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { fixture } from '../../lib/v2/fixtures';
import { linksView } from '../../lib/v2/view/segment/links';

const dom = (markup: string) => new JSDOM(`<body>${markup}</body>`).window.document;

describe('Links and pages, the built site', () => {
  const data = linksBuiltPreview();
  const doc = dom(renderToStaticMarkup(<LinksScreen data={data} />));
  const text = doc.body.textContent ?? '';

  it('shows the broken page with the links that lead to it behind a "Linked from" disclosure', () => {
    const row = data.broken.rows[0]!;
    expect(text).toContain(row.path);
    const summary = [...doc.querySelectorAll('summary')].map((s) => s.textContent);
    expect(summary).toContain('Linked from');
    expect(summary).not.toContain('Every page that links to it');
  });

  it('gives a URL cell the breakAnywhere class', () => {
    const cell = [...doc.querySelectorAll('span')].find(
      (s) => s.textContent === data.broken.rows[0]!.path,
    )!;
    expect(cell.className).toMatch(/breakAnywhere/);
  });

  it('ends with the muted headings line, and marks the new tab as an addition', () => {
    expect(text).toContain('Headings are not checked yet.');
    const tab = [...doc.querySelectorAll('nav a')].find(
      (a) => a.textContent === 'Links and pages',
    )!;
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(tab.hasAttribute('data-v2-addition')).toBe(true);
  });
});

describe('Links and pages, the other errors and the links with no text', () => {
  const d = structuredClone(fixture('built-site'));
  const id = d.checks[0]!.id;
  const page = (path: string) =>
    d.page_results.find((p) => p.check_id === id && new URL(p.url).pathname === path)!;
  page('/products/camp-kitchen-item-1').status_code = 503;
  const edge = d.link_edges.find((e) => e.to_url === page('/products/retired-tent').url)!;
  edge.anchor_text = '\u00a0';
  const doc = dom(renderToStaticMarkup(<LinksScreen data={linksView(d, id)} />));
  const tables = [...doc.querySelectorAll('table')];
  const tableOf = (label: string) => tables.find((t) => t.getAttribute('aria-label') === label);

  it('lists a 503 apart under "Pages that answered an error", headed "Page", in a neutral pill', () => {
    const t = tableOf('Pages that answered an error')!;
    expect(t.querySelector('th')!.textContent).toBe('Page');
    expect(t.textContent).toContain('/products/camp-kitchen-item-1');
    expect(t.querySelector('[data-v2-pill]')!.getAttribute('data-v2-pill')).toBe('neutral');
    expect(tableOf('Broken links')!.textContent).not.toContain('/products/camp-kitchen-item-1');
  });

  it('shows a link with no text as "(no link text)", not as empty quotes', () => {
    const items = [...doc.querySelectorAll('details li')].map((li) => li.textContent);
    expect(items).toContain('/blog/first-night-outdoors (no link text)');
    expect(doc.body.textContent).not.toContain('“\u00a0”');
  });
});

describe('Links and pages, a list longer than ten', () => {
  it('shows ten, then "and N more" as the disclosure that holds the rest', () => {
    const d = structuredClone(fixture('built-site'));
    const id = d.checks[0]!.id;
    const served = d.page_results.filter((p) => p.check_id === id && p.status_code === 200);
    // Read, and declaring none: missing. (A null description was not read, so is not missing.)
    served.slice(0, 11).forEach((p) => (p.meta_description = { text: null, chars: 0, cut: false }));
    const missing = served.filter(
      (p) => p.meta_description !== null && !p.meta_description.text,
    ).length;
    expect(missing).toBeGreaterThan(10);
    const doc = dom(renderToStaticMarkup(<LinksScreen data={linksView(d, id)} />));
    const more = [...doc.querySelectorAll('details')].find(
      (x) => x.querySelector('summary')?.textContent === `and ${missing - 10} more`,
    );
    expect(more!.querySelectorAll('li')).toHaveLength(missing - 10);
  });
});
