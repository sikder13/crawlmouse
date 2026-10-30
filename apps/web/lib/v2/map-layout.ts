/**
 * The link map's layout: a deterministic force-directed simulation over the pages the crawl has
 * reached. Springs pull each page towards the page whose link reached it (a link from the home page
 * is longer, so its sections spread out), pages repel each other, gravity pulls harder up and down
 * than sideways so the map spreads across its 2:1 stage, and a collision pass keeps shapes apart.
 * Pages no link reaches are drawn in a band across the top (ORPHAN_GAP).
 *
 * The cold layout (`layoutMap`, or `layoutMapFrom` with no seed) is a pure function of the graph:
 * the same pages and links give the same positions, whatever order they arrive in and however the
 * work was batched. That is what lets the crawl screen run it in a Web Worker
 * (map-layout.worker.ts) and still come to rest on the same picture the server draws for Home and
 * the Result thumbnail. A warm layout depends on its seed as well. No trigonometry is used, so no engine's `sin` or
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
/** Gravity pulls five times harder up and down than sideways: the map spreads across the stage. */
const GRAVITY = { x: 0.012, y: 0.06 };
const GAP = 3;
const MARGIN = 14;
/** Wider at the sides: the crawl screen's step panel stands 24px in from the stage's left edge. */
const MARGIN_X = 40;
const MAX_ENLARGE = 1.6;

/** How much more the fit may widen the map than it heightens it, to fill the 2:1 stage. */
const MAX_STRETCH = 1.4;

