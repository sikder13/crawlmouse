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

/** A window `wide` or not (1024px and up), whose listeners the test can call as it crosses. */
function windowOf(wide: { value: boolean }) {
  const listeners: (() => void)[] = [];
  window.matchMedia = ((q: string) => ({
    get matches() {
      return q.includes('reduce') ? false : wide.value;
    },
    media: q,
    addEventListener: (_: string, l: () => void) => listeners.push(l),
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  return () => listeners.forEach((l) => l());
}

describe('the window crossing 1024px', () => {
  it('asks the growing map again, clear of the panels drawn at the new width', () => {
    const wide = { value: true };
    const cross = windowOf(wide);
    render([page(HOME, null), page(A, HOME)], { final: false, complete: false });
    render([page(HOME, null), page(A, HOME), page(B, A)], { final: false, complete: false });
    expect(requests.at(-1)!.complete).toBe(false);
    wide.value = false;
    act(() => cross());
    expect(requests.at(-1)).toMatchObject({ complete: true });
  });
});

describe('a page classified JavaScript-only as the replay plays', () => {
  // Laid out as an ordinary page under the running crawl's step panel.
  const under = { ...initial, [A]: { x: 150, y: 250 } };
  const drawnAt = () => {
    const points = document.querySelector(`[data-v2-node="${A}"]`)?.getAttribute('points') ?? '';
    return Number(points.split(',')[0]);
  };
  const classify = () => {
    act(() =>
      root!.render(
        <LiveMap
          nodes={[page(HOME, null), page(A, HOME)]}
          initial={under}
          building
          final={false}
          complete={false}
        />,
      ),
    );
    const js: MapNode = { ...page(A, HOME), kind: 'js_only', via: 'link' };
    act(() =>
      root!.render(
        <LiveMap
          nodes={[page(HOME, null), js]}
          initial={under}
          building
          final={false}
          complete={false}
        />,
      ),
    );
  };

  it('is drawn clear of the step panel at once where the panel is over the map', () => {
    windowOf({ value: true });
    classify();
    expect(drawnAt()).toBeGreaterThan(448);
  });

  it('stays where it was laid out below 1024px, where no panel is over the map', () => {
    windowOf({ value: false });
    classify();
    expect(drawnAt()).toBe(150);
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

describe('the screen scale a move is measured in', () => {
  // A ResizeObserver reporting the map's laid-out size, which the test changes.
  let report: (width: number, height: number) => void = () => {};
  const real = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  beforeEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(
        private cb: (entries: { contentRect: { width: number; height: number } }[]) => void,
      ) {}
      observe() {
        report = (width, height) => this.cb([{ contentRect: { width, height } }]);
      }
      disconnect() {}
    };
  });
  afterEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = real;
  });

  // A's page moves `units` view-box units (4 unless said) as B arrives under it.
  const land = (units = 4) => {
    render([page(HOME, null), page(A, HOME), page(B, A)], { final: false, complete: false });
    const asked = requests.at(-1)!;
    act(() =>
      deliver({
        version: asked.version,
        positions: {
          [HOME]: initial[HOME]!,
          [A]: { x: initial[A]!.x + units, y: 300 },
          [B]: { x: 680, y: 320 },
        },
        raw: {},
      }),
    );
    return {
      moved: animations.some((a) => a.el.getAttribute('data-v2-node') === A),
      draw: animations.find((a) => a.el.getAttribute('data-v2-edge') === B)?.options.delay,
    };
  };

  it('is the map’s size as laid out: a 4-unit move is 1.2px on a 390px phone, drawn in place', () => {
    windowOf({ value: false });
    render([page(HOME, null), page(A, HOME)], { final: false, complete: false });
    act(() => report(348, 168)); // 0.3 px to the unit, the map at 390px
    expect(land()).toEqual({ moved: false, draw: 0 });
  });

  it('and 3.7px on the 1280px stage, animated, the new link waiting for it', () => {
    windowOf({ value: true });
    render([page(HOME, null), page(A, HOME)], { final: false, complete: false });
    act(() => report(1078, 600)); // 0.929 px to the unit, the stage at 1280px
    expect(land()).toEqual({ moved: true, draw: MOTION.mapSettles.duration_ms });
  });

  it('is the smaller of the two ratios, the view box drawn whole: a 2-unit move at 1024px is 1.6px', () => {
    windowOf({ value: true });
    render([page(HOME, null), page(A, HOME)], { final: false, complete: false });
    // The 1024px stage's map: 942/1160 = 0.812 px to the unit across, 622/560 = 1.111 down.
    act(() => report(942, 622));
    expect(land(2)).toEqual({ moved: false, draw: 0 });
  });
});
