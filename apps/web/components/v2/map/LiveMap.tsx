'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createLayoutScheduler } from '../../../lib/v2/layout-scheduler';
import {
  MAP_VIEWBOX,
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
  // Panels are drawn over the map from 1024px (CrawlScreen.module.css); narrower, a map that grows
  // as the replay plays keeps its pages where they fall, as a finished one does. A cold layout, at
  // rest, keeps to `complete` alone, as the server's does, so the two match at every width.
  const overlaid = useOverlaid();
  const playingClear = complete || !overlaid;
  const { positions, laidOut, settling } = useMapLayout(input, initial, final, complete, overlaid);
  const shown = useMemo(
    () => clearNewlyClassified(input, laidOut, positions, playingClear),
    [input, laidOut, positions, playingClear],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const scale = useScreenScale(svgRef);
  useFlip(svgRef, scale, input, shown);
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
  const placed: Point[] = [];
  for (const n of input) {
    if (n.kind !== 'js_only' || was.get(n.id) === 'js_only') continue;
    const parent = n.parent ? positions[n.parent] : undefined;
    // A page that arrives already JavaScript-only has no place yet: it starts from its parent's.
    const at = positions[n.id] ?? parent;
    if (!at) continue;
    const r = nodeRadius(n);
    let clear = keepClear(at, r, complete, undefined, parent);
    // Siblings cleared to the same place step down the panel's edge, apart, as the layout would.
    for (
      let k = 1;
      k <= 8 && placed.some((q) => Math.hypot(q.x - clear.x, q.y - clear.y) < 2 * r + 3);
      k++
    ) {
      clear = keepClear({ x: clear.x, y: clear.y + 2 * r + 3 }, r, complete);
    }
    if (clear !== at) {
      (moved ??= { ...positions })[n.id] = clear;
      placed.push(clear);
    }
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
  isComplete: boolean,
  overlaid: boolean,
) {
  // The panel set a request keeps clear of: the server's choice for a cold layout, and the running
  // panels while the map grows only where they are drawn.
  const complete = final ? isComplete : isComplete || !overlaid;
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
    // New pages need a layout; the same pages need one again only to become the cold one, or to
    // keep clear of the other set of panels (the map completing after its last page arrived, or the
    // window crossing 1024px).
    if (same && (requested.current.cold || !cold) && requested.current.complete === complete) {
      return;
    }
    requested.current = { input, cold, complete };
    if (scheduler.current) ask(scheduler.current, input, cold, complete);
  }, [input, final, complete]);

  return {
    positions: applied.positions,
    laidOut: applied.forInput,
    settling: applied.forInput !== input || (final && !applied.cold),
  };
}

/** Whether panels are drawn over the map: the window is 1024px wide or more. */
function useOverlaid(): boolean {
  // The server draws for the widest case; the first render on the client matches it.
  const [overlaid, setOverlaid] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setOverlaid(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return overlaid;
}

/**
 * A move shorter than this many screen pixels is drawn in its new place without animating:
 * animating hundreds of such moves at once costs frames for nothing a reader can follow. In
 * view-box units it is `MIN_VISIBLE_PX / pxPerUnit`: about 2 on the 1280px stage, about 7 on a
 * 390px phone, where the map is drawn at under a third of a pixel to the unit.
 */
const MIN_VISIBLE_PX = 2;

/** Whether a page moving from `a` to `b` moves far enough on the screen to animate. */
const visibleMove = (a: Point, b: Point, pxPerUnit: number) =>
  Math.hypot(a.x - b.x, a.y - b.y) * pxPerUnit >= MIN_VISIBLE_PX;

/**
 * How long a new link waits before it is drawn: a link is drawn from its parent, so where the
 * parent is still moving to its new place (from `was` to `now`) it waits, hidden, until the parent
 * is there; otherwise it is drawn at once.
 */
export function edgeDrawDelay(was: Point | undefined, now: Point, pxPerUnit = 1): number {
  return was && visibleMove(was, now, pxPerUnit) ? MOTION.mapSettles.duration_ms : 0;
}

/**
 * Screen pixels per view-box unit, kept from the map's size as a ResizeObserver reports it after
 * layout, so the motion code does not lay the page out to ask (MapSvg draws the view box
 * `xMidYMid meet`, so the scale is the smaller of the two ratios). Null until the first report.
 */
function useScreenScale(svgRef: React.RefObject<SVGSVGElement | null>) {
  const scale = useRef<number | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box && box.width > 0 && box.height > 0) {
        scale.current = Math.min(box.width / MAP_VIEWBOX.width, box.height / MAP_VIEWBOX.height);
      }
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [svgRef]);
  return scale;
}

function useFlip(
  svgRef: React.RefObject<SVGSVGElement | null>,
  scale: React.RefObject<number | null>,
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
    // Screen pixels per view-box unit: under non-scaling-stroke a dash is measured on the screen,
    // and a move is visible or not on the screen. Kept from the last resize; read from the page
    // (which lays it out) only before the first.
    let px: number | undefined;
    const pxPerUnit = () => (px ??= scale.current ?? (svg.getScreenCTM()?.a || 1));
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
      } else if (visibleMove(was, now, pxPerUnit())) {
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
        const length =
          Math.hypot(nowSeg[1].x - nowSeg[0].x, nowSeg[1].y - nowSeg[0].y) * pxPerUnit();
        const draw = MOTION.edgeDraws;
        const delay = edgeDrawDelay(before.at.get(node.parent), nowSeg[0], pxPerUnit());
        el.animate(
          [
            { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
            { strokeDasharray: `${length}`, strokeDashoffset: '0' },
          ],
          {
            duration: draw.duration_ms,
            easing: draw.easing,
            delay,
            fill: 'backwards',
          },
        );
        return;
      }
      const wasSeg: [Point, Point] = [before.at.get(node.parent)!, before.at.get(id)!];
      if (!wasSeg[0] || !wasSeg[1]) return;
      const moved = nowSeg.some((p, i) => visibleMove(p, wasSeg[i]!, pxPerUnit()));
      // Turned and stretched about its parent end in steps, so both ends stay on their pages.
      const steps = moved ? segmentSteps(wasSeg, nowSeg) : null;
      if (steps) {
        el.animate(
          steps.map((st) => ({ offset: st.offset, transform: segmentTransform(st, nowSeg[0]) })),
          { duration: settle.duration_ms, easing: settle.easing },
        );
      }
    });
  }, [svgRef, scale, input, positions]);
}
