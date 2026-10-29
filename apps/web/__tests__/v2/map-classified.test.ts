import { describe, expect, it } from 'vitest';
import { clearNewlyClassified, edgeDrawDelay } from '../../components/v2/map/LiveMap';
import { MOTION } from '../../lib/v2/motion';
import { PANELS, nodeRadius, type LayoutNode, type Point } from '../../lib/v2/map-layout';

const node = (id: string, kind: LayoutNode['kind'], parent: string | null = 'h'): LayoutNode => ({
  id,
  parent,
  depth: parent ? 1 : 0,
  kind,
  via: kind === 'js_only' ? 'javascript' : parent ? 'link' : null,
});

const home = node('h', 'page', null);
const step = PANELS.running.find((p) => p.name === 'step panel')!;
// Laid out as an ordinary page under the running crawl's step panel, its parent under it too.
const positions: Record<string, Point> = { h: { x: 200, y: 300 }, a: { x: 150, y: 250 } };

describe('a page classified JavaScript-only since the last layout', () => {
  it('is drawn clear of the running panels at once', () => {
    const laidOut = [home, node('a', 'page')];
    const input = [home, node('a', 'js_only')];
    const shown = clearNewlyClassified(input, laidOut, positions, false);
    expect(shown).not.toBe(positions);
    expect(shown.a!.x).toBeGreaterThan(step.right);
    expect(shown.h).toEqual(positions.h);
  });

  it('arriving already JavaScript-only, starts from its parent and is drawn clear at once', () => {
    // The bad site's five arrive this way: classified before any layout has placed them.
    const laidOut = [home, node('a', 'page')];
    const input = [home, node('a', 'page'), node('b', 'js_only', 'a')];
    const shown = clearNewlyClassified(input, laidOut, positions, false);
    expect(shown.b).toBeDefined();
    expect(shown.b!.x).toBeGreaterThan(step.right);
  });

  it('arriving with a sibling, is drawn apart from it, not on the same spot', () => {
    const laidOut = [home, node('a', 'page')];
    const input = [home, node('a', 'page'), node('b', 'js_only', 'a'), node('c', 'js_only', 'a')];
    const shown = clearNewlyClassified(input, laidOut, positions, false);
    const gap = Math.hypot(shown.b!.x - shown.c!.x, shown.b!.y - shown.c!.y);
    // Two triangles' sizes and the layout's gap: they do not touch.
    expect(gap).toBeGreaterThanOrEqual(2 * nodeRadius(node('b', 'js_only')) + 3);
    expect(shown.c!.x).toBeGreaterThan(step.right);
  });

  it('stays where it was when no panel of the finished map covers it', () => {
    const laidOut = [home, node('a', 'page')];
    const input = [home, node('a', 'js_only')];
    expect(clearNewlyClassified(input, laidOut, positions, true)).toBe(positions);
  });

  it('is left to the layout once one has placed it as JavaScript-only, and nothing else moves', () => {
    const laidOut = [home, node('a', 'js_only')];
    expect(clearNewlyClassified([home, node('a', 'js_only')], laidOut, positions, false)).toBe(
      positions,
    );
    expect(clearNewlyClassified(laidOut, laidOut, positions, false)).toBe(positions);
    const added = [home, node('a', 'page'), node('b', 'page')];
    expect(clearNewlyClassified(added, [home, node('a', 'page')], positions, false)).toBe(
      positions,
    );
  });
});

describe('a new link', () => {
  it('waits for its parent to arrive when the parent is moving, and is drawn at once otherwise', () => {
    expect(edgeDrawDelay({ x: 100, y: 100 }, { x: 140, y: 100 })).toBe(
      MOTION.mapSettles.duration_ms,
    );
    expect(edgeDrawDelay({ x: 100, y: 100 }, { x: 100.5, y: 100 })).toBe(0);
    expect(edgeDrawDelay(undefined, { x: 100, y: 100 })).toBe(0);
  });
});
