import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import type { ResultView } from '../../lib/v2/view/result';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';
import { SEGMENT_VARIANTS, segmentElement } from './_lib/screens';

const RESULT_OF = { 'bad-site': 'bad-site', clean: 'clean', challenged: 'challenged' } as const;
const door = (variant: (typeof SEGMENT_VARIANTS)[number]) =>
  (RESULT_PREVIEWS[RESULT_OF[variant]]() as ResultView).doors[0]!;

describe('Final-Segment (Crawler access), the bad site', () => {
  const html = renderToStaticMarkup(segmentElement('access', 'bad-site'));

  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Segment.dc.html')).rest, 'segment-access'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('has one orange element: the open fix’s "Copy as a prompt" (FACTS orange convention)', () => {
    const primaries = html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatch(/>Copy as a prompt for your coding tool$/);
  });
});

describe.each(SEGMENT_VARIANTS)(
  'Crawler access, %s: it reconciles with the Result door',
  (variant) => {
    const data = SEGMENT_PREVIEWS.access(variant);
    const d = door(variant);

    it('shows the door’s pill as its headline pill', () => {
      expect(data.headline.pill).toEqual(d.pill);
    });

    it('counts the same AI crawlers in its tile, its matrix rows and the door', () => {
      const aiRows = data.groups.filter((g) => g.group !== 'search_engine').flatMap((g) => g.rows);
      const searchRows = data.groups.find((g) => g.group === 'search_engine')?.rows ?? [];
      expect(data.tiles[0]!.value).toBe(String(aiRows.length));
      const scored = data.groups.find((g) => g.group === 'ai_search')?.rows.length ?? 0;
      expect(data.tiles[0]!.note).toBe(`${scored} scored`);
      expect(d.footer).toContain(
        `${aiRows.length} AI crawlers (${scored} scored), ${searchRows.length} search engines by robots.txt`,
      );
    });

    it('counts its kept-out crawlers, by kind, as the matrix rows show them', () => {
      const rows = data.groups.filter((g) => g.group !== 'search_engine').flatMap((g) => g.rows);
      const label = data.headline.pill.label;
      const n = (re: RegExp) => Number(re.exec(label)?.[1] ?? 0);
      const count = (vs: string[]) => rows.filter((r) => vs.includes(r.verdict)).length;
      if (rows.some((r) => r.verdict === 'edge_blocks_automation')) {
        expect(label).toBe('blocks all automation');
      } else {
        expect(n(/(\d+) blocked/)).toBe(count(['disallowed_by_robots', 'blocked_by_ua_rule']));
        expect(n(/(\d+) challenged/)).toBe(count(['challenged_ua', 'refused_unverified']));
        expect(n(/(\d+) not measured/)).toBe(count(['not_measured']));
      }
    });

    it('agrees with the door on the section’s fixes', () => {
      const open = Number(/(\d+) fix(?:es)? open/.exec(d.footer)?.[1] ?? 0);
      const pro = Number(/(\d+) on Pro/.exec(d.footer)?.[1] ?? 0);
      expect(data.fixes.open.length).toBe(open);
      expect(data.fixes.proCount).toBe(pro);
    });

    it('draws the door’s coverage line', () => {
      expect('pages' in d.coverage ? d.coverage.pages : null).toEqual(data.coverage);
    });
  },
);
