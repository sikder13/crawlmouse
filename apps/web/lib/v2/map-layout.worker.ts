/**
 * Runs the link-map layout off the main thread. One request in, one layout out, tagged with the
 * request's version so the page can tell a stale answer from the latest; warm from `seed` when the
 * request carries one (`layoutMapFrom`, packages/engine/src/v2/layout/force-layout.ts).
 */
import { layoutMapFrom, type LayoutNode, type Point } from '@crawlmouse/engine/v2/layout';

export interface LayoutRequest {
  version: number;
  nodes: LayoutNode[];
  seed: Record<string, Point> | null;
  /** Whether the map has its last pages (force-layout.ts, PANELS). */
  complete: boolean;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  scope.postMessage({
    version: e.data.version,
    ...layoutMapFrom(e.data.nodes, e.data.seed, e.data.complete),
  });
};
