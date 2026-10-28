/**
 * Runs the link-map layout off the main thread. One request in, one layout out, tagged with the
 * request's version so the page can tell a stale answer from the latest.
 */
import { layoutMap, type LayoutNode } from './map-layout';

export interface LayoutRequest {
  version: number;
  nodes: LayoutNode[];
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  scope.postMessage({ version: e.data.version, positions: layoutMap(e.data.nodes) });
};
