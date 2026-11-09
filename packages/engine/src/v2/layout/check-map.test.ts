/**
 * The map drawing a finished check stores (CC-20b D10), and the layout's own objects keyed by page
 * id. The web side proves the drawing is the one the link-map explorer draws for the same check
 * (apps/web/lib/v2/view/link-map.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import { buildCheck } from '../build/build.js';
import { checkMap } from './check-map.js';
import { layoutMapFrom, type LayoutNode } from './force-layout.js';
import { HUB_MAP_CAP, HUB_MIN_INBOUND } from './hubs.js';

const built = buildCheck(recordedBuild());
const drawing = checkMap(built.page_results, built.link_edges);

describe('checkMap on the recorded built-site check', () => {
  it('draws the home page and the hubs, each with a position, and nothing else', () => {
    const ids = drawing.nodes.map((n) => n.id);
    expect(ids).toContain(built.page_results.find((p) => p.depth === 0)!.url);
    for (const p of built.page_results.filter(
      (p) => p.links_in >= HUB_MIN_INBOUND && p.depth !== null,
    )) {
      expect(ids, p.url).toContain(p.url);
    }
    expect(ids.length).toBeLessThanOrEqual(HUB_MAP_CAP);
    expect(Object.keys(drawing.positions).sort()).toEqual([...ids].sort());
  });

  it('is JSON: it comes back from a round trip equal, so it can be stored', () => {
    expect(drawing.version).toBe(1);
    expect(JSON.parse(JSON.stringify(drawing))).toEqual(drawing);
  });

  it('gives the same bytes whatever order the pages and links are listed in', () => {
    const again = checkMap([...built.page_results].reverse(), [...built.link_edges].reverse());
    expect(JSON.stringify(again)).toBe(JSON.stringify(drawing));
  });

  it('draws a check with no page as no node', () => {
    expect(checkMap([], [])).toEqual({ version: 1, nodes: [], positions: {} });
  });
});

describe('the layout keyed by page id', () => {
  // A crawled id is the site's to choose; these are the names an object literal would not keep.
  const NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
  const nodes: LayoutNode[] = [
    { id: 'https://a.test/', parent: null, depth: 0, kind: 'page', via: null },
    ...NAMES.map(
      (id): LayoutNode => ({ id, parent: 'https://a.test/', depth: 1, kind: 'page', via: 'link' }),
    ),
  ];

  it('gives each one a position of its own, in the result and in the warm seed', () => {
    const { positions, raw } = layoutMapFrom(nodes, null, true);
    for (const id of NAMES) {
      expect(Object.hasOwn(positions, id), id).toBe(true);
      expect(Object.hasOwn(raw, id), id).toBe(true);
    }
    expect(Object.keys(JSON.parse(JSON.stringify(positions))).sort()).toEqual(
      nodes.map((n) => n.id).sort(),
    );
  });

  it('takes them back as a seed', () => {
    const cold = layoutMapFrom(nodes, null, true);
    const warm = layoutMapFrom(nodes, cold.raw, true);
    expect(Object.keys(warm.positions).sort()).toEqual(nodes.map((n) => n.id).sort());
  });
});
