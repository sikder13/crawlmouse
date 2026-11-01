import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapPreview } from '../../app/(v2-preview)/v2-preview/_preview/MapPreview';
import {
  MAP_SOURCES,
  mapPreview,
  type MapVariant,
} from '../../app/(v2-preview)/v2-preview/_preview/maps';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { CANVAS_MARKER } from '../../components/v2/screens/map/canvas-marker';
import { EXPLORER_SVG_MAX } from '../../lib/v2/view/link-map';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const VARIANTS = Object.keys(MAP_SOURCES) as MapVariant[];
const html = (v: MapVariant) => renderToStaticMarkup(<MapPreview variant={v} />);

describe('Final-LinkMap, the bad site zoomed to its hubs', () => {
  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-LinkMap.dc.html')).rest, 'link-map'),
        renderedText(withoutShell(html('bad-site')).rest),
      ),
    ).toBeNull();
  });
});

describe.each(VARIANTS)('the explorer, %s', (variant) => {
  const markup = html(variant);
  const data = mapPreview(variant);
  const entry = PREVIEWS.find((p) => p.path === MAP_SOURCES[variant].path)!;

  it('is listed, with as many orange elements as its entry says', () => {
    expect(entry).toBeDefined();
    expect(markup.match(/data-v2-primary=""/g) ?? []).toHaveLength(entry.orange ?? 1);
  });

  it('puts every drawn page in the list the keyboard walks, once, with the selected one marked', () => {
    const options = [...markup.matchAll(/role="option"[^>]*aria-selected="(true|false)"/g)];
    expect(options).toHaveLength(data.nodes.length);
    expect(options.filter((m) => m[1] === 'true')).toHaveLength(1);
    expect(markup).toContain(
      `aria-activedescendant="v2-map-option-${data.order.indexOf(data.initial)}"`,
    );
  });

  it('draws SVG up to the limit, and leaves a larger map to the canvas, which the server never renders', () => {
    if (data.nodes.length > EXPLORER_SVG_MAX) {
      expect(data.renderer).toBe('canvas');
      expect(markup).not.toContain('data-v2-renderer="svg"');
    } else {
      expect(data.renderer).toBe('svg');
      expect(markup.match(/data-v2-node="/g)).toHaveLength(data.nodes.length);
    }
    expect(markup).not.toContain(CANVAS_MARKER);
  });
});

describe('the explorer agrees with the Structure page', () => {
  it.each(['bad-site', 'clean', 'challenged'] as const)(
    '%s: the pages, links, orphans and JavaScript-only pages it counts',
    (site) => {
      const s = SEGMENT_PREVIEWS.structure(site);
      const tile = (label: string) => s.tiles.find((t) => t.label === label)!.value;
      const variant = site === 'bad-site' ? 'all' : site;
      const m = mapPreview(variant);
      expect(m.title).toBe(`${tile('Pages')} pages, ${tile('Internal links')} links.`);
      expect(m.filters[0]!.label).toBe(`Orphans · ${tile('Orphan pages')}`);
      expect(m.filters[1]!.label).toBe(
        `JavaScript-only · ${tile('Reachable only through JavaScript')}`,
      );
      // Every page drawn: the drawing holds as many pages, orphans and JavaScript-only pages.
      expect(String(m.nodes.length)).toBe(tile('Pages').replace(/,/g, ''));
      expect(String(m.filters[0]!.ids.length)).toBe(tile('Orphan pages'));
      expect(String(m.filters[1]!.ids.length)).toBe(tile('Reachable only through JavaScript'));
      expect(s.map?.exploreHref).toBe(MAP_SOURCES[variant].path);
    },
  );

  it('opens the explorer from the Structure page’s Explore all, with the real count', () => {
    const s = SEGMENT_PREVIEWS.structure('bad-site');
    expect(s.map!.explore).toBe(`Explore all ${s.tiles[0]!.value}`);
    expect(mapPreview('bad-site').explore).toEqual({
      label: s.map!.explore,
      href: MAP_SOURCES.all.path,
    });
    expect(s.orphans.explorerHref).toBe(MAP_SOURCES['bad-site'].path);
  });

  it('counts the large map’s pages from the generated graph', () => {
    expect(mapPreview('large').nodes).toHaveLength(2_000);
    expect(mapPreview('large').renderer).toBe('canvas');
  });
});
