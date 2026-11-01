import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LayoutNode } from './force-layout.js';
import {
  HUB_MAP_CAP,
  HUB_MIN_INBOUND,
  hubsAndNeighbours,
  type MapLink,
  type MapPage,
} from './hubs.js';

const url = (path: string) => `https://site.test${path}`;
const HOME = url('/');

function page(path: string, links_in: number, flags: Partial<MapPage> = {}): MapPage {
  const depth = path === '/' ? 0 : null;
  return { url: url(path), depth, links_in, is_orphan: false, js_only: false, ...flags };
}
const link = (from: string, to: string, js_only = false): MapLink => ({
  from_url: from === '/' ? HOME : url(from),
  to_url: url(to),
  js_only,
});
const byId = (nodes: LayoutNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n]));

describe('hubsAndNeighbours', () => {
  it(`keeps a page with ${HUB_MIN_INBOUND} inbound links and leaves out one with ${HUB_MIN_INBOUND - 1} that no hub links to`, () => {
    const pages = [page('/', 0), page('/hub', 3), page('/thin', 2)];
    const links = [link('/', '/hub'), link('/', '/thin')];
    const ids = hubsAndNeighbours(pages, links).map((n) => n.id);
    // The home page links to /thin, and the home page is kept, but it is not a hub (0 inbound).
    expect(ids).toEqual([HOME, url('/hub')]);
  });

  it('keeps the home page whatever its inbound links', () => {
    const nodes = hubsAndNeighbours([page('/', 0)], []);
    expect(nodes).toEqual([{ id: HOME, parent: null, depth: 0, kind: 'page', via: null }]);
  });

  it(`stops at ${HUB_MAP_CAP} nodes, keeping the most-linked hubs and the home page`, () => {
    const hubs = Array.from({ length: 200 }, (_, k) => page(`/h${k}`, 3 + k));
    const links = hubs.map((h) => link('/', new URL(h.url).pathname));
    const nodes = hubsAndNeighbours([page('/', 0), ...hubs], links);
    expect(nodes).toHaveLength(HUB_MAP_CAP);
    const kept = new Set(nodes.map((n) => n.id));
    expect(kept.has(HOME)).toBe(true);
    // The 149 hubs with the most inbound links: /h51 (54 links) to /h199 (202 links).
    for (let k = 51; k < 200; k++) expect(kept.has(url(`/h${k}`))).toBe(true);
    expect(kept.has(url('/h50'))).toBe(false);
  });

  it('fills the room left after the hubs with the pages they link to, most-linked first', () => {
    const pages = [
      page('/', 0),
      page('/hub', 5),
      page('/a', 1),
      page('/b', 2),
      page('/c', 2),
      page('/far', 1),
    ];
    const links = [
      link('/', '/hub'),
      link('/hub', '/a'),
      link('/hub', '/c'),
      link('/hub', '/b'),
      link('/a', '/far'),
    ];
    const ids = hubsAndNeighbours(pages, links).map((n) => n.id);
    // /far is linked only from /a, which is not a hub, so it is not a neighbour.
    expect(ids).toEqual([HOME, url('/a'), url('/b'), url('/c'), url('/hub')]);
    const ranked = hubsAndNeighbours(pages, links, 4).map((n) => n.id);
    // With room for four: home, the hub, then /b and /c (two inbound each) before /a (one).
    expect(ranked).toEqual([HOME, url('/b'), url('/c'), url('/hub')]);
  });

  it('hangs each page from its nearest kept ancestor on the shortest link path, with its click depth', () => {
    const pages = [page('/', 0), page('/section', 1), page('/hub', 4), page('/leaf', 3)];
    const links = [link('/', '/section'), link('/section', '/hub'), link('/hub', '/leaf', true)];
    const nodes = byId(hubsAndNeighbours(pages, links));
    expect(Object.keys(nodes).sort()).toEqual([HOME, url('/hub'), url('/leaf')]);
    // /section is not kept, so /hub hangs from the home page, two clicks down.
    expect(nodes[url('/hub')]).toEqual({
      id: url('/hub'),
      parent: HOME,
      depth: 2,
      kind: 'page',
      via: 'link',
    });
    expect(nodes[url('/leaf')]).toMatchObject({ parent: url('/hub'), depth: 3, via: 'javascript' });
  });

  it('draws a JavaScript-only page as one, and leaves out a page no link path from home reaches', () => {
    const pages = [page('/', 0), page('/js', 3, { js_only: true }), page('/island', 4)];
    const links = [link('/', '/js', true), link('/island', '/island')];
    const nodes = byId(hubsAndNeighbours(pages, links));
    expect(nodes[url('/js')]?.kind).toBe('js_only');
    expect(nodes[url('/island')]).toBeUndefined();
  });

  it('refuses a URL listed twice, which would make the result depend on the order', () => {
    expect(() => hubsAndNeighbours([page('/', 0), page('/a', 3), page('/a', 4)], [])).toThrow(
      /listed twice/,
    );
  });

  it('does not depend on the order pages and links are listed in (property)', () => {
    // Small dense graphs, so pages are often reached by two links of the same length and the
    // tree's choice between them is what the order could change.
    const graph = fc.integer({ min: 2, max: 12 }).chain((n) =>
      fc.record({
        pages: fc.tuple(
          ...Array.from({ length: n }, (_, k) =>
            fc
              .record({ links_in: fc.integer({ min: 0, max: 6 }), js_only: fc.boolean() })
              .map((f) => page(k === 0 ? '/' : `/p${k}`, f.links_in, { js_only: f.js_only })),
          ),
        ),
        links: fc.array(
          fc
            .tuple(fc.nat(n - 1), fc.integer({ min: 1, max: n - 1 }), fc.boolean())
            .map(([from, to, js]) => link(from === 0 ? '/' : `/p${from}`, `/p${to}`, js)),
          { maxLength: 40 },
        ),
        cap: fc.integer({ min: 1, max: n }),
      }),
    );
    fc.assert(
      fc.property(
        graph.chain((g) =>
          fc.tuple(
            fc.constant(g),
            fc.shuffledSubarray(g.pages, { minLength: g.pages.length }),
            fc.shuffledSubarray(g.links, { minLength: g.links.length }),
          ),
        ),
        ([g, pages, links]) => {
          expect(hubsAndNeighbours(pages, links, g.cap)).toEqual(
            hubsAndNeighbours(g.pages, g.links, g.cap),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
