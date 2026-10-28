'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createLayoutScheduler } from '../../../lib/v2/layout-scheduler';
import { layoutInput, type LayoutNode, type Point } from '../../../lib/v2/map-layout';
import { MOTION, prefersReducedMotion } from '../../../lib/v2/motion';
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
 */
export function LiveMap({
  nodes,
  initial,
  building,
  className,
}: {
  nodes: readonly MapNode[];
  /** The layout of `nodes` as first rendered, drawn on the server. */
  initial: Record<string, Point>;
  building: boolean;
  className?: string;
}) {
  const input = useMemo(() => layoutInput(nodes), [nodes]);
  const { positions, settling } = useMapLayout(input, initial);
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
}

function useMapLayout(input: LayoutNode[], initial: Record<string, Point>) {
  const [applied, setApplied] = useState({ version: 0, positions: initial });
  const version = useRef(0);
  const first = useRef(true);
  const scheduler = useRef<ReturnType<typeof createLayoutScheduler> | null>(null);

  useEffect(() => {
    const s = createLayoutScheduler((r) => setApplied(r), {
      minGapMs: MOTION.mapSettles.duration_ms,
    });
    scheduler.current = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    // The first input is the one the server already laid out.
    if (first.current) {
      first.current = false;
      return;
    }
    version.current += 1;
    scheduler.current?.request(version.current, input);
  }, [input]);

  return { positions: applied.positions, settling: applied.version !== version.current };
}

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
    drawn.current = { at, kinds, edges };
    if (!before || prefersReducedMotion()) return;

    const byId = new Map(input.map((n) => [n.id, n]));
    const pop = MOTION.nodeAppears;
    const settle = MOTION.mapSettles;
    svg.querySelectorAll<SVGElement>('[data-v2-node]').forEach((el) => {
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
      } else if (was.x !== now.x || was.y !== now.y) {
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

    svg.querySelectorAll<SVGLineElement>('[data-v2-edge]').forEach((el) => {
      const id = el.dataset.v2Edge!;
      const node = byId.get(id);
      if (!node?.parent) return;
      const nowSeg: [Point, Point] = [at.get(node.parent)!, at.get(id)!];
      if (!before.edges.has(id)) {
        const length = Math.hypot(nowSeg[1].x - nowSeg[0].x, nowSeg[1].y - nowSeg[0].y);
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
      const moved = nowSeg.some((p, i) => p.x !== wasSeg[i]!.x || p.y !== wasSeg[i]!.y);
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
