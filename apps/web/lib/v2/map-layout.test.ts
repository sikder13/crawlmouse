import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAP_VIEWBOX,
  BAND_X,
  ORPHAN_GAP,
  PANELS,
  clearOfPanels,
  type PanelRect,
  layoutInput,
  layoutMap,
  layoutMapFrom,
  nodeRadius,
  type LayoutNode,
} from './map-layout';
import { mapIsComplete, stateAt } from './progress';
import { recording } from './recordings';

const end = stateAt(recording('bad-site').events, Infinity);
const input = layoutInput(end.nodes);
const out = layoutMap(input);

describe('the link-map layout', () => {
  it('places every node, and only those', () => {
    expect(Object.keys(out).sort()).toEqual(input.map((n) => n.id).sort());
  });

  it('is deterministic: the same graph gives the same positions', () => {
    expect(layoutMap(input)).toEqual(out);
  });

  it('does not depend on the order the nodes are listed in', () => {
    const reversed = [...input].reverse();
    expect(layoutMap(reversed)).toEqual(out);
  });

  it('keeps every node, with its shape, inside the view box', () => {
    for (const n of input) {
      const p = out[n.id]!;
      const r = nodeRadius(n);
      expect(p.x - r, n.id).toBeGreaterThanOrEqual(0);
      expect(p.y - r, n.id).toBeGreaterThanOrEqual(0);
      expect(p.x + r, n.id).toBeLessThanOrEqual(MAP_VIEWBOX.width);
      expect(p.y + r, n.id).toBeLessThanOrEqual(MAP_VIEWBOX.height);
    }
  });

  it('puts the home page at the centre across, and below the band of orphans', () => {
    const home = input.find((n) => n.depth === 0)!;
    expect(out[home.id]!.x).toBe(MAP_VIEWBOX.width / 2);
    expect(out[home.id]!.y).toBeGreaterThan(MAP_VIEWBOX.height / 2);
  });

  it('keeps nodes apart: no two overlap', () => {
    let overlaps = 0;
    for (let i = 0; i < input.length; i++) {
      for (let j = i + 1; j < input.length; j++) {
        const a = input[i]!;
        const b = input[j]!;
        const d = Math.hypot(out[a.id]!.x - out[b.id]!.x, out[a.id]!.y - out[b.id]!.y);
        if (d < nodeRadius(a) + nodeRadius(b)) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it('draws a page nearer its parent than the map’s width on average', () => {
    const linked = input.filter((n) => n.parent);
    const mean =
      linked.reduce((s, n) => {
        const p = out[n.parent!]!;
        return s + Math.hypot(out[n.id]!.x - p.x, out[n.id]!.y - p.y);
      }, 0) / linked.length;
    expect(mean).toBeLessThan(MAP_VIEWBOX.width / 8);
  });

  it('draws the pages nothing links to in a band across the top middle, above every linked page', () => {
    const orphans = input.filter((n) => n.parent === null && n.depth !== 0);
    expect(orphans.length).toBeGreaterThan(0);
    const linkedTop = Math.min(
      ...input.filter((n) => n.parent !== null).map((n) => out[n.id]!.y - nodeRadius(n)),
    );
    for (const o of orphans) {
      const p = out[o.id]!;
      expect(p.y + nodeRadius(o), o.id).toBeLessThan(linkedTop);
      expect(Math.abs(p.x - BAND_X), o.id).toBeLessThanOrEqual(3.5 * ORPHAN_GAP);
    }
  });

  it('spreads the cloud across the stage: wider than tall, over most of its width', () => {
    const xs = input.map((n) => out[n.id]!.x);
    const ys = input.filter((n) => n.parent !== null).map((n) => out[n.id]!.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width / height).toBeGreaterThan(1.6);
    expect(width).toBeGreaterThan(MAP_VIEWBOX.width * 0.75);
  });

  it('does not depend on the order the nodes are listed in (property)', () => {
    const small = layoutInput(stateAt(recording('bad-site').events, 30_000).nodes);
    const want = layoutMap(small);
    fc.assert(
      fc.property(fc.shuffledSubarray(small, { minLength: small.length }), (shuffled) => {
        expect(layoutMap(shuffled)).toEqual(want);
      }),
      { numRuns: 20 },
    );
  });

  it('lays out any small tree inside the box without throwing (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 0, maxLength: 40 }), (parents) => {
        const nodes: LayoutNode[] = [{ id: 'h', parent: null, depth: 0, kind: 'page', via: null }];
        parents.forEach((p, i) => {
          const parent = nodes[p % nodes.length]!;
          nodes.push({
            id: `n${i}`,
            parent: p % 5 === 4 ? null : parent.id,
            depth: p % 5 === 4 ? null : (parent.depth ?? 0) + 1,
            kind: 'page',
            via: p % 5 === 4 ? null : 'link',
          });
        });
        const pos = layoutMap(nodes);
        return nodes.every((n) => {
          const q = pos[n.id]!;
          return q.x >= 0 && q.y >= 0 && q.x <= MAP_VIEWBOX.width && q.y <= MAP_VIEWBOX.height;
        });
      }),
      { numRuns: 40 },
    );
  });
});

