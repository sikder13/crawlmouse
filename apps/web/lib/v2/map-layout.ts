/**
 * The link map's layout: a deterministic force-directed simulation over the pages the crawl has
 * reached. Springs pull each page towards the page whose link reached it (a link from the home page
 * is longer, so its sections spread out), pages repel each other, gravity pulls harder up and down
 * than sideways so the map spreads across its 2:1 stage, and a collision pass keeps shapes apart.
 * Pages no link reaches are drawn in a band across the top (ORPHAN_GAP).
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

/** A site's home page: the origin and nothing after its slash. */
const HOME = /^https?:\/\/[^/]+\/$/;

/**
 * The layout's input from the crawl state: each page a link path from the home page reaches, with
 * its parent and click depth, and each page classified orphan or JavaScript-only. A page the crawl
 * fetched before any link reached it (from the sitemap, say) is not drawn until one does, so it
 * appears beside the page whose link reached it.
 */
export function layoutInput(nodes: readonly MapNode[]): LayoutNode[] {
  const byUrl = new Map(nodes.map((n) => [n.url, n]));
  const depth = new Map<string, number | null>();
  const depthOf = (url: string, guard: number): number | null => {
    if (depth.has(url)) return depth.get(url)!;
    const n = byUrl.get(url);
    let d: number | null = null;
    if (n && HOME.test(url)) d = 0;
    else if (n?.from && byUrl.has(n.from) && guard < nodes.length) {
      const up = depthOf(n.from, guard + 1);
      d = up === null ? null : up + 1;
    }
    depth.set(url, d);
    return d;
  };
  return nodes
    .map((n) => ({
      id: n.url,
      parent: n.from && byUrl.has(n.from) ? n.from : null,
      depth: depthOf(n.url, 0),
      kind: n.kind,
      via: n.via,
    }))
    .filter((n) => n.depth !== null || n.kind !== 'page')
    .map((n) => (n.depth === null ? { ...n, parent: null } : n));
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

const TICKS = 300;
const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / TICKS);
const VELOCITY_KEEP = 0.6;
const LINK_DISTANCE = 30;
/**
 * A link from the home page is as long as the section it reaches is large: a page with nothing
 * under it sits near the hub, a section with many pages reaches out, room around it for them. Equal
 * lengths would settle the home page's links on a ring, a wheel rather than a web.
 */
const HUB_LINK = { base: 60, perRootPage: 25 };
const LINK_STRENGTH = 0.5;
const CHARGE = 1200;
const CHARGE_RANGE = 260;
/** Gravity pulls five times harder up and down than sideways: the map spreads across its 2:1 stage. */
const GRAVITY = { x: 0.012, y: 0.06 };
const GAP = 3;
const MARGIN = 14;
const MAX_ENLARGE = 1.6;

/** How much more the fit may widen the map than it heightens it, to fill the 2:1 stage. */
const MAX_STRETCH = 1.4;

/**
 * Pages no link reaches (orphans, once classified) are not part of the cloud. They are drawn in a
 * band across the top of the map, outside the cloud, in rows of BAND_ROW pages ORPHAN_GAP apart,
 * each a little up or down by its id. The band is centred at BAND_X, on the stretch of the top edge
 * that lies between the crawl screen's status column and its verdict panel, and between Home's
 * progress card and its grade cards; tests/visual/layout.spec.ts checks no panel covers one.
 */
export const ORPHAN_GAP = 30;
export const BAND_X = 527;
const BAND_ROW = 5;
const BAND_ROW_HEIGHT = 26;
const BAND_SCATTER = 18;

/** Where a page no link reaches is drawn before the layout has placed it: the band's centre. */
export const BAND_ANCHOR: Point = { x: BAND_X, y: MARGIN + 6.4 };

