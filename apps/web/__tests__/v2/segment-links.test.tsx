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

  it('shows the broken page with every linking page behind a disclosure', () => {
    const row = data.broken.rows[0]!;
    expect(text).toContain(row.path);
    const summary = [...doc.querySelectorAll('summary')].map((s) => s.textContent);
    expect(summary).toContain('Every page that links to it');
  });

  it('breaks a URL cell anywhere, so a long one keeps to its column', () => {
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

describe('Links and pages, a list longer than ten', () => {
  it('shows ten, then "and N more" as the disclosure that holds the rest', () => {
    const d = structuredClone(fixture('built-site'));
    const id = d.checks[0]!.id;
    const served = d.page_results.filter((p) => p.check_id === id && p.status_code === 200);
    served.slice(0, 11).forEach((p) => (p.meta_description = null));
    const missing = served.filter((p) => !p.meta_description?.text).length;
    expect(missing).toBeGreaterThan(10);
    const doc = dom(renderToStaticMarkup(<LinksScreen data={linksView(d, id)} />));
    const more = [...doc.querySelectorAll('details')].find(
      (x) => x.querySelector('summary')?.textContent === `and ${missing - 10} more`,
    );
    expect(more!.querySelectorAll('li')).toHaveLength(missing - 10);
  });
});
