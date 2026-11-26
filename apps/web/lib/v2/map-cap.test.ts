import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIVE_MAP_MAX_NODES, capMap, drawnCount } from './map-cap';
import { layoutInput } from './map-layout';
import type { MapNode } from './progress';
import type { LayoutNode } from './map-layout';

const page = (id: string, parent: string | null, depth: number): LayoutNode => ({
  id,
  parent,
  depth,
  kind: 'page',
  via: parent === null ? null : 'link',
});

/** A home page and `n` pages hanging from it, each from the one before, ids h, p1, p2, … */
const chainOf = (n: number): LayoutNode[] => [
  page('h', null, 0),
  ...Array.from({ length: n }, (_, i) => page(`p${i + 1}`, i === 0 ? 'h' : `p${i}`, i + 1)),
];

describe('capMap', () => {
  it('draws 500 pages at most', () => {
    expect(LIVE_MAP_MAX_NODES).toBe(500);
    const { shown, more } = capMap(chainOf(799), new Set());
    expect([shown.length, more]).toEqual([500, 300]);
    expect(shown.at(-1)!.id).toBe('p499');
  });

  it('draws everything, and says nothing more, under the cap', () => {
    const input = chainOf(41);
    expect(capMap(input, new Set())).toEqual({ shown: input, more: 0 });
  });

  it('does not draw a page before the page it hangs from, and draws it once that one is drawn', () => {
    // The child is listed first (fetched before the link to it was read).
    const input = [page('c', 'b', 2), page('h', null, 0), page('b', 'h', 1)];
    expect(capMap(input, new Set(), 2).shown.map((n) => n.id)).toEqual(['h', 'b']);
    expect(capMap(input, new Set(), 3).shown.map((n) => n.id)).toEqual(['c', 'h', 'b']);
  });

  it('keeps a page drawn before when one linked late joins earlier in the list', () => {
    const first = capMap([page('h', null, 0), page('a', 'h', 1), page('b', 'h', 1)], new Set(), 3);
    expect(first.shown.map((n) => n.id)).toEqual(['h', 'a', 'b']);
    // `x` was fetched early, but its first link arrived only now, so it joins ahead of `a`.
    const next = capMap(
      [page('h', null, 0), page('x', 'h', 1), page('a', 'h', 1), page('b', 'h', 1)],
      new Set(first.shown.map((n) => n.id)),
      3,
    );
    expect(next.shown.map((n) => n.id)).toEqual(['h', 'a', 'b']);
    expect(next.more).toBe(1);
  });

  // Over generated growing crawls: pages arrive in batches, in any order, each hanging from an
  // earlier-numbered page; the map is asked after each batch with what it drew the time before.
  it('over any growing crawl: never more than the cap, never drops a drawn page, never an orphaned child', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 80 }),
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }),
        (max, parentPicks, batchSizes) => {
          const all = [
            page('h', null, 0),
            ...parentPicks.map((pick, i) => {
              const parent = pick % (i + 1) === 0 ? 'h' : `n${pick % (i + 1)}`;
              return page(`n${i + 1}`, parent, 1);
            }),
          ];
          let kept = new Set<string>();
          let arrived = 0;
          for (const size of batchSizes) {
            arrived = Math.min(all.length, arrived + size);
            // Arrival order is not parent-first: the batch is listed backwards.
            const input = [...all.slice(0, arrived)].reverse();
            const { shown, more } = capMap(input, kept, max);
            const ids = new Set(shown.map((n) => n.id));
            expect(shown.length).toBeLessThanOrEqual(max);
            expect(shown.length + more).toBe(input.length);
            for (const id of kept) expect(ids.has(id)).toBe(true);
            for (const n of shown) if (n.parent !== null) expect(ids.has(n.parent)).toBe(true);
            // Room left means nothing that could join was left out; so the count the screen shows
            // without the map's state is the map's own.
            if (shown.length < max) expect(more).toBe(0);
            expect(shown.length).toBe(drawnCount(input.length, max));
            kept = ids;
          }
        },
      ),
    );
  });

  it('over any crawl state, every page of layoutInput hangs from a page also in it, so the count holds', () => {
    // MapNodes as the reducer holds them: a page whose first link names an earlier page, or none.
    fc.assert(
      fc.property(fc.array(fc.option(fc.nat(), { nil: null }), { maxLength: 60 }), (froms) => {
        // The root with its slash: the form layoutInput finds on main before and after c/027 A.
        const url = (i: number) => (i === 0 ? 'https://site.test/' : `https://site.test/p${i}`);
        const nodes: MapNode[] = froms.map((f, i) => ({
          url: url(i),
          from: i === 0 || f === null ? null : url(f % i),
          via: i === 0 || f === null ? null : 'link',
          kind: 'page',
        }));
        const input = layoutInput(nodes);
        if (nodes.length > 0) expect(input[0]!.depth).toBe(0);
        const ids = new Set(input.map((n) => n.id));
        for (const n of input) if (n.parent !== null) expect(ids.has(n.parent)).toBe(true);
        const max = Math.max(1, Math.floor(froms.length / 3));
        expect(capMap(input, new Set(), max).shown.length).toBe(drawnCount(input.length, max));
      }),
    );
  });
});
