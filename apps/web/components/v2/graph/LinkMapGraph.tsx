import type { CSSProperties } from 'react';
import {
  DEMO_EDGES,
  DEMO_GRAPH_VIEWBOX,
  DEMO_NODES,
  type GraphEdge,
  type GraphNode,
} from './demo-graph';
import styles from './LinkMapGraph.module.css';

/** An edge's drawn length. */
export const edgeLength = (e: GraphEdge) => Math.hypot(e.x2 - e.x1, e.y2 - e.y1);

export interface LinkMapGraphProps {
  /** `stage`: the large map that builds on first view. `thumb`: a still, cropped preview. */
  variant: 'stage' | 'thumb';
  /** For the stage: `instant` shows the finished map (the build already ran this session). */
  motion?: 'animate' | 'instant';
  /** The stage's description for screen readers. The thumbnail is decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** The example site's internal-link map: a hub, rings of pages, JavaScript-only pages, orphans. */
export function LinkMapGraph({
  variant,
  motion = 'animate',
  label,
  className,
  style,
}: LinkMapGraphProps) {
  const state = variant === 'thumb' ? 'none' : motion;
  const a11y =
    variant === 'stage' && label
      ? { role: 'img' as const, 'aria-label': label }
      : { 'aria-hidden': true as const };
  return (
    <svg
      viewBox={`0 0 ${DEMO_GRAPH_VIEWBOX.width} ${DEMO_GRAPH_VIEWBOX.height}`}
      width="100%"
      height="100%"
      preserveAspectRatio={variant === 'thumb' ? 'xMidYMid slice' : 'xMidYMid meet'}
      className={[styles.svg, className].filter(Boolean).join(' ')}
      style={style}
      data-v2-motion={state}
      focusable="false"
      {...a11y}
    >
      {DEMO_EDGES.map((e, i) => {
        const len = e.dash;
        return (
          <line
            key={`e${i}`}
            className={e.js ? `${styles.edge} ${styles.edgeJs}` : styles.edge}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            style={{ strokeDasharray: len, strokeDashoffset: len, animationDelay: `${e.delay}s` }}
          />
        );
      })}
      {DEMO_NODES.map((n, i) => (
        <Node key={`n${i}`} node={n} />
      ))}
    </svg>
  );
}

function Node({ node: n }: { node: GraphNode }) {
  const cls = `${styles.node} ${styles[n.role]}`;
  if (n.shape === 'circle') {
    return (
      <circle
        className={cls}
        cx={n.cx}
        cy={n.cy}
        r={n.r}
        style={{ animationDelay: `${n.delay}s`, transformOrigin: `${n.cx}px ${n.cy}px` }}
      />
    );
  }
  const origin = `${n.origin[0]}px ${n.origin[1]}px`;
  if (n.shape === 'polygon') {
    return (
      <polygon
        className={cls}
        points={n.points}
        style={{ animationDelay: `${n.delay}s`, transformOrigin: origin }}
      />
    );
  }
  return (
    <rect
      className={cls}
      x={n.x}
      y={n.y}
      width={n.w}
      height={n.h}
      style={{ animationDelay: `${n.delay}s`, transformOrigin: origin }}
    />
  );
}
