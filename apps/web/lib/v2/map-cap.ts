import type { LayoutNode } from './map-layout';

/**
 * The most pages the crawl screen's map draws (c/027 B). A Pro check reaches 2,000 pages, and one
 * cold layout of 2,000 took 1,612 ms on a desktop (500 took 146 ms; c/plans/live-map.md), in the
 * Worker but several times that on a phone, with as many SVG nodes to move. The fetch log and the
 * counts still name every page; the map says how many it does not draw.
 */
export const LIVE_MAP_MAX_NODES = 500;

/**
 * The pages the map draws, at most `max`, in `input`'s order, and how many it leaves out.
 *
 * - A page drawn before stays drawn: `kept` is the ids drawn last time, and each that is still in
 *   `input` is drawn again, so a page that arrives later, or is linked late and joins the list
 *   earlier, never pushes a drawn page off the map.
 * - A page joins only when the page whose link reached it is drawn (or it has none), so no page is
 *   drawn without the page it hangs from. One that cannot join yet waits for a later call.
 */
export function capMap(
  input: readonly LayoutNode[],
  kept: ReadonlySet<string>,
  max: number = LIVE_MAP_MAX_NODES,
): { shown: LayoutNode[]; more: number } {
  const drawn = new Set<string>();
  for (const n of input) if (kept.has(n.id)) drawn.add(n.id);
  // Parents come before their children often but not always, so a page whose parent joins later
  // in this same pass gets a second look: passes repeat until one admits nothing.
  for (let admitted = true; admitted && drawn.size < max; ) {
    admitted = false;
    for (const n of input) {
      if (drawn.size >= max) break;
      if (drawn.has(n.id)) continue;
      if (n.parent !== null && !drawn.has(n.parent)) continue;
      drawn.add(n.id);
      admitted = true;
    }
  }
  const shown = input.filter((n) => drawn.has(n.id));
  return { shown, more: input.length - shown.length };
}

/**
 * How many of the map's `pages` it draws: `min(pages, max)`. Each page of `layoutInput` hangs,
 * through pages that are also in it, from the home page or from nothing, so every page can join
 * `capMap` until the cap is reached. A screen can so count what the map draws without holding the
 * map's state (map-cap.test.ts holds the two equal over generated crawls).
 */
export const drawnCount = (pages: number, max: number = LIVE_MAP_MAX_NODES): number =>
  Math.min(pages, max);
