/**
 * CC-19 acceptance for the layout a finished check stores: a 2,000-node graph lays out to the same
 * bytes on every run, inside the time budget. The web app's golden test
 * (apps/web/lib/v2/map-layout.golden.test.ts) pins the positions themselves to the ones main drew
 * before the layout moved here.
 */
import { TIMING_RUNS, expectWithinBudget } from '@crawlmouse/timing';
import { describe, expect, it } from 'vitest';
import { layoutMapFrom, type LayoutNode } from './force-layout.js';

/**
 * Under the 2 s the brief allows on CI, for one cold layout. Held as a median of runs by the shared
 * rule (docs/ops/ci-timing.md): the budget itself in the strict job, a ceiling over it here. A
 * single run read 2,055 ms on PR #46, on a commit where two runs had read 1,669 ms together.
 */
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
  it(`is byte-identical on every run, the cold one included, and the median of ${TIMING_RUNS} is inside the budget`, () => {
    // Each run lays out a graph of its own, built off the clock, so no cache keyed on the input can
    // make a measured run cheaper than a first layout.
    const { values } = expectWithinBudget(
      'force layout, 2,000 nodes',
      (nodes: LayoutNode[]) => JSON.stringify(layoutMapFrom(nodes, null, true)),
      { budgetMs: BUDGET_MS, setup: () => generatedGraph(2_000) },
    );
    for (const bytes of values) expect(bytes).toBe(values[0]);
  });
});
