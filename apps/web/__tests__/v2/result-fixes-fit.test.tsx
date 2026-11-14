/**
 * CC-39 F3: on the anonymous result, the fixes table sits in the left track of a two-track grid with
 * the Pro panel in the right one. A fix title holding a long URL (one unbreakable token as wide as
 * the track) made the table wider than its track, so the scroll region clipped the last column
 * ("Open" read "Ope") under the panel's edge. The title cell now breaks anywhere and the action
 * cell keeps its button on one line, so the table's min-content fits the track at 1024–1920.
 *
 * This reads the rule and the markup it keys on; it does not measure layout. The geometry check is
 * the lead's, at /v2-preview/screens/result (CC-39 report-D3.md).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultScreen } from '../../components/v2/screens/result/ResultScreen';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';

const CSS = readFileSync(
  resolve(__dirname, '../../components/v2/screens/result/ResultScreen.module.css'),
  'utf8',
);

/** The declarations of the rule whose selector is exactly `selector`, outside any media query. */
function declarations(selector: string): string {
  const top = CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  const at = top.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return top.slice(at, top.indexOf('}', at));
}

describe('the result’s fixes table beside the Pro panel (CC-39 F3)', () => {
  it('breaks a fix title anywhere and keeps the action on one line, at every width', () => {
    expect(declarations('.fixes td:first-child')).toMatch(/overflow-wrap: anywhere;/);
    expect(declarations('.fixes td:last-child')).toMatch(/white-space: nowrap;/);
  });

  it('puts the fix title in the first cell and the action in the last, inside the fixes card', () => {
    const base = RESULT_PREVIEWS['bad-site']();
    const doc = new JSDOM(renderToStaticMarkup(<ResultScreen data={base} />)).window.document;
    const card = [...doc.querySelectorAll('section')].find((s) =>
      [...s.classList].some((c) => /^_fixes_/.test(c)),
    )!;
    expect(card.querySelector('[id="pro"]')).not.toBeNull();
    const rows = [...card.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(base.fixes!.rows.length);
    rows.forEach((tr, i) => {
      const cells = tr.querySelectorAll('td');
      expect(cells[0]!.textContent).toContain(base.fixes!.rows[i]!.title);
      expect(cells[cells.length - 1]!.querySelector('a')?.textContent).toMatch(
        /^(Open|See with Pro)$/,
      );
    });
  });
});
