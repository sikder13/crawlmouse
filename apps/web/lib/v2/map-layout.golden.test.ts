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
import { generatedGraph } from './generated-graph';
import { layoutInput, layoutMapFrom, type Point } from './map-layout';
import { stateAt } from './progress';
import { RECORDING_NAMES, recording, type RecordingName } from './recordings';

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
    const nodes = generatedGraph(2_000, 12345);
    expect(sha(layoutMapFrom(nodes, null, true))).toBe('ae4b1b6ff21ef443');
  });
});
