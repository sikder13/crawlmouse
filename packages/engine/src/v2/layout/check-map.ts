/**
 * The map drawing of a finished check (CC-20b D10): the structure screen's layout, computed once when
 * the check is built and stored beside its evidence, so nothing recomputes it on view.
 *
 * It is the drawing the link-map explorer draws of a check's record in its hubs scope
 * (apps/web/lib/v2/view/link-map.ts): the hubs and their neighbours (`hubsAndNeighbours`, hubs.ts),
 * laid out cold as a finished map (`layoutMap`, force-layout.ts). Both are pure functions of the
 * pages and links, so the stored drawing is the one the screen would compute.
 */
import type { LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { layoutMap, type LayoutNode, type Point } from './force-layout.js';
import { hubsAndNeighbours } from './hubs.js';

export interface MapDrawing {
  version: 1;
  /** The pages drawn, sorted by URL, each with the page whose link reached it and its depth. */
  nodes: LayoutNode[];
  /** Node positions by page URL, in the map's view box (`MAP_VIEWBOX`). */
  positions: Record<string, Point>;
}

export function checkMap(pages: readonly PageResult[], edges: readonly LinkEdge[]): MapDrawing {
  const nodes = hubsAndNeighbours(pages, edges);
  return { version: 1, nodes, positions: layoutMap(nodes) };
}
