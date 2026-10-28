import { memo, type Ref } from 'react';
import {
  BAND_ANCHOR,
  MAP_VIEWBOX,
  nodeRadius,
  type LayoutNode,
  type Point,
} from '../../../lib/v2/map-layout';
import styles from './MapSvg.module.css';

const CENTRE: Point = { x: MAP_VIEWBOX.width / 2, y: MAP_VIEWBOX.height / 2 };

/**
 * Where each node is drawn: its laid-out place, or, until the layout has placed it, the place of
 * the page whose link reached it (so a new page appears beside its parent and settles from there),
 * or for a page no link reaches, the band where the layout puts such pages.
 */
export function drawnPositions(
  nodes: readonly LayoutNode[],
  positions: Readonly<Record<string, Point>>,
): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const n of nodes) {
    const own = positions[n.id];
    const parent = n.parent ? positions[n.parent] : undefined;
    out.set(n.id, own ?? parent ?? (n.depth === 0 ? CENTRE : BAND_ANCHOR));
  }
  return out;
}

export interface MapSvgProps {
  nodes: readonly LayoutNode[];
  positions: Readonly<Record<string, Point>>;
  /** The map's description for screen readers; absent, the map is decorative. */
  label?: string;
  /** `meet` shows the whole map; `slice` fills a thumbnail and crops. */
  fit?: 'meet' | 'slice';
  className?: string;
  svgRef?: Ref<SVGSVGElement>;
  /** Set while a newer layout is still being computed. */
  settling?: boolean;
}

/** The link map, drawn: links first, then pages over them. Pure, so the server can draw it. */
export function MapSvg({
  nodes,
  positions,
  label,
  fit = 'meet',
  className,
  svgRef,
  settling = false,
}: MapSvgProps) {
  const at = drawnPositions(nodes, positions);
  const a11y = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const };
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
      width="100%"
      height="100%"
      preserveAspectRatio={`xMidYMid ${fit}`}
      className={[styles.svg, className].filter(Boolean).join(' ')}
      focusable="false"
      data-v2-map=""
      data-v2-layout={settling ? 'settling' : 'settled'}
      {...a11y}
    >
      <g>
        {nodes.map((n) => {
          if (!n.parent || !positions[n.id] || !positions[n.parent]) return null;
          const from = at.get(n.parent)!;
          const to = at.get(n.id)!;
          return (
            <Edge
              key={n.id}
              id={n.id}
              js={n.via === 'javascript'}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((n) => {
          const p = at.get(n.id)!;
          return <Node key={n.id} id={n.id} kind={n.kind} depth={n.depth} x={p.x} y={p.y} />;
        })}
      </g>
    </svg>
  );
}

/**
 * One link and one page, each memoised on its own values: as the crawl adds a page, only the new
 * elements and the ones that moved render again.
 */
const Edge = memo(function Edge({
  id,
  js,
  x1,
  y1,
  x2,
  y2,
}: {
  id: string;
  js: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  return (
    <line
      data-v2-edge={id}
      className={js ? `${styles.edge} ${styles.edgeJs}` : styles.edge}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
    />
  );
});

const Node = memo(function Node({
  id,
  kind,
  depth,
  x,
  y,
}: Pick<LayoutNode, 'id' | 'kind' | 'depth'> & Point) {
  const common = { 'data-v2-node': id, 'data-v2-kind': kind };
  if (kind === 'orphan') {
    return (
      <rect {...common} className={styles.orphan} x={x - 4.5} y={y - 4.5} width={9} height={9} />
    );
  }
  if (kind === 'js_only') {
    const points = `${x},${y - 5} ${x + 5},${y + 4} ${x - 5},${y + 4}`;
    return <polygon {...common} className={styles.js} points={points} />;
  }
  return (
    <circle
      {...common}
      className={depth === 0 ? styles.hub : styles.page}
      cx={x}
      cy={y}
      r={nodeRadius({ kind, depth })}
    />
  );
});
