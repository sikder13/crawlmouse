import { memo } from 'react';
import type { MapNodeView } from '../../../../lib/v2/view/link-map';
import map from '../../map/MapSvg.module.css';
import styles from './Explorer.module.css';
import type { Viewport } from './viewport';

export interface StageProps {
  nodes: MapNodeView[];
  selected: string;
  /** The pages a pressed filter picks out; null with no filter pressed. */
  highlight: ReadonlySet<string> | null;
  view: Viewport;
  onSelect: (path: string) => void;
}

/** One page's shape, as the other maps draw it (MapSvg): a circle, a triangle or a square. */
function Shape({ n, className }: { n: MapNodeView; className?: string }) {
  const common = { 'data-v2-node': n.path, 'data-v2-kind': n.kind };
  const cls = (kind: string | undefined) => [kind, className].filter(Boolean).join(' ');
  if (n.kind === 'orphan') {
    return (
      <rect
        {...common}
        className={cls(map.orphan)}
        x={n.x - 4.5}
        y={n.y - 4.5}
        width={9}
        height={9}
      />
    );
  }
  if (n.kind === 'js_only') {
    return (
      <polygon
        {...common}
        className={cls(map.js)}
        points={`${n.x},${n.y - 5} ${n.x + 5},${n.y + 4} ${n.x - 5},${n.y + 4}`}
      />
    );
  }
  return (
    <circle
      {...common}
      className={cls(n.depth === 0 ? map.hub : map.page)}
      cx={n.x}
      cy={n.y}
      r={n.r}
    />
  );
}

/** The map's links and pages: drawn once, whatever is selected or filtered. */
const Layers = memo(function Layers({ nodes }: { nodes: MapNodeView[] }) {
  const at = new Map(nodes.map((n) => [n.path, n]));
  return (
    <>
      <g>
        {nodes.map((n) => {
          const from = n.parent ? at.get(n.parent) : undefined;
          return from ? (
            <line
              key={n.path}
              className={n.js ? `${map.edge} ${map.edgeJs}` : map.edge}
              x1={from.x}
              y1={from.y}
              x2={n.x}
              y2={n.y}
            />
          ) : null;
        })}
      </g>
      <g className={styles.nodes}>
        {nodes.map((n) => (
          <Shape key={n.path} n={n} />
        ))}
      </g>
    </>
  );
});

/**
 * The explorer's map as SVG (up to EXPLORER_SVG_MAX pages). It is a picture for the pointer: the
 * keyboard and screen readers walk the same pages in the list beside it (Explorer.tsx), so the
 * SVG is hidden from the accessibility tree.
 */
export function ExplorerSvg({ nodes, selected, highlight, view, onSelect }: StageProps) {
  const sel = nodes.find((n) => n.path === selected);
  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      className={[map.svg, styles.svg, highlight ? styles.dim : null].filter(Boolean).join(' ')}
      aria-hidden="true"
      focusable="false"
      data-v2-map=""
      data-v2-renderer="svg"
      onClick={(e) => {
        const path = (e.target as Element).closest('[data-v2-node]')?.getAttribute('data-v2-node');
        if (path) onSelect(path);
      }}
    >
      <Layers nodes={nodes} />
      {highlight ? (
        <g>
          {nodes
            .filter((n) => highlight.has(n.path))
            .map((n) => (
              <Shape key={n.path} n={n} className={styles.lit} />
            ))}
        </g>
      ) : null}
      {sel ? (
        <g className={styles.ring} data-v2-selected={sel.path}>
          <circle cx={sel.x} cy={sel.y} r={13} className={styles.ringIn} />
          <circle cx={sel.x} cy={sel.y} r={19} className={styles.ringOut} />
        </g>
      ) : null}
    </svg>
  );
}
