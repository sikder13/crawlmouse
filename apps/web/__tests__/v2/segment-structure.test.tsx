import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import type { ResultView } from '../../lib/v2/view/result';
import { numberWord } from '../../lib/v2/words';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';
import { SEGMENT_VARIANTS, segmentElement } from './_lib/screens';

const RESULT_OF = { 'bad-site': 'bad-site', clean: 'clean', challenged: 'challenged' } as const;
const door = (variant: (typeof SEGMENT_VARIANTS)[number]) =>
  (RESULT_PREVIEWS[RESULT_OF[variant]]() as ResultView).doors[2]!;
const primaries = (html: string) => html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];

describe('Final-Seg-Structure (Site structure), the bad site', () => {
  const html = renderToStaticMarkup(segmentElement('structure', 'bad-site'));

  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Seg-Structure.dc.html')).rest, 'segment-structure'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('draws the crawl’s map with an accessible name, its legend in a band under it', () => {
    expect(html).toMatch(
      /<svg[^>]*role="img"[^>]*aria-label="Link map of 214 pages: 7 orphan, 5 reachable only through JavaScript\."/,
    );
    expect(html.indexOf('every page crawled, 214 of 214')).toBeGreaterThan(
      html.indexOf('data-v2-map'),
    );
  });
});

describe.each(SEGMENT_VARIANTS)('Site structure, %s', (variant) => {
  const data = SEGMENT_PREVIEWS.structure(variant);
  const d = door(variant);
  const html = renderToStaticMarkup(segmentElement('structure', variant));

  it('has one orange element: the open fix’s copy button, or with none, the next link', () => {
    const p = primaries(html);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(
      data.fixes.open.length
        ? />Copy as a prompt for your coding tool$/
        : />Next: Content an answer engine can quote/,
    );
  });

  it('shows the door’s pill as its headline pill', () => {
    expect(data.headline.pill).toEqual(d.pill);
  });

  it('counts its orphans the same in the headline, the tile, the table and the door', () => {
    const tile = Number(data.tiles.find((t) => t.label === 'Orphan pages')!.value);
    const unlisted = data.orphans.unlisted
      ? Number(/^(\d+) of (\d+)/.exec(data.orphans.unlisted)![2])
      : null;
    expect(unlisted ?? data.orphans.rows.length).toBe(tile);
    if (unlisted !== null) {
      expect(Number(/^(\d+) of/.exec(data.orphans.unlisted!)![1])).toBe(data.orphans.rows.length);
    }
    if (tile > 0) {
      expect(data.headline.title.toLowerCase()).toContain(`${numberWord(tile)} page`);
      expect(d.body.toLowerCase()).toContain(`${numberWord(tile)} orphan`);
    } else {
      expect(d.body).toMatch(/^No orphan pages/);
    }
    expect(data.map?.legend.orphans ?? 0).toBe(tile);
  });

  it('agrees with the door on its pages, nodes and coverage', () => {
    const pages = data.tiles.find((t) => t.label === 'Pages')!.value;
    expect(d.footer).toContain(`Link map, ${pages} nodes`);
    expect('pages' in d.coverage ? d.coverage.pages : null).toEqual(data.coverage);
  });

  it('agrees with the door on the section’s fixes', () => {
    const open = Number(/(\d+) fix(?:es)? open/.exec(d.footer)?.[1] ?? 0);
    const pro = Number(/(\d+) on Pro/.exec(d.footer)?.[1] ?? 0);
    expect(data.fixes.open.length).toBe(open);
    expect(data.fixes.proCount).toBe(pro);
  });
});
