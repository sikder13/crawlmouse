import type { Ref } from 'react';
import { MAP_VIEWBOX, nodeRadius, type LayoutNode, type Point } from '../../../lib/v2/map-layout';
import styles from './MapSvg.module.css';

const CENTRE: Point = { x: MAP_VIEWBOX.width / 2, y: MAP_VIEWBOX.height / 2 };

/**
 * Where each node is drawn: its laid-out place, or, until the layout has placed it, the place of
 * the page whose link reached it (so a new page appears beside its parent and settles from there).
 */
export function drawnPositions(
  nodes: readonly LayoutNode[],
  positions: Readonly<Record<string, Point>>,
): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const n of nodes) {
    const own = positions[n.id];
    const parent = n.parent ? positions[n.parent] : undefined;
    out.set(n.id, own ?? parent ?? CENTRE);
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
            <line
              key={n.id}
              data-v2-edge={n.id}
              className={n.via === 'javascript' ? `${styles.edge} ${styles.edgeJs}` : styles.edge}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((n) => (
          <Node key={n.id} node={n} at={at.get(n.id)!} />
        ))}
      </g>
    </svg>
  );
}

function Node({ node: n, at }: { node: LayoutNode; at: Point }) {
  const common = { 'data-v2-node': n.id, 'data-v2-kind': n.kind };
  if (n.kind === 'orphan') {
    return (
      <rect
        {...common}
        className={styles.orphan}
        x={at.x - 4.5}
        y={at.y - 4.5}
        width={9}
        height={9}
      />
    );
  }
  if (n.kind === 'js_only') {
    const points = `${at.x},${at.y - 5} ${at.x + 5},${at.y + 4} ${at.x - 5},${at.y + 4}`;
    return <polygon {...common} className={styles.js} points={points} />;
  }
  return (
    <circle
      {...common}
      className={n.depth === 0 ? styles.hub : styles.page}
      cx={at.x}
      cy={at.y}
      r={nodeRadius(n)}
    />
  );
}
