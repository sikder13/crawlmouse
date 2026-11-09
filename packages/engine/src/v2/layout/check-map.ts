/**
 * The map drawing of a finished check (CC-20b D10): the structure screen's layout, computed once when
 * the check is built and stored beside its evidence, so nothing recomputes it on view.
 */
import type { LinkEdge, PageResult } from '@crawlmouse/types/v2';
import type { Point } from './force-layout.js';

export interface MapDrawing {
  version: 1;
  /** Node positions by page URL. */
  positions: Record<string, Point>;
}

export function checkMap(_pages: readonly PageResult[], _edges: readonly LinkEdge[]): MapDrawing {
  throw new Error('checkMap: workstream D implements this');
}
