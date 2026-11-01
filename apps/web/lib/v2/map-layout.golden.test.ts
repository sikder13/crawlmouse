/**
 * CC-19 moved the layout core into the engine (packages/engine/src/v2/layout) so the server and the
 * crawl screen run one algorithm. These hashes were taken from the layout as it stood before the move
 * (origin/main 86ea1d5); every position of every frame below must come out bit for bit the same, or
 * the move changed the picture.
 *
 * Each recording is replayed a second at a time to its end, laid out cold and warm (seeded from the
 * previous frame, as the crawl screen does), running and complete, and every number is hashed. The
 * generated graph is large enough that the repulsion pass's pair pruning is exercised at scale.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { layoutInput, layoutMapFrom, type LayoutNode, type Point } from './map-layout';
import { stateAt } from './progress';
import { RECORDING_NAMES, recording, type RecordingName } from './recordings';

/**
 * A site-shaped tree: a home page, sections under it, pages under those to depth six, a JavaScript
 * link on every seventh page and an orphan on every thirteenth. A linear congruential generator picks
 * each parent, so the graph is the same on every run and every machine.
 */
function generatedGraph(size: number): LayoutNode[] {
  let state = 12345;
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

const sha = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

function replay(name: RecordingName): string {
  const events = recording(name).events;
  const last = Math.max(...events.map((e) => e.at_ms));
  const frames: unknown[] = [];
  let seed: Record<string, Point> | null = null;
  for (let t = 0; t <= last + 1_000; t += 1_000) {
    const nodes = layoutInput(stateAt(events, t).nodes);
    const complete = t > last;
    const cold = layoutMapFrom(nodes, null, complete);
    const warm: { positions: Record<string, Point>; raw: Record<string, Point> } = layoutMapFrom(
      nodes,
      seed,
      complete,
    );
    seed = warm.raw;
    frames.push([cold, warm]);
  }
  return sha(frames);
}

const GOLDEN: Record<RecordingName, string> = {
  'bad-site': '4846ef48ed0c663e',
  'clean-site': '10b672344c9c5c12',
  'clean-site-rerun': '570c1f2421a0ba6c',
  'challenged-site': '8b8d9eb3757348f6',
};

describe('the layout is the one main drew before the move', () => {
  for (const name of RECORDING_NAMES) {
    it(`replays ${name} to the same positions, frame by frame`, () => {
      expect(replay(name)).toBe(GOLDEN[name]);
    });
  }

  it('lays the generated 2,000-node graph out to the same positions', () => {
    const nodes: LayoutNode[] = generatedGraph(2_000);
    expect(sha(layoutMapFrom(nodes, null, true))).toBe('ae4b1b6ff21ef443');
  });
});
