/**
 * CC-19 acceptance for the layout a finished check stores: a 2,000-node graph lays out to the same
 * bytes on every run, inside the time budget. The web app's golden test
 * (apps/web/lib/v2/map-layout.golden.test.ts) pins the positions themselves to the ones main drew
 * before the layout moved here.
 */
import { describe, expect, it } from 'vitest';
import { layoutMapFrom, type LayoutNode } from './force-layout.js';

/** Under the 2 s the brief allows on CI, measured on one cold layout. */
const BUDGET_MS = 2_000;

/**
 * A site-shaped tree, the same on every run: a home page, pages under it to depth six chosen by a
 * linear congruential generator, a JavaScript link on every seventh page, an orphan on every
 * thirteenth.
 */
function generatedGraph(size: number): LayoutNode[] {
  let state = 2026;
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

describe('the layout of a 2,000-node graph', () => {
  const nodes = generatedGraph(2_000);

  it('is byte-identical across two runs, and each run finishes inside the budget', () => {
    const runs = [0, 1].map(() => {
      const started = performance.now();
      const bytes = JSON.stringify(layoutMapFrom(nodes, null, true));
      return { bytes, ms: performance.now() - started };
    });
    expect(runs[1]!.bytes).toBe(runs[0]!.bytes);
    for (const run of runs) expect(run.ms).toBeLessThan(BUDGET_MS);
  });
});
