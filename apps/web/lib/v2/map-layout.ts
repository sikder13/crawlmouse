/**
 * The link map's layout: a deterministic force-directed simulation over the pages the crawl has
 * reached. Springs pull each page towards the page whose link reached it, pages repel each other,
 * a gravity wider than it is tall fits the map's 2:1 stage, and a collision pass keeps shapes apart.
 *
 * The result is a pure function of the graph: the same pages and links give the same positions,
 * whatever order they arrive in and however the work was batched. That is what lets the crawl
 * screen run it in a Web Worker (map-layout.worker.ts) and still end on the same picture the
 * server draws for Home and the Result thumbnail. No trigonometry is used, so no engine's `sin` or
 * `cos` can move a node.
 */
import type { MapNode } from './progress';

export const MAP_VIEWBOX = { width: 1160, height: 560 } as const;

export interface LayoutNode {
  id: string;
  /** The page whose link reached this one; null for the home page and pages no link reaches yet. */
  parent: string | null;
  /** Clicks from the home page; null when no link path reaches it. */
  depth: number | null;
  kind: MapNode['kind'];
  /** How the link to it was found; a JavaScript link is drawn dashed. The layout ignores it. */
  via: MapNode['via'];
}

export interface Point {
  x: number;
  y: number;
}

/**
 * How large a node is drawn, from the locked map (docs/design/v2/screens/Final-Home.dc.html): the
 * hub 10, pages one click away 6.5, two clicks 5, further 4; a JavaScript-only triangle and an
 * orphan square take the space of their bounding circle.
 */
export function nodeRadius(n: Pick<LayoutNode, 'depth' | 'kind'>): number {
  if (n.kind === 'orphan') return 6.4;
  if (n.kind === 'js_only') return 5.8;
  if (n.depth === 0) return 10;
  if (n.depth === 1) return 6.5;
  if (n.depth === 2) return 5;
  return 4;
}

/** The layout's input from the crawl state: each node's parent and click depth. */
export function layoutInput(nodes: readonly MapNode[]): LayoutNode[] {
  const byUrl = new Map(nodes.map((n) => [n.url, n]));
  const depth = new Map<string, number | null>();
  const depthOf = (url: string, guard: number): number | null => {
    if (depth.has(url)) return depth.get(url)!;
    const n = byUrl.get(url);
    let d: number | null = null;
    if (n && new URL(url).pathname === '/') d = 0;
    else if (n?.from && byUrl.has(n.from) && guard < nodes.length) {
      const up = depthOf(n.from, guard + 1);
      d = up === null ? null : up + 1;
    }
    depth.set(url, d);
    return d;
  };
  return nodes.map((n) => ({
    id: n.url,
    parent: n.from && byUrl.has(n.from) ? n.from : null,
    depth: depthOf(n.url, 0),
    kind: n.kind,
    via: n.via,
  }));
}

/** FNV-1a over the id: a stable number for each page, the simulation's only source of variety. */
function hash(s: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** A unit vector chosen by the id, with square roots only. */
function direction(id: string): Point {
  const x = hash(id, 1) - 0.5;
  const y = hash(id, 2) - 0.5;
  const len = Math.sqrt(x * x + y * y) || 1;
  return { x: x / len, y: y / len };
}

/**
 * Distance from the centre, with the vertical stretched by the ratio of the two gravities, so the
 * linked pages' cloud (wider than tall by that ratio) is a circle in this measure.
 */
function cloudDistance(x: number, y: number): number {
  const v = y * CLOUD_ASPECT;
  return Math.sqrt(x * x + v * v);
}

const TICKS = 300;
const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / TICKS);
const VELOCITY_KEEP = 0.6;
const LINK_DISTANCE = 34;
const LINK_STRENGTH = 0.5;
const CHARGE = 900;
const CHARGE_RANGE = 240;
const GRAVITY = { x: 0.03, y: 0.05 };
const CLOUD_ASPECT = Math.sqrt(GRAVITY.y / GRAVITY.x);
/**
 * Pages no link reaches have no spring. Each is drawn instead towards a ring just outside the linked
 * pages, so they sit at the cloud's edge, as on the locked map.
 */
const RING_GAP = 1.2;
const RING_PERCENTILE = 0.9;
const RING_STRENGTH = 0.5;
const GAP = 3;
const MARGIN = 14;
const MAX_ENLARGE = 1.6;