/** A panel's place over the map, in view-box units from its top left. */
export interface PanelRect {
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where panels are drawn over the map, each at the width where it covers the most of it, measured
 * on the crawl screen at 1:55 of the bad site's replay and on Home. The pages the map exists to
 * show, the orphans and the JavaScript-only pages, are kept out from under them.
 * - `running`: over the crawl screen while the map is still growing. The step panel, the legend and
 *   the fetch log are drawn over the map from 1024px: the step panel's rectangle is its 1024px
 *   footprint, where it covers the most of the map; the legend's and the log's take in their 1024
 *   and 1200px footprints. The crawler verdicts are drawn over it from 1200px, where the stage has
 *   reached its full size.
 * - `finished`: over a map with its last pages, on Home, the Result and the finished crawl screen:
 *   Home's progress card (its largest extent from 761 to 1200px) and the crawl screen's step-panel
 *   head, with the card drawn around it (over the map while grades are computed: its right edge as
 *   at 1024px, its bottom as from 1200px), the legend, and Home's grade cards
 *   from 1200px. A map at rest keeps its pages where the layout put them unless one of these
 *   covers them.
 * tests/visual/layout.spec.ts checks no panel covers a key page, on maps at rest: every preview,
 * and the crawl screen paused while it runs.
 */
export const PANELS: { running: readonly PanelRect[]; finished: readonly PanelRect[] } = {
  running: [
    { name: 'step panel', left: 0, right: 448, top: 0, bottom: 535 },
    { name: 'legend', left: 0, right: 595, top: 538, bottom: MAP_VIEWBOX.height },
    {
      name: 'fetch log',
      left: 601,
      right: MAP_VIEWBOX.width,
      top: 415,
      bottom: MAP_VIEWBOX.height,
    },
    { name: 'crawler verdicts', left: 671, right: MAP_VIEWBOX.width, top: 0, bottom: 380 },
  ],
  finished: [
    {
      name: "Home's progress card, the step panel's head",
      left: 0,
      right: 448,
      top: 0,
      bottom: 90,
    },
    { name: 'legend', left: 0, right: 595, top: 538, bottom: MAP_VIEWBOX.height },
    { name: "Home's grade cards", left: 790, right: MAP_VIEWBOX.width, top: 0, bottom: 363 },
  ],
};

/** The stretch of the map's top edge no panel covers: between the step panel and the verdicts. */
const FREE_TOP = {
  left: Math.max(...PANELS.running.filter((p) => p.top === 0 && p.left === 0).map((p) => p.right)),
  right: Math.min(...PANELS.running.filter((p) => p.top === 0 && p.left > 0).map((p) => p.left)),
};

/**
 * Pages no link reaches (orphans, once classified) are not part of the cloud. They are drawn in a
 * band across the top of the map, outside the cloud, in rows about ORPHAN_GAP apart, each moved a
 * little across and up or down by its id, so they read as scattered pages rather than a row of
 * keys. The band is centred on FREE_TOP, and a row holds as many as fit inside it, moved as they
 * may be. Past BAND_ROWS_SPACIOUS rows' worth, the spacing shrinks so they share BAND_AREA_HEIGHT
 * of the free stretch evenly, rows no further apart than pages across, down to MIN_ORPHAN_GAP: a
 * site with many orphans shows them as scattered pages, not long stripes. Past that the band grows
 * down the map, and with enough orphans it reaches the fetch log; map-layout.test.ts draws maps of
 * up to 400 pages, a third of them orphans, and finds none under a panel.
 */
export const ORPHAN_GAP = 48;
/** The closest a row's pages are drawn: their 9-unit squares never touch, moved as they may be. */
const MIN_ORPHAN_GAP = 13;
/** How far across a band page moves by its id, as a share of its row's spacing either way. */
const BAND_JITTER = 0.15;
const ORPHAN_HALF = nodeRadius({ kind: 'orphan', depth: null });
export const BAND_X = (FREE_TOP.left + FREE_TOP.right) / 2;
/** How many orphans a row of FREE_TOP holds at spacing `gap`, each moved as it may be. */
const rowHolds = (gap: number) =>
  Math.floor((FREE_TOP.right - FREE_TOP.left - 2 * ORPHAN_HALF) / gap - 2 * BAND_JITTER) + 1;
const BAND_ROW = rowHolds(ORPHAN_GAP);
const BAND_ROWS_SPACIOUS = 2;
/** The height a crowded band's pages share before it grows: about four spacious rows. */
const BAND_AREA_HEIGHT = 120;
const BAND_ROW_HEIGHT = 26;
/**
 * The band's room is kept from the start, for this many rows: orphans are known only once the
 * crawl is done, and a row made for them then shifts every page on the map at once. One row is
 * kept, so a map with few orphans does not sit low; a site with more than a row's worth, as the bad
 * site's seven are, moves its map down by half a row when they are classified.
 */
const BAND_ROWS_KEPT = 1;
/**
 * How far a band page moves up or down by its id. Rows are BAND_ROW_HEIGHT apart and a square is
 * 9 units with GAP around it, so this much leaves two rows' squares apart however their ids fall;
 * across, a page moves at most BAND_JITTER of its row's spacing, so neighbours stay apart too.
 */
const BAND_SCATTER = 14;

/** How much room a JavaScript-only page keeps from a panel's edge, beyond its size and GAP. */
const PANEL_SLACK = 6;

/** Where a page no link reaches is drawn before the layout has placed it: the band's centre. */
export const BAND_ANCHOR: Point = { x: BAND_X, y: MARGIN + 6.4 };

/**
 * A warm start: the simulation picks up from the positions a previous layout reached (`raw`, before
 * its fit) for the pages it already had, and runs a short, cool settle, so pages move less far
 * between layouts than they would laid out anew (map-layout.test.ts). A layout from no seed is the
 * cold one, a pure
 * function of the graph; the map ends on it (LiveMap), so a finished map is the same however its
 * pages arrived.
 */
const WARM = { alpha: 0.15, ticks: 100 };

/**
 * The map from scratch: the same pages and links give the same positions. `complete` says whether
 * the map has its last pages, which decides the panels its key pages are kept clear of (PANELS).
 */
export function layoutMap(input: readonly LayoutNode[], complete = true): Record<string, Point> {
  return layoutMapFrom(input, null, complete).positions;
}

/** A layout, cold with no seed or warm from one, and the simulation's positions to seed the next. */
export function layoutMapFrom(
  input: readonly LayoutNode[],
  seed: Readonly<Record<string, Point>> | null,
  complete = true,
): { positions: Record<string, Point>; raw: Record<string, Point> } {
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
    const was = seed && Object.hasOwn(seed, nodes[i]!.id) ? seed[nodes[i]!.id]! : null;
    if (was) {
      x[i] = was.x;
      y[i] = was.y;
      continue;
    }
    if (p < 0) continue;
    const dir = direction(nodes[i]!.id);
    x[i] = x[p]! + dir.x * length[i]!;
    y[i] = y[p]! + dir.y * length[i]!;
  }

