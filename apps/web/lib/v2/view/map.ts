/**
 * The link map of a recording at a moment, laid out on the server: the finished map for Home and
 * the Result thumbnail, and the first frame of the crawl screen. Memoised per recording and moment.
 */
import { layoutInput, layoutMap, type LayoutNode, type Point } from '../map-layout';
import { mapIsComplete, stateAt } from '../progress';
import { recording, type RecordingName } from '../recordings';

export interface MapDrawing {
  nodes: LayoutNode[];
  positions: Record<string, Point>;
}

const drawn = new Map<string, MapDrawing>();

export function mapDrawing(name: RecordingName, at = Infinity): MapDrawing {
  const key = `${name}@${at}`;
  let d = drawn.get(key);
  if (!d) {
    const state = stateAt(recording(name).events, at);
    const nodes = layoutInput(state.nodes);
    d = { nodes, positions: layoutMap(nodes, mapIsComplete(state)) };
    drawn.set(key, d);
  }
  return d;
}