export function layoutMap(input: readonly LayoutNode[]): Record<string, Point> {
  const nodes = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = nodes.length;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const parentOf = nodes.map((node) => (node.parent ? (index.get(node.parent) ?? -1) : -1));
  const radius = nodes.map(nodeRadius);
  const home = nodes.findIndex((node) => node.depth === 0);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  // Seeds: parents before children, each child a link's length from its parent; pages no link
  // reaches start on a wide ring outside the rest.
  const seedOrder = nodes
    .map((_, i) => i)
    .sort((a, b) => (nodes[a]!.depth ?? Infinity) - (nodes[b]!.depth ?? Infinity) || a - b);
  for (const i of seedOrder) {
    const dir = direction(nodes[i]!.id);
    const p = parentOf[i]!;
    if (i === home) continue;
    if (p >= 0) {
      x[i] = x[p]! + dir.x * LINK_DISTANCE;
      y[i] = y[p]! + dir.y * LINK_DISTANCE;
    } else {
      x[i] = dir.x * LINK_DISTANCE * 4;
      y[i] = (dir.y * LINK_DISTANCE * 4) / CLOUD_ASPECT;
    }
  }

  let alpha = 1;
  for (let tick = 0; tick < TICKS; tick++) {
    alpha -= alpha * ALPHA_DECAY;
    for (let i = 0; i < n; i++) {
      const p = parentOf[i]!;
      if (p < 0) continue;
      const dx = x[i]! - x[p]!;
      const dy = y[i]! - y[p]!;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - LINK_DISTANCE) / d) * LINK_STRENGTH * alpha;
      vx[i]! -= dx * f * 0.75;
      vy[i]! -= dy * f * 0.75;
      vx[p]! += dx * f * 0.25;
      vy[p]! += dy * f * 0.25;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[j]! - x[i]!;
        const dy = y[j]! - y[i]!;
        const d2 = Math.max(dx * dx + dy * dy, 1);
        if (d2 > CHARGE_RANGE * CHARGE_RANGE) continue;
        const f = (CHARGE * alpha) / d2;
        vx[i]! -= dx * f * 0.05;
        vy[i]! -= dy * f * 0.05;
        vx[j]! += dx * f * 0.05;
        vy[j]! += dy * f * 0.05;
      }
    }
    // The ring: just beyond most of the linked pages. A percentile, not the farthest page, so one
    // long arm of deep pages does not throw the unlinked ones out to the edge of the stage.
    const reaches: number[] = [];
    for (let i = 0; i < n; i++) {
      if (parentOf[i]! >= 0) reaches.push(cloudDistance(x[i]!, y[i]!));
    }
    reaches.sort((a, b) => a - b);
    const reach = reaches[Math.floor(reaches.length * RING_PERCENTILE)] ?? 0;
    const ring = Math.max(reach, LINK_DISTANCE) * RING_GAP;
    for (let i = 0; i < n; i++) {
      if (parentOf[i]! < 0 && i !== home) {
        const e = cloudDistance(x[i]!, y[i]!) || 1e-6;
        const f = ((ring - e) / e) * RING_STRENGTH * alpha;
        vx[i]! += x[i]! * f;
        vy[i]! += y[i]! * f;
      } else {
        vx[i]! -= x[i]! * GRAVITY.x * alpha;
        vy[i]! -= y[i]! * GRAVITY.y * alpha;
      }
      vx[i]! *= VELOCITY_KEEP;
      vy[i]! *= VELOCITY_KEEP;
      x[i]! += vx[i]!;
      y[i]! += vy[i]!;
    }
    if (home >= 0) {
      x[home] = 0;
      y[home] = 0;
    }
  }

  // Fit: the home page at the centre, every shape inside the box with a margin.
  const hx = MAP_VIEWBOX.width / 2 - MARGIN;
  const hy = MAP_VIEWBOX.height / 2 - MARGIN;
  let scale = Infinity;
  for (let i = 0; i < n; i++) {
    if (Math.abs(x[i]!) > 0) scale = Math.min(scale, (hx - radius[i]!) / Math.abs(x[i]!));
    if (Math.abs(y[i]!) > 0) scale = Math.min(scale, (hy - radius[i]!) / Math.abs(y[i]!));
  }
  // A small site is drawn at about its natural size, not blown up to fill the stage.
  scale = Number.isFinite(scale) ? Math.min(scale, MAX_ENLARGE) : 1;
  for (let i = 0; i < n; i++) {
    x[i]! *= scale;
    y[i]! *= scale;
  }

  // Collision, after the fit, so no two shapes touch at the size they are drawn.
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[j]! - x[i]!;
        const dy = y[j]! - y[i]!;
        const min = radius[i]! + radius[j]! + GAP;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1;
        const push = (min - d) / 2;
        const ux = d2 === 0 ? direction(nodes[j]!.id).x : dx / d;
        const uy = d2 === 0 ? direction(nodes[j]!.id).y : dy / d;
        const wi = i === home ? 0 : j === home ? 2 : 1;
        const wj = 2 - wi;
        x[i]! -= ux * push * wi;
        y[i]! -= uy * push * wi;
        x[j]! += ux * push * wj;
        y[j]! += uy * push * wj;
        moved = true;
      }
    }
    for (let i = 0; i < n; i++) {
      x[i] = Math.max(-hx + radius[i]!, Math.min(hx - radius[i]!, x[i]!));
      y[i] = Math.max(-hy + radius[i]!, Math.min(hy - radius[i]!, y[i]!));
    }
    if (!moved) break;
  }

  const out: Record<string, Point> = {};
  nodes.forEach((node, i) => {
    out[node.id] = {
      x: Math.round((MAP_VIEWBOX.width / 2 + x[i]!) * 10) / 10,
      y: Math.round((MAP_VIEWBOX.height / 2 + y[i]!) * 10) / 10,
    };
  });
  return out;
}
