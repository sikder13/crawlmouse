/**
 * A site-shaped tree for testing the map at size: a home page, sections under it, pages under those
 * to depth six, a JavaScript link on every seventh page and an orphan on every thirteenth. A linear
 * congruential generator picks each parent from `seed`, so the graph is the same on every run and
 * every machine. The layout's golden test (map-layout.golden.test.ts) uses seed 12345; the
 * explorer's 2,000-node preview uses 2026, the seed of the engine's own copy of this generator
 * (packages/engine/src/v2/layout/force-layout.test.ts), which is a test file the web app cannot import.
 */
import type { LayoutNode } from './map-layout';

export function generatedGraph(size: number, seed: number): LayoutNode[] {
  let state = seed;
  const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296;
  const id = (i: number) => (i === 0 ? 'https://gen.test/' : `https://gen.test/p/${i}`);
  const nodes: LayoutNode[] = [{ id: id(0), parent: null, depth: 0, kind: 'page', via: null }];
  for (let i = 1; i < size; i++) {
    if (i % 13 === 0) {
      nodes.push({ id: id(i), parent: null, depth: null, kind: 'orphan', via: null });
      continue;
    }
    const linked = nodes.filter((n) => n.depth !== null && n.depth < 6);
    const parent = linked[Math.floor(next() * linked.length)]!;
    const js = i % 7 === 0;
    nodes.push({
      id: id(i),
      parent: parent.id,
      depth: parent.depth! + 1,
      kind: js ? 'js_only' : 'page',
      via: js ? 'javascript' : 'link',
    });
  }
  return nodes;
}
