import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import type { ResultView } from '../../lib/v2/view/result';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';
import { SEGMENT_VARIANTS, segmentElement } from './_lib/screens';

const RESULT_OF = { 'bad-site': 'bad-site', clean: 'clean', challenged: 'challenged' } as const;
const door = (variant: (typeof SEGMENT_VARIANTS)[number]) =>
  (RESULT_PREVIEWS[RESULT_OF[variant]]() as ResultView).doors[3]!;

describe('Final-Seg-Content, the bad site', () => {
  const html = renderToStaticMarkup(segmentElement('content', 'bad-site'));

  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Seg-Content.dc.html')).rest, 'segment-content'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });
});

describe.each(SEGMENT_VARIANTS)('Content an answer engine can quote, %s', (variant) => {
  const data = SEGMENT_PREVIEWS.content(variant);
  const d = door(variant);
  const html = renderToStaticMarkup(segmentElement('content', variant));

  it('has one orange element: the next link, with no free fix in this section', () => {
    expect(data.fixes.open).toEqual([]);
    const primaries = html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatch(/>Next: Agent-readiness signals/);
  });

  it('shows the door’s pill as its headline pill', () => {
    expect(data.headline.pill).toEqual(d.pill);
  });

  it('counts the quotable openings in its tile as the grid’s direct-answer row does', () => {
    const tile = data.tiles.find((t) => t.label === 'Pages with a quotable opening');
    const row = data.grid?.rows.find((r) => r.check === 'direct_answer_150');
    if (!tile || !row) {
      expect(tile).toBe(row);
      return;
    }
    const sum = (i: 0 | 1) =>
      row.cells.reduce((n, c) => {
        if (!c) return n;
        const m = /^(\d+) of (\d+)$/.exec(c.text.replace(/,/g, ''));
        return n + (m ? Number(m[i + 1]) : i === 0 ? Number(c.text === 'yes') : 1);
      }, 0);
    expect(tile.value).toBe(
      `${sum(0).toLocaleString('en-US')} of ${sum(1).toLocaleString('en-US')}`,
    );
  });

  it('agrees with the door on the section’s fixes and its coverage line', () => {
    const open = Number(/(\d+) fix(?:es)? open/.exec(d.footer)?.[1] ?? 0);
    const pro = Number(/(\d+) on Pro/.exec(d.footer)?.[1] ?? 0);
    expect(data.fixes.open.length).toBe(open);
    expect(data.fixes.proCount).toBe(pro);
    expect(data.coverage).toEqual(d.coverage);
  });
});
