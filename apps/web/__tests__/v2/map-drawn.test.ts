import { describe, expect, it } from 'vitest';
import { drawnPositions } from '../../components/v2/map/MapSvg';
import { BAND_ANCHOR, type LayoutNode } from '../../lib/v2/map-layout';

const node = (
  id: string,
  parent: string | null,
  depth: number | null,
  kind: LayoutNode['kind'] = 'page',
): LayoutNode => ({
  id,
  parent,
  depth,
  kind,
  via: parent ? 'link' : null,
});

describe('where a page not yet laid out is drawn', () => {
  // Listed deepest first, so the order the pages are given in cannot help.
  const nodes = [
    node('product', 'collection', 2),
    node('collection', 'home', 1),
    node('home', null, 0),
    node('orphan', null, null, 'orphan'),
  ];
  const home = { x: 400, y: 300 };

  it('is drawn at its nearest laid-out ancestor, a grandchild included', () => {
    const at = drawnPositions(nodes, { home });
    expect(at.get('collection')).toEqual(home);
    expect(at.get('product')).toEqual(home);
  });

  it('is drawn at the band only when no link reaches it', () => {
    const at = drawnPositions(nodes, { home });
    expect(at.get('orphan')).toEqual(BAND_ANCHOR);
  });

  it('is drawn at its own place once it has one', () => {
    const own = { x: 10, y: 20 };
    expect(drawnPositions(nodes, { home, product: own }).get('product')).toEqual(own);
  });
});
