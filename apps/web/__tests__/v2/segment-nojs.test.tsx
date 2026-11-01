import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import type { ResultView } from '../../lib/v2/view/result';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';
import { SEGMENT_VARIANTS, segmentElement } from './_lib/screens';

const RESULT_OF = { 'bad-site': 'bad-site', clean: 'clean', challenged: 'challenged' } as const;
const door = (variant: (typeof SEGMENT_VARIANTS)[number]) =>
  (RESULT_PREVIEWS[RESULT_OF[variant]]() as ResultView).doors[1]!;

describe('Final-Seg-JS (Readable without JavaScript), the bad site', () => {
  const html = renderToStaticMarkup(segmentElement('nojs', 'bad-site'));

  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Seg-JS.dc.html')).rest, 'segment-nojs'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });
});

describe.each(SEGMENT_VARIANTS)('Readable without JavaScript, %s', (variant) => {
  const data = SEGMENT_PREVIEWS.nojs(variant);
  const d = door(variant);
  const html = renderToStaticMarkup(segmentElement('nojs', variant));

  it('has one orange element: the open fix’s copy button, or the next link without one', () => {
    const primaries = html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatch(
      data.fixes.open.length ? />Copy as a prompt for your coding tool$/ : />Next: Site structure/,
    );
  });

  it('shows the door’s share in its pill and its first tile', () => {
    const share = /^(\d+)% of text$/.exec(d.pill.label)![1];
    expect(data.headline.pill).toEqual({ state: d.pill.state, label: `${share}% site-wide` });
    expect(data.tiles[0]).toEqual({
      label: 'Text without JavaScript, site',
      value: `${share}%`,
      note: null,
    });
  });

  it('counts the measured pages in its tile, its record line and its rows alike', () => {
    const tile = data.tiles.find((t) => t.label === 'Pages measured')!;
    const [sampled] = tile.value.split(' of ');
    if (data.recordLine) {
      expect(data.recordLine).toBe(
        `${data.rows.length} of the ${sampled} measured pages are in this record.`,
      );
    } else {
      expect(String(data.rows.length)).toBe(sampled);
    }
  });

  it('agrees with the door on the section’s fixes and its coverage line', () => {
    const open = Number(/(\d+) fix(?:es)? open/.exec(d.footer)?.[1] ?? 0);
    const pro = Number(/(\d+) on Pro/.exec(d.footer)?.[1] ?? 0);
    expect(data.fixes.open.length).toBe(open);
    expect(data.fixes.proCount).toBe(pro);
    expect('pages' in d.coverage ? d.coverage.pages : null).toEqual(data.coverage);
  });
});

describe('Readable without JavaScript, challenged: no measured page in the record', () => {
  it('draws no empty table, and says how many of the measured pages the record holds', () => {
    const html = renderToStaticMarkup(segmentElement('nojs', 'challenged'));
    expect(html).not.toContain('<table');
    expect(html).toContain('0 of the 12 measured pages are in this record.');
  });
});
