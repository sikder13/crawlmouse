import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAP_VIEWBOX, layoutInput, layoutMap, nodeRadius, type LayoutNode } from './map-layout';
import { stateAt } from './progress';
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

  it('puts the home page at the centre', () => {
    const home = input.find((n) => n.depth === 0)!;
    expect(out[home.id]).toEqual({ x: MAP_VIEWBOX.width / 2, y: MAP_VIEWBOX.height / 2 });
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

  it('pushes the pages nothing links to towards the edge', () => {
    const c = { x: MAP_VIEWBOX.width / 2, y: MAP_VIEWBOX.height / 2 };
    const reach = (n: LayoutNode) => {
      const p = out[n.id]!;
      return Math.hypot((p.x - c.x) / MAP_VIEWBOX.width, (p.y - c.y) / MAP_VIEWBOX.height);
    };
    const orphans = input.filter((n) => n.parent === null && n.depth !== 0);
    const linked = input.filter((n) => n.parent !== null);
    const mean = (xs: LayoutNode[]) => xs.reduce((s, n) => s + reach(n), 0) / xs.length;
    expect(mean(orphans)).toBeGreaterThan(mean(linked));
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
