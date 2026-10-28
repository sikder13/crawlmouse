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
  // A link is drawn once both its pages are laid out.
  const drawn: Drawn[] = nodes.map((n) => ({
    n,
    at: at.get(n.id)!,
    from: n.parent && positions[n.id] && positions[n.parent] ? at.get(n.parent)! : null,
  }));
  const groups: Drawn[][] = [];
  for (let i = 0; i < drawn.length; i += GROUP) groups.push(drawn.slice(i, i + GROUP));
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
        {groups.map((items, k) => (
          <EdgeGroup key={k} items={items} />
        ))}
      </g>
      <g>
        {groups.map((items, k) => (
          <NodeGroup key={k} items={items} />
        ))}
      </g>
    </svg>
  );
}

/**
 * Pages per memoised group. A new page renders its own group again, not an element for every page:
 * building hundreds of elements for each page the crawl adds costs frames, most of all in React's
 * development build, where the previews and their performance budget run.
 */
const GROUP = 24;

/** A page as drawn: where it is and, when its link is drawn, where the page linking to it is. */
interface Drawn {
  n: LayoutNode;
  at: Point;
  from: Point | null;
}

/** Two groups draw the same thing: the same pages, kinds and links, at the same places. */
function sameGroup(a: { items: Drawn[] }, b: { items: Drawn[] }): boolean {
  return (
    a.items.length === b.items.length &&
    a.items.every((x, i) => {
      const y = b.items[i]!;
      return (
        x.n.id === y.n.id &&
        x.n.parent === y.n.parent &&
        x.n.kind === y.n.kind &&
        x.n.depth === y.n.depth &&
        x.n.via === y.n.via &&
        x.at.x === y.at.x &&
        x.at.y === y.at.y &&
        x.from?.x === y.from?.x &&
        x.from?.y === y.from?.y
      );
    })
  );
}

const EdgeGroup = memo(function EdgeGroup({ items }: { items: Drawn[] }) {
  return (
    <>
      {items.map(({ n, at, from }) =>
        from ? (
          <Edge
            key={n.id}
            id={n.id}
            js={n.via === 'javascript'}
            x1={from.x}
            y1={from.y}
            x2={at.x}
            y2={at.y}
          />
        ) : null,
      )}
    </>
  );
}, sameGroup);

const NodeGroup = memo(function NodeGroup({ items }: { items: Drawn[] }) {
  return (
    <>
      {items.map(({ n, at }) => (
        <Node key={n.id} id={n.id} kind={n.kind} depth={n.depth} x={at.x} y={at.y} />
      ))}
    </>
  );
}, sameGroup);

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
