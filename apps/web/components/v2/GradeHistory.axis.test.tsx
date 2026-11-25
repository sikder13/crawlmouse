/**
 * The history axis's labels do not run into each other (PR 2 review, item 1). Each label's extent
 * is computed from what the chart draws (its x, its text-anchor, each line of text) at the font size
 * its stylesheet sets, with a stated upper bound for a character's width in the mono face: 0.62 em.
 * The vector is D-25's shape, six checks with two on one day, whose labels carry their times.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardScreen } from './screens/dashboard/DashboardScreen';
import { dashboardView } from '../../lib/v2/view/dashboard';
import { fixture } from '../../lib/v2/fixtures';

/** A mono character's width, at most, in em. */
const CHAR_EM = 0.62;
const css = readFileSync(join(__dirname, 'GradeHistory.module.css'), 'utf8');
/** The axis lettering's size: the desktop rule, and the phone rule under `.fit`. */
const DESKTOP = Number(css.match(/\n\.ticks text \{[^}]*font-size: (\d+)px/)![1]);
const PHONE = Number(css.match(/\.fit \.ticks text \{[^}]*font-size: (\d+)px/)![1]);

const bad = fixture('bad-site');
const sameDay = () => {
  const copy = structuredClone(bad);
  // The third check moved to 26 Oct 18:00Z, the second's day in Indiana: every label gets its time.
  copy.checks.find((c) => c.id === 'c0000000-0000-4000-8000-000000000003')!.finished_at =
    '2026-10-26T18:00:00Z';
  return dashboardView(copy, { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of });
};

/** Each axis label's lines as [left, right] in viewBox units, at a font size. */
function extents(font: number) {
  const d = new JSDOM(renderToStaticMarkup(<DashboardScreen data={sameDay()} />)).window.document;
  const svg = d.querySelector('svg[data-v2-chart]')!;
  const axis = [...svg.querySelectorAll('g')].at(-1)!;
  return [...axis.querySelectorAll('text')].map((t) => {
    const x = Number(t.getAttribute('x'));
    const anchor = t.getAttribute('text-anchor');
    const lines = t.querySelectorAll('tspan').length
      ? [...t.querySelectorAll('tspan')].map((s) => s.textContent ?? '')
      : [t.textContent ?? ''];
    return lines.map((line): [number, number] => {
      const w = line.length * CHAR_EM * font;
      return anchor === 'start'
        ? [x, x + w]
        : anchor === 'end'
          ? [x - w, x]
          : [x - w / 2, x + w / 2];
    });
  });
}

describe('the history axis with two checks on one day (D-25)', () => {
  it('sets each label as its day over its time', () => {
    const d = new JSDOM(renderToStaticMarkup(<DashboardScreen data={sameDay()} />)).window.document;
    const axis = [...d.querySelector('svg[data-v2-chart]')!.querySelectorAll('g')].at(-1)!;
    expect(
      [...axis.querySelectorAll('text')].map((t) =>
        [...t.querySelectorAll('tspan')].map((s) => s.textContent),
      ),
    ).toEqual([
      ['24 Oct', '22:34'],
      ['26 Oct', '09:14'],
      ['26 Oct', '14:00'],
      ['28 Oct', '16:04'],
      ['29 Oct', '08:42'],
      ['30 Oct', '06:02'],
    ]);
  });

  it.each([
    ['desktop', DESKTOP],
    ['phone', PHONE],
  ])(
    '%s: no line of a label overlaps the same line of the next, and none leaves the drawing',
    (_, font) => {
      expect([DESKTOP, PHONE]).toEqual([10, 15]);
      const labels = extents(font);
      for (let i = 1; i < labels.length; i++) {
        for (let line = 0; line < labels[i]!.length; line++) {
          const [, rightOfPrev] = labels[i - 1]![line]!;
          const [leftOfThis] = labels[i]![line]!;
          expect(leftOfThis, `label ${i - 1} and ${i}, line ${line}`).toBeGreaterThan(rightOfPrev);
        }
      }
      for (const label of labels) {
        for (const [left, right] of label) {
          expect(left).toBeGreaterThanOrEqual(0);
          expect(right).toBeLessThanOrEqual(640);
        }
      }
    },
  );
});
