/**
 * The map drawing a finished check stores (CC-20b D10), and the layout's objects keyed by page id,
 * which stay plain so React can pass them to a client component. The web side proves the drawing is
 * the one the link-map explorer draws for the same check (apps/web/lib/v2/view/link-map.test.ts).
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
  const nodes: LayoutNode[] = [
    { id: 'https://a.test/', parent: null, depth: 0, kind: 'page', via: null },
    { id: 'https://a.test/b', parent: 'https://a.test/', depth: 1, kind: 'page', via: 'link' },
    { id: 'https://a.test/c', parent: 'https://a.test/', depth: 1, kind: 'page', via: 'link' },
  ];

  // React passes only plain objects from a server component to a client one, and the crawl screen
  // hands the positions to LiveMap (a client component): an object with a null prototype made
  // /v2-preview/screens/crawl answer 500 (CI run 42584145798). CC-SEC-2's Map converts at that
  // boundary; until then every object the layout returns is plain.
  it('returns plain objects, cold, warm and in the stored drawing, so React can pass them to the client', () => {
    const cold = layoutMapFrom(nodes, null, true);
    const warm = layoutMapFrom(nodes, cold.raw, true);
    const objects = {
      'cold positions': cold.positions,
      'cold raw': cold.raw,
      'warm positions': warm.positions,
      'warm raw': warm.raw,
      'checkMap positions': drawing.positions,
    };
    for (const [name, x] of Object.entries(objects)) {
      expect(Object.getPrototypeOf(x) === Object.prototype, name).toBe(true);
    }
    expect(Object.keys(warm.positions).sort()).toEqual(nodes.map((n) => n.id).sort());
  });
});
