'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createLayoutScheduler } from '../../../lib/v2/layout-scheduler';
import {
  keepClear,
  layoutInput,
  nodeRadius,
  type LayoutNode,
  type Point,
} from '../../../lib/v2/map-layout';
import { LAYOUT_GAP_MS, MOTION, prefersReducedMotion } from '../../../lib/v2/motion';
import type { MapNode } from '../../../lib/v2/progress';
import { mapLabel } from '../../../lib/v2/map-label';
import { segmentSteps, segmentTransform } from '../../../lib/v2/segment-motion';
import { MapSvg, drawnPositions } from './MapSvg';

/**
 * The link map as the crawl builds it. Each time the reached pages change, the Worker lays the map
 * out again; results land at most once per settle, and nodes move from where they were drawn to
 * where they now belong. A new page appears beside the page whose link reached it.
 *
 * Every animation is a Web Animation over attributes already set to their final values, so motion
 * never changes the DOM: with reduced motion the map reaches exactly the same markup, unanimated.
 *
 * Memoised: a crawler test or a log line changes the screen many times a second without changing
 * the map, and redrawing every node for each would cost frames.
 */
export const LiveMap = memo(function LiveMap({
  nodes,
  initial,
  building,
  final,
  complete,
  className,
}: {
  nodes: readonly MapNode[];
  /** The layout of `nodes` as first rendered, drawn on the server. */
  initial: Record<string, Point>;
  /** Whether the crawl is still adding pages, as the map's description says. */
  building: boolean;
  /**
   * Whether the map has its last pages, or the replay has stopped short of them: it then takes the
   * cold layout the server would draw, once, and moves no more.
   */
  final: boolean;
  /** Whether the map has its last pages, which decides the panels its key pages keep clear of. */
  complete: boolean;
  className?: string;
}) {
  const input = useMemo(() => layoutInput(nodes), [nodes]);
  const { positions, laidOut, settling } = useMapLayout(input, initial, final, complete);
  const shown = useMemo(
    () => clearNewlyClassified(input, laidOut, positions, complete),
    [input, laidOut, positions, complete],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  useFlip(svgRef, input, shown);
  return (
    <MapSvg
      svgRef={svgRef}
      nodes={input}
      positions={shown}
      label={mapLabel(input, building)}
      className={className}
      settling={settling}
    />
  );
});

/**
 * A page classified JavaScript-only since the layout shown was taken is drawn clear of the panels
 * at once, as the next layout will draw it, rather than where it was laid out as an ordinary page:
 * otherwise it lights up under a panel and stays there until that layout lands. `positions` itself
 * when there is no such page, so a frame with nothing to move asks for no motion.
 */
export function clearNewlyClassified(
  input: readonly LayoutNode[],
  laidOut: readonly LayoutNode[],
  positions: Record<string, Point>,
  complete: boolean,
): Record<string, Point> {
  if (input === laidOut) return positions;
  const was = new Map(laidOut.map((n) => [n.id, n.kind]));
  let moved: Record<string, Point> | null = null;
  for (const n of input) {
    const at = positions[n.id];
    if (n.kind !== 'js_only' || was.get(n.id) === 'js_only' || !at) continue;
    const parent = n.parent ? positions[n.parent] : undefined;
    const clear = keepClear(at, nodeRadius(n), complete, undefined, parent);
    if (clear !== at) (moved ??= { ...positions })[n.id] = clear;
  }
  return moved ?? positions;
}

/**
 * The latest layout of `input`, laid out in the Worker. While pages still arrive each layout is
 * warm, seeded from the last one's positions, so pages move less far between layouts than laid out
 * anew; once the map is final (its last page placed, or the replay stopped), one cold layout, the
 * pure function of the graph the server draws, so a map at rest is the same however its pages
 * arrived. `settling` is true until the layout shown is for these pages and, once final, the cold
 * one: it is derived during render, so the DOM never says "settled" before that layout has landed.
 */
function useMapLayout(
  input: LayoutNode[],
  initial: Record<string, Point>,
  final: boolean,
  complete: boolean,
) {
  // The server's layout is the cold one.
  const [applied, setApplied] = useState({ forInput: input, positions: initial, cold: true });
  const requested = useRef({ input, cold: true, complete });
  const asked = useRef(new Map<number, { input: LayoutNode[]; cold: boolean }>());
  const version = useRef(0);
  const raw = useRef<Record<string, Point> | null>(null);
  const scheduler = useRef<ReturnType<typeof createLayoutScheduler> | null>(null);

  const ask = (
    s: ReturnType<typeof createLayoutScheduler>,
    input: LayoutNode[],
    cold: boolean,
    complete: boolean,
  ) => {
    version.current += 1;
    asked.current.set(version.current, { input, cold });
    s.request(version.current, input, cold ? null : raw.current, complete);
  };

  useEffect(() => {
    const s = createLayoutScheduler(
      (r) => {
        const job = asked.current.get(r.version);
        for (const v of asked.current.keys()) if (v <= r.version) asked.current.delete(v);
        raw.current = r.raw;
        if (job) setApplied({ forInput: job.input, positions: r.positions, cold: job.cold });
      },
      { minGapMs: LAYOUT_GAP_MS },
    );
    scheduler.current = s;
    // A layout asked for before this scheduler existed (a remount) is asked for again.
    if (requested.current.input !== input || !requested.current.cold) {
      ask(s, requested.current.input, requested.current.cold, requested.current.complete);
    }
    return () => s.dispose();
    // The scheduler lives as long as the map; `input` is read through `requested`.
  }, []);

  useEffect(() => {
    const cold = final;
    const same = requested.current.input === input;
    // New pages need a layout; the same pages need one more only to become the cold one at the end.
    if (same && (requested.current.cold || !cold)) return;
    requested.current = { input, cold, complete };
    if (scheduler.current) ask(scheduler.current, input, cold, complete);
  }, [input, final, complete]);

  return {
    positions: applied.positions,
    laidOut: applied.forInput,
    settling: applied.forInput !== input || (final && !applied.cold),
  };
}

/**
 * A move shorter than this, in view-box units (under two pixels on the 1280px stage), is drawn in
 * its new place without animating: animating hundreds of such moves at once costs frames for
 * nothing a reader can follow.
 */
const MIN_VISIBLE_MOVE = 2;

function useFlip(
  svgRef: React.RefObject<SVGSVGElement | null>,
  input: LayoutNode[],
  positions: Record<string, Point>,
) {
  const drawn = useRef<{
    at: Map<string, Point>;
    kinds: Map<string, string>;
    edges: Set<string>;
    positions: Record<string, Point>;
  } | null>(null);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const at = drawnPositions(input, positions);
    const kinds = new Map(input.map((n) => [n.id, n.kind]));
    const edges = new Set(
      input.filter((n) => n.parent && positions[n.id] && positions[n.parent]).map((n) => n.id),
    );
    const before = drawn.current;
    drawn.current = { at, kinds, edges, positions };
    if (!before || prefersReducedMotion()) return;

    const byId = new Map(input.map((n) => [n.id, n]));
    // Screen pixels per view-box unit, read only when a link is drawn (reading lays the page out):
    // under non-scaling-stroke a dash is measured on the screen.
    let pxPerUnit: number | undefined;
    const pop = MOTION.nodeAppears;
    const settle = MOTION.mapSettles;
    // Between layouts only new and re-classified pages can need motion; a new layout can move all.
    const relaid = positions !== before.positions;
    const changed = relaid
      ? svg.querySelectorAll<SVGElement>('[data-v2-node]')
      : input
          .filter((n) => !before.at.has(n.id) || before.kinds.get(n.id) !== n.kind)
          .map((n) => svg.querySelector<SVGElement>(`[data-v2-node="${CSS.escape(n.id)}"]`))
          .filter((el): el is SVGElement => el !== null);
    changed.forEach((el) => {
      const id = el.dataset.v2Node!;
      const now = at.get(id)!;
      const was = before.at.get(id);
      if (!was) {
        const node = byId.get(id);
        const from = (node?.parent && before.at.get(node.parent)) || now;
        el.animate(
          [
            {
              opacity: 0,
              transform: `translate(${from.x - now.x}px, ${from.y - now.y}px) scale(0.2)`,
            },
            { opacity: 1, transform: 'none' },
          ],
          { duration: pop.duration_ms, easing: pop.easing },
        );
      } else if (Math.hypot(was.x - now.x, was.y - now.y) >= MIN_VISIBLE_MOVE) {
        el.animate(
          [
            { transform: `translate(${was.x - now.x}px, ${was.y - now.y}px)` },
            { transform: 'none' },
          ],
          { duration: settle.duration_ms, easing: settle.easing },
        );
      } else if (before.kinds.get(id) !== kinds.get(id)) {
        const lit = MOTION.classified;
        el.animate(
          [
            { transform: 'scale(0.2)', opacity: 0.4 },
            { transform: 'none', opacity: 1 },
          ],
          {
            duration: lit.duration_ms,
            easing: lit.easing,
          },
        );
      }
    });

    const edgesToCheck = relaid
      ? svg.querySelectorAll<SVGLineElement>('[data-v2-edge]')
      : [...edges]
          .filter((id) => !before.edges.has(id))
          .map((id) => svg.querySelector<SVGLineElement>(`[data-v2-edge="${CSS.escape(id)}"]`))
          .filter((el): el is SVGLineElement => el !== null);
    edgesToCheck.forEach((el) => {
      const id = el.dataset.v2Edge!;
      const node = byId.get(id);
      if (!node?.parent) return;
      const nowSeg: [Point, Point] = [at.get(node.parent)!, at.get(id)!];
      if (!before.edges.has(id)) {
        pxPerUnit ??= svg.getScreenCTM()?.a || 1;
        const length = Math.hypot(nowSeg[1].x - nowSeg[0].x, nowSeg[1].y - nowSeg[0].y) * pxPerUnit;
        const draw = MOTION.edgeDraws;
        el.animate(
          [
            { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
            { strokeDasharray: `${length}`, strokeDashoffset: '0' },
          ],
          { duration: draw.duration_ms, easing: draw.easing },
        );
        return;
      }
      const wasSeg: [Point, Point] = [before.at.get(node.parent)!, before.at.get(id)!];
      if (!wasSeg[0] || !wasSeg[1]) return;
      const moved = nowSeg.some(
        (p, i) => Math.hypot(p.x - wasSeg[i]!.x, p.y - wasSeg[i]!.y) >= MIN_VISIBLE_MOVE,
      );
      // Turned and stretched about its parent end in steps, so both ends stay on their pages.
      const steps = moved ? segmentSteps(wasSeg, nowSeg) : null;
      if (steps) {
        el.animate(
          steps.map((st) => ({ offset: st.offset, transform: segmentTransform(st, nowSeg[0]) })),
          { duration: settle.duration_ms, easing: settle.easing },
        );
      }
    });
  }, [svgRef, input, positions]);
}
