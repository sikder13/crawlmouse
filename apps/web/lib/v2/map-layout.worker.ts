/**
 * Runs the link-map layout off the main thread. One request in, one layout out, tagged with the
 * request's version so the page can tell a stale answer from the latest; warm from `seed` when the
 * request carries one (map-layout.ts, layoutMapFrom).
 */
import { layoutMapFrom, type LayoutNode, type Point } from './map-layout';

export interface LayoutRequest {
  version: number;
  nodes: LayoutNode[];
  seed: Record<string, Point> | null;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  scope.postMessage({ version: e.data.version, ...layoutMapFrom(e.data.nodes, e.data.seed) });
};
