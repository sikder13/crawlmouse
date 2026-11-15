/**
 * CC-39 F3: on the anonymous result, the fixes table sits in the left track of a two-track grid with
 * the Pro panel in the right one. A fix title holding a long URL (one unbreakable token as wide as
 * the track) made the table wider than its track, so the scroll region clipped the last column
 * ("Open" read "Ope") under the panel's edge. The title cell now breaks anywhere and the action
 * cell keeps its button on one line, so a long URL no longer sets the table's min-content width.
 * Both rules hold only in the two-track layout, above the phone query (ruling 7): on a phone the table
 * is one track and keeps its ordinary word wrapping.
 *
 * This reads the rule and the markup it keys on; it does not measure layout. The geometry check is
 * the lead's, on a live result with long-URL titles (CC-39 report-D3.md).
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

/**
 * Every style rule with the at-rule conditions it sits under ('' at top level), read by brace depth.
 * Comments are dropped first, so a brace in a comment does not move the depth.
 */
function rules(css: string): { media: string; selector: string; body: string }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { media: string; selector: string; body: string }[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const head = src.slice(start, i).trim();
      if (head.startsWith('@')) {
        stack.push(head);
        start = i + 1;
      } else {
        const end = src.indexOf('}', i);
        out.push({ media: stack.join(' '), selector: head, body: src.slice(i + 1, end) });
        i = end;
        start = end + 1;
      }
    } else if (ch === '}') {
      stack.pop();
      start = i + 1;
    }
  }
  return out;
}

/** The rules on a cell of the fixes table that declare `property: value`, wherever they sit. */
const cellRules = (property: string, value: string) =>
  rules(CSS).filter(
    (r) =>
      /\.fixes\b[^,]*\btd\b/.test(r.selector) &&
      new RegExp(`(^|;|\\s)${property}:\\s*${value}\\s*(;|$)`).test(r.body),
  );

describe('the result’s fixes table beside the Pro panel (CC-39 F3)', () => {
  // Ruling 7: on the phone the table is one track under the Pro panel, and these two rules there
  // squeezed the title column until words split ("collection / s"). They hold only where the
  // panel sits beside the table, the two-track layout above the phone query (max-width 760px).
  const TWO_TRACK = '@media (min-width: 761px)';

  it('breaks a fix title anywhere only in the two-track layout', () => {
    const found = cellRules('overflow-wrap', 'anywhere');
    expect(found.map((r) => r.selector)).toContain('.fixes td:first-child');
    for (const r of found) expect(r.media, r.selector).toBe(TWO_TRACK);
  });

  it('keeps the action on one line only in the two-track layout', () => {
    const found = cellRules('white-space', 'nowrap');
    expect(found.map((r) => r.selector)).toContain('.fixes td:last-child');
    for (const r of found) expect(r.media, r.selector).toBe(TWO_TRACK);
  });

  it('reads a rule’s query, so the check can see a rule outside it (the reader is live)', () => {
    const sample = rules(
      '.fixes td:first-child { overflow-wrap: anywhere; }\n' +
        '@media (max-width: 760px) { .a { color: red; } .fixes td:last-child { white-space: nowrap; } }\n' +
        '/* { */ @media (min-width: 761px) { .fixes td { overflow-wrap: anywhere; } }',
    );
    expect(sample.map((r) => [r.media, r.selector])).toEqual([
      ['', '.fixes td:first-child'],
      ['@media (max-width: 760px)', '.a'],
      ['@media (max-width: 760px)', '.fixes td:last-child'],
      ['@media (min-width: 761px)', '.fixes td'],
    ]);
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