export function layoutMap(input: readonly LayoutNode[]): Record<string, Point> {
  const nodes = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = nodes.length;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const parentOf = nodes.map((node) => (node.parent ? (index.get(node.parent) ?? -1) : -1));
  const radius = nodes.map(nodeRadius);
  const home = nodes.findIndex((node) => node.depth === 0);
  // How many pages hang under each node, through first links.
  const below = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let p = parentOf[i]!, guard = 0; p >= 0 && guard < n; p = parentOf[p]!, guard++) {
      below[p]! += 1;
    }
  }
  const length = parentOf.map((p, i) =>
    p >= 0 && p === home
      ? HUB_LINK.base + HUB_LINK.perRootPage * Math.sqrt(below[i]!)
      : LINK_DISTANCE,
  );
  // The cloud: the home page and every page a link reaches. The rest go in the band.
  const cloud = nodes.map((_, i) => i).filter((i) => i === home || parentOf[i]! >= 0);
  const band = nodes.map((_, i) => i).filter((i) => i !== home && parentOf[i]! < 0);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  // Seeds: parents before children, each child a link's length from its parent.
  const seedOrder = [...cloud].sort(
    (a, b) => (nodes[a]!.depth ?? Infinity) - (nodes[b]!.depth ?? Infinity) || a - b,
  );
  for (const i of seedOrder) {
    const p = parentOf[i]!;
    if (p < 0) continue;
    const dir = direction(nodes[i]!.id);
    x[i] = x[p]! + dir.x * length[i]!;
    y[i] = y[p]! + dir.y * length[i]!;
  }

  let alpha = 1;
  for (let tick = 0; tick < TICKS; tick++) {
    alpha -= alpha * ALPHA_DECAY;
    for (const i of cloud) {
      const p = parentOf[i]!;
      if (p < 0) continue;
      const dx = x[i]! - x[p]!;
      const dy = y[i]! - y[p]!;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - length[i]!) / d) * LINK_STRENGTH * alpha;
      vx[i]! -= dx * f * 0.75;
      vy[i]! -= dy * f * 0.75;
      vx[p]! += dx * f * 0.25;
      vy[p]! += dy * f * 0.25;
    }
    for (let a = 0; a < cloud.length; a++) {
      const i = cloud[a]!;
      for (let b = a + 1; b < cloud.length; b++) {
        const j = cloud[b]!;
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
    for (const i of cloud) {
      vx[i]! -= x[i]! * GRAVITY.x * alpha;
      vy[i]! -= y[i]! * GRAVITY.y * alpha;
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

  // The band's height, taken off the top of the box the cloud is fitted into.
  const rows = Math.ceil(band.length / BAND_ROW);
  const bandHeight = rows ? rows * BAND_ROW_HEIGHT + BAND_SCATTER : 0;

  // Fit: the home page at the centre of the box below the band, every shape inside it.
  const hx = MAP_VIEWBOX.width / 2 - MARGIN;
  const hy = (MAP_VIEWBOX.height - bandHeight) / 2 - MARGIN;
  let scale = Infinity;
  for (const i of cloud) {
    if (Math.abs(x[i]!) > 0) scale = Math.min(scale, (hx - radius[i]!) / Math.abs(x[i]!));
    if (Math.abs(y[i]!) > 0) scale = Math.min(scale, (hy - radius[i]!) / Math.abs(y[i]!));
  }
  // A small site is enlarged at most MAX_ENLARGE times (and MAX_STRETCH more across), not blown
  // up to fill the stage.
  scale = Number.isFinite(scale) ? Math.min(scale, MAX_ENLARGE) : 1;
  // Then wider, up to MAX_STRETCH, where the stage has room across.
  let scaleX = scale * MAX_STRETCH;
  for (const i of cloud) {
    if (Math.abs(x[i]!) > 0) scaleX = Math.min(scaleX, (hx - radius[i]!) / Math.abs(x[i]!));
  }
  const shift = bandHeight / 2;
  for (const i of cloud) {
    x[i]! *= scaleX;
    y[i] = y[i]! * scale + shift;
  }

  // The band: rows across the top, each centred, in the nodes' (sorted) order.
  band.forEach((i, k) => {
    const row = Math.floor(k / BAND_ROW);
    const inRow = Math.min(BAND_ROW, band.length - row * BAND_ROW);
    x[i] =
      BAND_X -
      MAP_VIEWBOX.width / 2 +
      ((k % BAND_ROW) - (inRow - 1) / 2 + (hash(nodes[i]!.id, 4) - 0.5) * 0.5) * ORPHAN_GAP;
    y[i] =
      -MAP_VIEWBOX.height / 2 +
      MARGIN +
      radius[i]! +
      row * BAND_ROW_HEIGHT +
      hash(nodes[i]!.id, 3) * BAND_SCATTER;
  });
  const top = (i: number) => -MAP_VIEWBOX.height / 2 + MARGIN + bandHeight + radius[i]!;

  // Collision, after the fit, so no two shapes touch at the size they are drawn. The band's pages
  // hold their places; the cloud's give way, and stay below the band.
  const fixed = (i: number) => i === home || parentOf[i]! < 0;
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[j]! - x[i]!;
        const dy = y[j]! - y[i]!;
        const min = radius[i]! + radius[j]! + GAP;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        if (fixed(i) && fixed(j)) continue;
        const d = Math.sqrt(d2) || 1;
        const push = (min - d) / 2;
        const ux = d2 === 0 ? direction(nodes[j]!.id).x : dx / d;
        const uy = d2 === 0 ? direction(nodes[j]!.id).y : dy / d;
        const wi = fixed(i) ? 0 : fixed(j) ? 2 : 1;
        const wj = 2 - wi;
        x[i]! -= ux * push * wi;
        y[i]! -= uy * push * wi;
        x[j]! += ux * push * wj;
        y[j]! += uy * push * wj;
        moved = true;
      }
    }
    for (const i of cloud) {
      x[i] = Math.max(-hx + radius[i]!, Math.min(hx - radius[i]!, x[i]!));
      y[i] = Math.max(top(i), Math.min(MAP_VIEWBOX.height / 2 - MARGIN - radius[i]!, y[i]!));
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
