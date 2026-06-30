'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { BRAND } from '../../lib/brand';
import type { GraphData, GraphNode } from '@crawlmouse/types';
import { escapeHtml, nodeRadius, nodeStyle } from './graph-logic';
import { NodeDetail } from './NodeDetail';

// The signature visual: an internal-link graph on the brand cream surface — nodes colored by depth
// (homepage = ink, fading outward), sized by PageRank, orphans flashed in brand peach, and jsOnly
// nodes drawn detached (hollow, dashed) to carry the AI-crawler reachability story. Scroll/pinch to
// zoom, drag to pan; click a node for its detail. Client-only (canvas needs the browser); loaded via a
// dynamic import from LinkGraphSlot, never in unit tests. All decisions come from the pure, unit-tested
// graph-logic + NodeDetail; this is the thin render layer.

type SimNode = GraphNode & { x?: number; y?: number };
type SimLink = { source: string; target: string };

const HEIGHT = 360;

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
  const fgRef = useRef<ForceGraphMethods<SimNode, SimLink> | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<SimNode | null>(null);
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

  // Clone so the force simulation never mutates the shared fixture / contract objects. Pin the homepage
  // at the origin so it anchors the composition (every other node settles around the site's root).
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n, ...(n.isHomepage ? { fx: 0, fy: 0 } : {}) })) as SimNode[],
      links: graph.edges.map((e) => ({ source: e.from, target: e.to })) as SimLink[],
    }),
    [graph],
  );

  // Reduced-motion OR a heavy graph → pre-settle (warmup) and don't animate (cooldownTicks 0); else a
  // brief animated settle. Either way it always comes to rest (bounded cooldownTime) — never janky.
  const heavy = data.nodes.length > 250;
  const settleStill = reducedMotion || heavy;

  // Spread the nodes for readability (zoomToFit then frames whatever scale results — small or large).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force('charge') as { strength?: (n: number) => unknown } | undefined;
    charge?.strength?.(-160);
    const link = fg.d3Force('link') as { distance?: (n: number) => unknown } | undefined;
    link?.distance?.(48);
  }, [data]);

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-card bg-cream" style={{ height: HEIGHT }}>
      {width > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={data}
          width={width}
          height={HEIGHT}
          backgroundColor={BRAND.cream}
          warmupTicks={settleStill ? Math.min(data.nodes.length * 2, 400) : 0}
          cooldownTicks={settleStill ? 0 : undefined}
          cooldownTime={4000}
          d3VelocityDecay={0.3}
          enableNodeDrag={!settleStill}
          // Settle, then scale to fill the card — frames small + large graphs around the pinned homepage.
          onEngineStop={() => fgRef.current?.zoomToFit(settleStill ? 0 : 600, 48)}
          onNodeClick={(n) => setSelected(n as SimNode)}
          onBackgroundClick={() => setSelected(null)}
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
            // A subtle ring on the selected node so the canvas matches the open detail panel.
            if (selected && (selected as SimNode).id === node.id) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = BRAND.ink;
              ctx.stroke();
            }
          }}
          linkColor={() => 'rgba(26,26,24,0.12)'}
          linkWidth={1}
        />
      )}
      {selected && (
        <div className="absolute right-3 top-3 z-10 max-w-[16rem]">
          <NodeDetail node={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
