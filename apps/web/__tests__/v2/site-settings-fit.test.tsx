/**
 * CC-39 F10: on /sites/<id> at 1280px the "Settings for this site" card sat beside the alerts card at
 * about 480px. Its controls (the schedule's three selects, "Yes, remove this site") stayed on one
 * line, so the table outgrew the card: the controls were clipped at its right edge and the
 * explanation column was squeezed to a word per line. Now the two cards stack up to 1300px (the
 * shared breakpoint is 1100px), a control's fields wrap within their cell, and the explanation keeps
 * a minimum width beside them while the card is wide enough for three columns (F-110, which also
 * measures the layout: tests/visual/site-settings-fit.spec.ts).
 *
 * This reads the rules and the markup they key on; it does not measure layout. The controls are on
 * a live page only (`LiveActions`), so the geometry check is on a live /sites/<id> (CC-39
 * report-D3.md).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveActions } from '../../components/v2/screens/account/LiveActions';
import { SiteScreen } from '../../components/v2/screens/site/SiteScreen';
import { shellPreview, sitePreview } from '../../app/(v2-preview)/v2-preview/_preview/accounts';

const CSS = readFileSync(
  resolve(__dirname, '../../components/v2/screens/site/SiteScreen.module.css'),
  'utf8',
);

/** The body of the `@media` or `@container` block whose condition is exactly `condition`. */
function media(condition: string, rule = '@media'): string {
  const at = CSS.indexOf(`${rule} ${condition} {`);
  expect(at, condition).toBeGreaterThanOrEqual(0);
  const next = CSS.indexOf('\n}', at);
  return CSS.slice(at, next);
}

const classOf = (el: Element, name: string) =>
  [...el.classList].some((c) => new RegExp(`^_${name}_`).test(c));

describe('the site page’s settings card (CC-39 F10)', () => {
  it('stacks the settings and alerts cards up to 1300px', () => {
    expect(media('(max-width: 1300px)')).toMatch(
      /\.panels\.panels \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/,
    );
  });

  it('wraps a control’s fields in their cell and keeps the explanation readable in a wide card', () => {
    expect(CSS).toMatch(/\.settings td:last-child form \{[^}]*flex-wrap: wrap;/);
    const wide = media('(min-width: 640px)', '@container');
    expect(wide).toMatch(/\.settings td:nth-child\(2\) \{[^}]*min-width: 12em;/);
  });

  it('gives the public link’s buttons a line of their own in a narrow card, as a row with fields has', () => {
    // Whitespace collapsed: the formatter wraps a long selector across lines.
    const narrow = media('(max-width: 639.98px)', '@container').replace(/\s+/g, ' ');
    // The rule whose selector lifts the row's last cell onto a line of its own.
    const head = narrow.indexOf('.settings tr:has(td:last-child :is(');
    expect(head, 'the own-line rule').toBeGreaterThanOrEqual(0);
    const open = narrow.indexOf('{', head);
    const selector = narrow.slice(head, open);
    const body = narrow.slice(open, narrow.indexOf('}', open));
    expect(selector).toContain('td:nth-child(3)');
    expect(selector).toContain('.publicLink');
    expect(body).toMatch(/grid-column: 1 \/ -1;/);
  });

  it('carries the classes the rules key on, with each control in the row’s last cell', () => {
    const html = renderToStaticMarkup(
      <LiveActions>
        <SiteScreen data={sitePreview('home')} shell={shellPreview('home')} />
      </LiveActions>,
    );
    const doc = new JSDOM(html).window.document;
    const table = doc.querySelector('table[aria-label="Site settings"]')!;
    const section = table.closest('section')!.parentElement!;
    expect(classOf(section, 'panels')).toBe(true);
    expect(classOf(table.parentElement!, 'settings')).toBe(true);
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    const forms = rows.flatMap((tr) => [...tr.querySelectorAll('form')]);
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      const cells = [...form.closest('tr')!.children];
      expect(cells.indexOf(form.closest('td')!)).toBe(cells.length - 1);
    }
    // The schedule's selects are drawn on the live page, inside that last cell.
    expect(forms.some((f) => f.querySelectorAll('select').length >= 2)).toBe(true);
  });
});
