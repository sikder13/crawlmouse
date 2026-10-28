'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createLayoutScheduler } from '../../../lib/v2/layout-scheduler';
import { layoutInput, type LayoutNode, type Point } from '../../../lib/v2/map-layout';
import { LAYOUT_GAP_MS, MOTION, prefersReducedMotion } from '../../../lib/v2/motion';
import type { MapNode } from '../../../lib/v2/progress';
import { mapLabel } from '../../../lib/v2/map-label';
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
  still,
  className,
}: {
  nodes: readonly MapNode[];
  /** The layout of `nodes` as first rendered, drawn on the server. */
  initial: Record<string, Point>;
  /** Whether the crawl is still adding pages, as the map's description says. */
  building: boolean;
  /** Whether the replay has stopped: the map then takes the cold layout the server would draw. */
  still: boolean;
  className?: string;
}) {
  const input = useMemo(() => layoutInput(nodes), [nodes]);
  const { positions, settling } = useMapLayout(input, initial, still);
  const svgRef = useRef<SVGSVGElement>(null);
  useFlip(svgRef, input, positions);
  return (
    <MapSvg
      svgRef={svgRef}
      nodes={input}
      positions={positions}
      label={mapLabel(input, building)}
      className={className}
      settling={settling}
    />
  );
});

/**
 * The latest layout of `input`, laid out in the Worker. While the replay plays each layout is warm,
 * seeded from the last one's positions, so the map is nudged as pages arrive rather than redrawn;
 * once it is still, at its end or wherever it stopped, one cold layout, the pure function of the
 * graph the server draws, so a map at rest is the same however its pages arrived. `settling` is
 * true until the layout shown is for these pages and, at rest, the cold one: it is derived during
 * render, so the DOM never says "settled" before that layout has landed.
 */
function useMapLayout(input: LayoutNode[], initial: Record<string, Point>, still: boolean) {
  // The server's layout is the cold one.
  const [applied, setApplied] = useState({ forInput: input, positions: initial, cold: true });
  const requested = useRef({ input, cold: true });
  const asked = useRef(new Map<number, { input: LayoutNode[]; cold: boolean }>());
  const version = useRef(0);
  const raw = useRef<Record<string, Point> | null>(null);
  const scheduler = useRef<ReturnType<typeof createLayoutScheduler> | null>(null);

  const ask = (s: ReturnType<typeof createLayoutScheduler>, input: LayoutNode[], cold: boolean) => {
    version.current += 1;
    asked.current.set(version.current, { input, cold });
    s.request(version.current, input, cold ? null : raw.current);
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
      ask(s, requested.current.input, requested.current.cold);
    }
    return () => s.dispose();
    // The scheduler lives as long as the map; `input` is read through `requested`.
  }, []);

  useEffect(() => {
    const cold = still;
    const same = requested.current.input === input;
    // New pages need a layout; the same pages need one more only to become the cold one at the end.
    if (same && (requested.current.cold || !cold)) return;
    requested.current = { input, cold };
    if (scheduler.current) ask(scheduler.current, input, cold);
  }, [input, still]);

  return {
    positions: applied.positions,
    settling: applied.forInput !== input || (still && !applied.cold),
  };
}

/**
 * A move shorter than this, in view-box units (under two pixels on the 1280px stage), is drawn in
 * its new place without animating: animating hundreds of such moves at once costs frames for
 * nothing a reader can follow.
 */
const MIN_VISIBLE_MOVE = 2;

/** The transform that maps segment a onto segment b: rotation and uniform scale, then a shift. */
function segmentMatrix(a: [Point, Point], b: [Point, Point]): string | null {
  const px = a[1].x - a[0].x;
  const py = a[1].y - a[0].y;
  const qx = b[1].x - b[0].x;
  const qy = b[1].y - b[0].y;
  const p2 = px * px + py * py;
  if (p2 === 0) return null;
  const s = (qx * px + qy * py) / p2;
  const r = (qy * px - qx * py) / p2;
  const tx = b[0].x - (s * a[0].x - r * a[0].y);
  const ty = b[0].y - (r * a[0].x + s * a[0].y);
  return `matrix(${s}, ${r}, ${-r}, ${s}, ${tx}, ${ty})`;
}

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
      const matrix = moved ? segmentMatrix(nowSeg, wasSeg) : null;
      if (matrix) {
        el.animate([{ transform: matrix }, { transform: 'none' }], {
          duration: settle.duration_ms,
          easing: settle.easing,
        });
      }
    });
  }, [svgRef, input, positions]);
}
