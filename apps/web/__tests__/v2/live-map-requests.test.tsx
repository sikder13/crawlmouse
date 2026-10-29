// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { LayoutNode, Point } from '../../lib/v2/map-layout';
import type { MapNode } from '../../lib/v2/progress';
import { MOTION } from '../../lib/v2/motion';

// Every layout the live map asks for, and the hand that delivers one back.
const requests: { version: number; seed: unknown; complete: boolean | undefined }[] = [];
let deliver: (r: {
  version: number;
  positions: Record<string, Point>;
  raw: Record<string, Point>;
}) => void = () => {};
vi.mock('../../lib/v2/layout-scheduler', () => ({
  createLayoutScheduler: (onResult: typeof deliver) => {
    deliver = onResult;
    return {
      request: (version: number, _nodes: LayoutNode[], seed: unknown, complete?: boolean) =>
        requests.push({ version, seed, complete }),
      dispose: () => {},
    };
  },
}));

const { LiveMap } = await import('../../components/v2/map/LiveMap');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
// Every Web Animation started, with its element and options.
const animations: { el: Element; options: KeyframeAnimationOptions }[] = [];

beforeEach(() => {
  // jsdom has no matchMedia, Web Animations, CSS.escape or SVG geometry: a window panels are drawn
  // over, without reduced motion, one screen pixel to a view-box unit.
  window.matchMedia = ((q: string) => ({
    matches: !q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Element.prototype.animate = function (this: Element, _k: unknown, options: unknown) {
    animations.push({ el: this, options: options as KeyframeAnimationOptions });
    return {} as Animation;
  } as typeof Element.prototype.animate;
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (s: string) => s.replace(/["\\]/g, '\\$&'),
  };
  (SVGElement.prototype as unknown as { getScreenCTM: () => { a: number } }).getScreenCTM = () => ({
    a: 1,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  requests.length = 0;
  animations.length = 0;
  document.body.innerHTML = '';
});

const HOME = 'https://x.test/';
const A = 'https://x.test/a';
const B = 'https://x.test/a/b';
const page = (url: string, from: string | null): MapNode => ({
  url,
  from,
  via: from ? 'link' : null,
  kind: 'page',
});
const initial: Record<string, Point> = { [HOME]: { x: 580, y: 280 }, [A]: { x: 620, y: 300 } };

function render(nodes: MapNode[], props: { final: boolean; complete: boolean }) {
  act(() => root!.render(<LiveMap nodes={nodes} initial={initial} building {...props} />));
}

describe('the live map’s layout requests', () => {
  it('asks again, cold and clear of the finished panels, when the map completes after its last page', () => {
    const nodes = [page(HOME, null), page(A, HOME)];
    // Stopped short of the end: the server's cold layout is the one shown, nothing is asked.
    render(nodes, { final: true, complete: false });
    expect(requests).toEqual([]);
    // The same pages, the map now complete: one cold layout, of the finished map.
    render(nodes, { final: true, complete: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ seed: null, complete: true });
  });
});

describe('the panels a growing map keeps clear of', () => {
  it('are the running crawl’s from 1024px, and none of them narrower, where none is drawn', () => {
    const grow = () => {
      render([page(HOME, null), page(A, HOME)], { final: false, complete: false });
      render([page(HOME, null), page(A, HOME), page(B, A)], { final: false, complete: false });
      return requests.at(-1)!.complete;
    };
    expect(grow()).toBe(false);
    act(() => root!.unmount());
    requests.length = 0;
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    expect(grow()).toBe(true);
  });
});

describe('a link added as its parent moves', () => {
  const settle = (parentTo: Point) => {
    render([page(HOME, null), page(A, HOME)], { final: false, complete: false });
    // A page under A arrives: a warm layout is asked for, and lands with A moved or not.
    render([page(HOME, null), page(A, HOME), page(B, A)], { final: false, complete: false });
    const asked = requests.at(-1)!;
    act(() =>
      deliver({
        version: asked.version,
        positions: { [HOME]: initial[HOME]!, [A]: parentTo, [B]: { x: 680, y: 320 } },
        raw: {},
      }),
    );
    return animations.find((a) => a.el.getAttribute('data-v2-edge') === B);
  };

  it('is drawn once its parent has arrived, hidden until then', () => {
    const draw = settle({ x: 660, y: 300 });
    expect(draw?.options).toMatchObject({
      delay: MOTION.mapSettles.duration_ms,
      fill: 'backwards',
    });
  });

  it('is drawn at once when its parent stays where it was', () => {
    const draw = settle(initial[A]!);
    expect(draw?.options.delay).toBe(0);
  });
});