  let alpha = seed ? WARM.alpha : 1;
  const ticks = seed ? WARM.ticks : TICKS;
  for (let tick = 0; tick < ticks; tick++) {
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

  const raw: Record<string, Point> = {};
  for (const i of cloud) raw[nodes[i]!.id] = { x: x[i]!, y: y[i]! };

  // The band's height, taken off the top of the box the cloud is fitted into.
  // The band's rows: BAND_ROW to a row while BAND_ROWS_SPACIOUS hold them; past that, a spacing
  // that shares BAND_AREA_HEIGHT of the free stretch evenly, rows as far apart as pages across
  // (never further than spacious rows), each page moved up or down by less than a row less a
  // square, so no two squares touch.
  let perRow = BAND_ROW;
  let gap = ORPHAN_GAP;
  let rowHeight = BAND_ROW_HEIGHT;
  let scatter = BAND_SCATTER;
  if (band.length > BAND_ROW * BAND_ROWS_SPACIOUS) {
    const freeWidth = FREE_TOP.right - FREE_TOP.left - 2 * ORPHAN_HALF;
    gap = Math.max(
      MIN_ORPHAN_GAP,
      Math.min(ORPHAN_GAP, Math.sqrt((freeWidth * BAND_AREA_HEIGHT) / band.length)),
    );
    perRow = rowHolds(gap);
    rowHeight = Math.min(BAND_ROW_HEIGHT, gap);
    scatter = Math.min(BAND_SCATTER, rowHeight - 9.5);
  }
  const rows = Math.max(BAND_ROWS_KEPT, Math.ceil(band.length / perRow));
  const bandHeight = rows * rowHeight + scatter;

  // Fit: the home page at the centre of the box below the band, every shape inside it.
  const hx = MAP_VIEWBOX.width / 2 - MARGIN_X;
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
    const row = Math.floor(k / perRow);
    const inRow = Math.min(perRow, band.length - row * perRow);
    x[i] =
      BAND_X -
      MAP_VIEWBOX.width / 2 +
      ((k % perRow) - (inRow - 1) / 2 + (hash(nodes[i]!.id, 4) - 0.5) * 2 * BAND_JITTER) * gap;
    y[i] =
      -MAP_VIEWBOX.height / 2 +
      MARGIN +
      radius[i]! +
      row * rowHeight +
      hash(nodes[i]!.id, 3) * scatter;
  });
  const top = (i: number) => -MAP_VIEWBOX.height / 2 + MARGIN + bandHeight + radius[i]!;

  // JavaScript-only pages out from under the panels, each to the clear place nearest the page
  // whose link reached it, below the band and inside the map.
  for (const i of cloud) {
    if (nodes[i]!.kind !== 'js_only') continue;
    const p = parentOf[i]!;
    const clear = keepClear(
      { x: x[i]! + MAP_VIEWBOX.width / 2, y: y[i]! + MAP_VIEWBOX.height / 2 },
      radius[i]!,
      complete,
      top(i) + MAP_VIEWBOX.height / 2,
      p >= 0 ? { x: x[p]! + MAP_VIEWBOX.width / 2, y: y[p]! + MAP_VIEWBOX.height / 2 } : undefined,
    );
    x[i] = clear.x - MAP_VIEWBOX.width / 2;
    y[i] = clear.y - MAP_VIEWBOX.height / 2;
  }

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
      // A JavaScript-only page pushed back under a panel returns to its edge, as any page pushed
      // past the map's margin returns inside it: siblings slide along the edge, not under it.
      if (nodes[i]!.kind === 'js_only') {
        const c = keepClear(
          { x: x[i]! + MAP_VIEWBOX.width / 2, y: y[i]! + MAP_VIEWBOX.height / 2 },
          radius[i]!,
          complete,
          top(i) + MAP_VIEWBOX.height / 2,
        );
        x[i] = c.x - MAP_VIEWBOX.width / 2;
        y[i] = c.y - MAP_VIEWBOX.height / 2;
      }
    }
    if (!moved) break;
  }

  const positions: Record<string, Point> = {};
  nodes.forEach((node, i) => {
    positions[node.id] = {
      x: Math.round((MAP_VIEWBOX.width / 2 + x[i]!) * 10) / 10,
      y: Math.round((MAP_VIEWBOX.height / 2 + y[i]!) * 10) / 10,
    };
  });
  return { positions, raw };
}