describe('the band of pages no link reaches', () => {
  it('never draws two of them over each other, however many there are and whatever their ids (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: 8,
          maxLength: 300,
          size: 'max',
        }),
        (ids) => {
          const nodes: LayoutNode[] = [
            { id: 'home', parent: null, depth: 0, kind: 'page', via: null },
            ...ids.map((id) => ({
              id: `o:${id}`,
              parent: null,
              depth: null,
              kind: 'orphan' as const,
              via: null,
            })),
          ];
          const pos = layoutMap(nodes);
          const squares = nodes.slice(1).map((n) => pos[n.id]!);
          // Two 9-unit squares overlap when both their centres are closer than 9 apart on each axis.
          return squares.every((a, i) =>
            squares.slice(i + 1).every((b) => Math.abs(a.x - b.x) >= 9 || Math.abs(a.y - b.y) >= 9),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('the pages the map exists to show, and the panels drawn over it', () => {
  /** The panels a page, drawn at `p` with its size, reaches under. */
  const under = (p: { x: number; y: number }, r: number, panels: readonly PanelRect[]) =>
    panels
      .filter((z) => p.x + r > z.left && p.x - r < z.right && p.y + r > z.top && p.y - r < z.bottom)
      .map((z) => z.name);

  const keyPages = (
    nodes: LayoutNode[],
    pos: Record<string, { x: number; y: number }>,
    complete: boolean,
  ) =>
    nodes
      .filter((n) => n.kind === 'js_only' || n.kind === 'orphan')
      .map((n) => ({
        id: n.id,
        panels: under(pos[n.id]!, nodeRadius(n), complete ? PANELS.finished : PANELS.running),
      }))
      .filter((k) => k.panels.length);

  it('keeps every orphan and JavaScript-only page out from under them, as the crawl runs and at its end', () => {
    for (const name of ['bad-site', 'challenged-site'] as const) {
      const events = recording(name).events;
      let seen = 0;
      for (const t of [60_000, 100_000, 115_000, 125_000, 190_000, Infinity]) {
        const state = stateAt(events, t);
        const nodes = layoutInput(state.nodes);
        const complete = mapIsComplete(state);
        seen += nodes.filter((n) => n.kind !== 'page').length;
        expect(keyPages(nodes, layoutMap(nodes, complete), complete), `${name} ${t} ms`).toEqual(
          [],
        );
      }
      expect(seen, `${name}: key pages were laid out`).toBeGreaterThan(5);
    }
  });

  it("leaves a finished map's JavaScript-only pages beside their parents, where no finished panel covers them", () => {
    // Kept clear of the running crawl's panels, the bad site's ended in a column at the step
    // panel's edge, up to 190 units from their parents; a finished map has no step panel over it.
    const nodes = layoutInput(stateAt(recording('bad-site').events, Infinity).nodes);
    const pos = layoutMap(nodes, true);
    const js = nodes.filter((n) => n.kind === 'js_only');
    expect(js.length).toBeGreaterThan(2);
    for (const n of js) {
      const p = pos[n.id]!;
      const q = pos[n.parent!]!;
      expect(Math.hypot(p.x - q.x, p.y - q.y), n.id).toBeLessThan(80);
    }
  });

  it('moves a covered page to the clear place nearest its parent', () => {
    const panels: PanelRect[] = [{ name: 'p', left: 0, right: 100, top: 0, bottom: 100 }];
    const bounds = { left: 0, right: 500, top: 0, bottom: 500 };
    // Nearest itself is the panel's right edge; nearest its parent, below the panel.
    expect(clearOfPanels({ x: 90, y: 50 }, 0, bounds, panels)).toEqual({ x: 100, y: 50 });
    expect(clearOfPanels({ x: 90, y: 50 }, 0, bounds, panels, { x: 60, y: 300 })).toEqual({
      x: 60,
      y: 300,
    });
    expect(clearOfPanels({ x: 200, y: 50 }, 0, bounds, panels, { x: 60, y: 300 })).toEqual({
      x: 200,
      y: 50,
    });
  });

  it('keeps them out from under the panels for any tree, whatever its classes (property)', () => {
    fc.assert(
      fc.property(
        // Up to the 500-page crawl cap's scale, so dense maps are drawn, not fast-check's default
        // handful of pages; a third of the pages JavaScript-only, far denser than a real site.
        fc.array(fc.tuple(fc.nat(), fc.constantFrom('page', 'js_only', 'orphan')), {
          minLength: 1,
          maxLength: 400,
          size: 'max',
        }),
        fc.boolean(),
        (spec, complete) => {
          const nodes: LayoutNode[] = [
            { id: 'h', parent: null, depth: 0, kind: 'page', via: null },
          ];
          spec.forEach(([p, kind], i) => {
            const parent = nodes[p % nodes.length]!;
            const orphan = kind === 'orphan';
            nodes.push({
              id: `n${i}`,
              parent: orphan ? null : parent.id,
              depth: orphan ? null : (parent.depth ?? 0) + 1,
              kind: kind as LayoutNode['kind'],
              via: orphan ? null : kind === 'js_only' ? 'javascript' : 'link',
            });
          });
          expect(keyPages(nodes, layoutMap(nodes, complete), complete)).toEqual([]);
        },
      ),
      // Reported as found, unshrunk: shrinking a 400-page map takes minutes.
      { numRuns: 40, endOnFailure: true },
    );
  });
});

describe('a warm layout', () => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  it('moves pages less far between layouts a second apart than laying them out anew', () => {
    const events = recording('bad-site').events;
    let compared = 0;
    for (let t = 20_000; t <= 60_000; t += 5_000) {
      const now = layoutInput(stateAt(events, t).nodes);
      const next = layoutInput(stateAt(events, t + 1_000).nodes);
      // The map lays out again only when pages arrived.
      if (next.length === now.length) continue;
      compared++;
      const before = layoutMapFrom(now, null);
      const warm = layoutMapFrom(next, before.raw).positions;
      const cold = layoutMapFrom(next, null).positions;
      const moved = (p: Record<string, { x: number; y: number }>) =>
        Object.keys(before.positions)
          .filter((id) => p[id])
          .map((id) =>
            Math.hypot(p[id]!.x - before.positions[id]!.x, p[id]!.y - before.positions[id]!.y),
          );
      expect(median(moved(warm)), `${t} ms`).toBeLessThan(median(moved(cold)));
    }
    expect(compared).toBeGreaterThan(3);
  });

  it('starts from its seed: two seeds give two layouts, and no seed the cold one each time', () => {
    const nodes = layoutInput(stateAt(recording('bad-site').events, 40_000).nodes);
    const cold = layoutMapFrom(nodes, null);
    const shifted = Object.fromEntries(
      Object.entries(cold.raw).map(([id, p]) => [id, { x: p.x + 40, y: p.y }]),
    );
    expect(layoutMapFrom(nodes, shifted).positions).not.toEqual(
      layoutMapFrom(nodes, cold.raw).positions,
    );
    expect(layoutMapFrom(nodes, null).positions).toEqual(cold.positions);
  });
});
