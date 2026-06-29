'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { BRAND } from '../../lib/brand';
import type { GraphData, GraphNode } from '../../lib/contract-v1_2';
import { escapeHtml, nodeRadius, nodeStyle } from './graph-logic';

// The signature visual: an internal-link graph on the brand cream surface — nodes colored by depth
// (homepage = ink, fading outward), sized by PageRank, orphans flashed in brand peach, and jsOnly
// nodes drawn detached (hollow, dashed) to carry the AI-crawler reachability story. Client-only
// (canvas needs the browser); loaded via a dynamic import from LinkGraphSlot, never in unit tests.
// All decisions come from the pure, unit-tested graph-logic; this is the thin render layer.

type SimNode = GraphNode & { x?: number; y?: number };

const HEIGHT = 340;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

export function LinkGraph({ graph }: { graph: GraphData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  // Measure the container so the canvas fits its column (rather than defaulting to the window size).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clone so the force simulation never mutates the shared fixture / contract objects.
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })) as SimNode[],
      links: graph.edges.map((e) => ({ source: e.from, target: e.to })),
    }),
    [graph],
  );

  // Reduced-motion OR a heavy graph → pre-settle (warmup) and don't animate (cooldownTicks 0); else a
  // brief animated settle. Either way it always comes to rest (bounded cooldownTime) — never janky.
  const heavy = data.nodes.length > 250;
  const settleStill = reducedMotion || heavy;

  return (
    <div ref={containerRef} className="overflow-hidden rounded-card bg-cream" style={{ height: HEIGHT }}>
      {width > 0 && (
        <ForceGraph2D
          graphData={data}
          width={width}
          height={HEIGHT}
          backgroundColor={BRAND.cream}
          warmupTicks={settleStill ? Math.min(data.nodes.length * 2, 400) : 0}
          cooldownTicks={settleStill ? 0 : undefined}
          cooldownTime={4000}
          d3VelocityDecay={0.3}
          enableNodeDrag={!settleStill}
          // Crawled titles are attacker-controlled and the tooltip uses innerHTML → escape (U12).
          nodeLabel={(n) => escapeHtml(((n as SimNode).title ?? (n as SimNode).url) || '')}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(n, ctx) => {
            const node = n as SimNode;
            if (node.x == null || node.y == null) return;
            const r = nodeRadius(node.pagerank);
            const style = nodeStyle(node);
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = style.fill;
            ctx.fill();
            if (style.dashed) {
              ctx.setLineDash([2, 2]);
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = style.stroke ?? BRAND.peach;
              ctx.stroke();
              ctx.setLineDash([]);
            } else if (style.stroke) {
              ctx.lineWidth = 2;
              ctx.strokeStyle = style.stroke;
              ctx.stroke();
            }
          }}
          linkColor={() => 'rgba(26,26,24,0.12)'}
          linkWidth={1}
        />
      )}
    </div>
  );
}