/**
 * Where a JavaScript-only page of size `radius` drawn at `p` goes so no panel covers it: `p` if it
 * is clear, otherwise the clear place nearest `parent` (the page whose link reached it), or nearest
 * `p` without one. `top` is the highest it may sit, under the orphan band. LiveMap uses it too, for
 * a page classified since the last layout, with the band's usual height.
 */
export function keepClear(
  p: Point,
  radius: number,
  complete: boolean,
  top = MARGIN + BAND_ROWS_KEPT * BAND_ROW_HEIGHT + BAND_SCATTER + radius,
  parent?: Point,
): Point {
  return clearOfPanels(
    p,
    radius + GAP + PANEL_SLACK,
    {
      left: MARGIN_X + radius,
      right: MAP_VIEWBOX.width - MARGIN_X - radius,
      top,
      bottom: MAP_VIEWBOX.height - MARGIN - radius,
    },
    complete ? PANELS.finished : PANELS.running,
    parent,
  );
}

/**
 * `p` if no panel, grown by `pad`, holds it; otherwise, among the points that line up with `p`,
 * with `toward` or with a grown panel's edge on each axis, the one inside `bounds` and under no
 * grown panel that is nearest `toward` (nearest `p` among equals, and without `toward`). `p` itself
 * if there is none.
 */
export function clearOfPanels(
  p: Point,
  pad: number,
  bounds: { left: number; right: number; top: number; bottom: number },
  panels: readonly PanelRect[],
  toward?: Point,
): Point {
  const inside = (q: Point) =>
    panels.some(
      (r) => q.x > r.left - pad && q.x < r.right + pad && q.y > r.top - pad && q.y < r.bottom + pad,
    );
  if (!inside(p)) return p;
  const aim = toward ?? p;
  const xs = [p.x, aim.x, ...panels.flatMap((r) => [r.left - pad, r.right + pad])];
  const ys = [p.y, aim.y, ...panels.flatMap((r) => [r.top - pad, r.bottom + pad])];
  let best = p;
  let bestD = Infinity;
  let bestOwn = Infinity;
  for (const cx of xs) {
    for (const cy of ys) {
      const q = { x: cx, y: cy };
      if (cx < bounds.left || cx > bounds.right || cy < bounds.top || cy > bounds.bottom) continue;
      if (inside(q)) continue;
      const d = Math.hypot(cx - aim.x, cy - aim.y);
      const own = Math.hypot(cx - p.x, cy - p.y);
      if (d < bestD || (d === bestD && own < bestOwn)) {
        best = q;
        bestD = d;
        bestOwn = own;
      }
    }
  }
  return best;
}
