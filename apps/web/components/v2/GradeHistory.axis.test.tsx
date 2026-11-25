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
/** The chart's top padding and the rule that sizes its box (`.chart`). */
const CHART_RULE = css.match(/\n\.chart \{([^}]*)\}/)![1]!;
const PAD_TOP = Number(CHART_RULE.match(/padding: (\d+)px/)![1]);
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

  it('sets the time line at least 1.2 times the phone lettering under its day, inside the drawing', () => {
    const d = new JSDOM(renderToStaticMarkup(<DashboardScreen data={sameDay()} />)).window.document;
    const svg = d.querySelector('svg[data-v2-chart]')!;
    const height = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    const axis = [...svg.querySelectorAll('g')].at(-1)!;
    for (const t of axis.querySelectorAll('text')) {
      const baseline = Number(t.getAttribute('y'));
      const dy = Number(t.querySelectorAll('tspan')[1]!.getAttribute('dy'));
      expect(dy).toBeGreaterThanOrEqual(1.2 * PHONE);
      // The time's descenders, a quarter of an em under its baseline, stay inside the drawing.
      expect(baseline + dy + 0.25 * PHONE).toBeLessThanOrEqual(height);
    }
  });
});

describe('the chart’s box grows with its drawing (PR 2 re-review, item 2)', () => {
  const box = (data: ReturnType<typeof sameDay>) => {
    const svg = new JSDOM(
      renderToStaticMarkup(<DashboardScreen data={data} />),
    ).window.document.querySelector('svg[data-v2-chart]')!;
    const style = svg.getAttribute('style') ?? '';
    return {
      viewBox: Number(svg.getAttribute('viewBox')!.split(' ')[3]),
      height: Number(style.match(/--v2-chart-h:\s*(\d+)px/)![1]),
    };
  };

  it('its stylesheet sizes the box from the element’s height', () => {
    expect(CHART_RULE).toMatch(/height: var\(--v2-chart-h/);
  });

  it.each([
    ['with times', () => sameDay()],
    [
      'without times',
      () =>
        dashboardView(bad, { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of }),
    ],
  ] as const)('%s: the box is the drawing’s height plus the top padding', (_, data) => {
    const b = box(data());
    expect(b.height - PAD_TOP).toBe(b.viewBox);
  });
});

describe('a phone keeps every text of the chart (owner ruling 2026-11-08; CI layout.spec.ts:605)', () => {
  /** The `.fit` rules inside the phone query. */
  const phone = css.slice(css.indexOf('@media (max-width: 760px)'));
  const fitRules = [...phone.matchAll(/(\.fit[^{]*)\{([^}]*)\}/g)].map((m): [string, string] => [
    m[1]!.trim(),
    m[2]!,
  ]);

  it('takes no text out of the page: no `.fit` rule sets display none or visibility hidden', () => {
    expect(fitRules.length).toBeGreaterThan(0);
    for (const [selector, body] of fitRules) {
      if (selector.includes('phoneNotes')) continue; // the list it shows, not hides
      expect(body, selector).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    }
  });

  it('draws all four tick labels, and the note and marker words both in the drawing and in the list', () => {
    const d = new JSDOM(renderToStaticMarkup(<DashboardScreen data={sameDay()} />)).window.document;
    const svg = d.querySelector('svg[data-v2-chart]')!;
    const ticks = [...svg.querySelectorAll('g')][1]!;
    expect(
      [...ticks.querySelectorAll('text')].map((t) => [t.textContent, t.getAttribute('class')]),
    ).toEqual([
      ['100', null],
      ['75', null],
      ['50', null],
      ['25', null],
    ]);
    const list = d.querySelector('ul[aria-hidden="true"]')!;
    const inDrawing = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    for (const li of list.querySelectorAll('li')) expect(inDrawing).toContain(li.textContent);
  });
});
