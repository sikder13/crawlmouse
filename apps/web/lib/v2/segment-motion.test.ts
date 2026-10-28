import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Point } from './map-layout';
import { segmentSteps, type SegmentStep } from './segment-motion';

type Segment = [Point, Point];

const lerp = (a: Point, b: Point, f: number): Point => ({
  x: a.x + (b.x - a.x) * f,
  y: a.y + (b.y - a.y) * f,
});

/** Where a step's transform takes a point of the link as drawn: the CSS order, right to left. */
function apply(s: Pick<SegmentStep, 'tx' | 'ty' | 'deg' | 'scale'>, origin: Point, p: Point) {
  const x = (p.x - origin.x) * s.scale;
  const y = (p.y - origin.y) * s.scale;
  const r = (s.deg * Math.PI) / 180;
  return {
    x: s.tx + x * Math.cos(r) - y * Math.sin(r),
    y: s.ty + x * Math.sin(r) + y * Math.cos(r),
  };
}

/**
 * The transform the browser draws at progress `f`: between two steps each part of the list is
 * interpolated on its own, which is what keeping the same four functions in every step buys.
 */
function between(steps: SegmentStep[], f: number) {
  const i = Math.max(
    0,
    steps.findIndex((s) => s.offset >= f),
  );
  const b = steps[i]!;
  const a = steps[Math.max(0, i - 1)]!;
  const t = b.offset === a.offset ? 1 : (f - a.offset) / (b.offset - a.offset);
  const mix = (k: 'tx' | 'ty' | 'deg' | 'scale') => a[k] + (b[k] - a[k]) * t;
  return { tx: mix('tx'), ty: mix('ty'), deg: mix('deg'), scale: mix('scale') };
}

/** How far, over the move, either end of the link gets from the straight line its page takes. */
function worstOffLine(was: Segment, now: Segment, steps: SegmentStep[]) {
  let worst = 0;
  for (let k = 0; k <= 400; k++) {
    const f = k / 400;
    const s = between(steps, f);
    for (const end of [0, 1] as const) {
      const at = apply(s, now[0], now[end]);
      const truth = lerp(was[end], now[end], f);
      worst = Math.max(worst, Math.hypot(at.x - truth.x, at.y - truth.y));
    }
  }
  return worst;
}

/** Half a turn, and the rounding of the arithmetic that measures it. */
const HALF_TURN = 180 + 1e-9;

const point = fc.record({
  x: fc.double({ min: 0, max: 1160, noNaN: true }),
  y: fc.double({ min: 0, max: 560, noNaN: true }),
});
const segment = fc.tuple(point, point);

describe('segmentSteps: a link moving with its two pages', () => {
  it('keeps a link on its pages through a quarter turn, where a plain rotation would not', () => {
    // Independent truth: the child page moves in a straight line from (10, 0) to (0, 10), so
    // halfway it is at (5, 5). Turning the link about its parent end would put it at (7.07, 7.07).
    const was: Segment = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const now: Segment = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ];
    const steps = segmentSteps(was, now)!;
    const half = apply(between(steps, 0.5), now[0], now[1]);
    expect(Math.hypot(half.x - 5, half.y - 5)).toBeLessThanOrEqual(0.5);
    expect(steps.length).toBeGreaterThan(2);
  });

  it('starts where the link was, ends as drawn, and puts both ends on their pages at every step', () => {
    fc.assert(
      fc.property(segment, segment, (was, now) => {
        fc.pre(Math.hypot(now[1].x - now[0].x, now[1].y - now[0].y) > 1);
        const steps = segmentSteps(was, now)!;
        expect(steps[0]!.offset).toBe(0);
        expect(steps.at(-1)).toEqual({ offset: 1, tx: now[0].x, ty: now[0].y, deg: 0, scale: 1 });
        for (const s of steps) {
          for (const end of [0, 1] as const) {
            const at = apply(s, now[0], now[end]);
            const truth = lerp(was[end], now[end], s.offset);
            expect(Math.hypot(at.x - truth.x, at.y - truth.y)).toBeLessThan(1e-6);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('keeps both ends within a view-box unit of their pages between steps', () => {
    fc.assert(
      fc.property(segment, segment, (was, now) => {
        fc.pre(Math.hypot(now[1].x - now[0].x, now[1].y - now[0].y) > 1);
        const steps = segmentSteps(was, now)!;
        expect(worstOffLine(was, now, steps)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it('turns no step more than half a turn from the last, so the browser never spins the long way', () => {
    // Half a turn exactly is reached only where a link shrinks through nothing and flips, at the
    // instant its length is zero: there the turn is drawn at no size.
    fc.assert(
      fc.property(segment, segment, (was, now) => {
        fc.pre(Math.hypot(now[1].x - now[0].x, now[1].y - now[0].y) > 1);
        const steps = segmentSteps(was, now)!;
        for (let i = 1; i < steps.length; i++) {
          expect(Math.abs(steps[i]!.deg - steps[i - 1]!.deg)).toBeLessThanOrEqual(HALF_TURN);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('flips a link through its parent without a spin, both ends on their pages', () => {
    const parent = { x: 300, y: 200 };
    for (const [was, now] of [
      [
        { x: 400, y: 200 },
        { x: 200, y: 200 },
      ],
      [
        { x: 300, y: 260 },
        { x: 300, y: 140 },
      ],
      [
        { x: 200, y: 200 },
        { x: 400, y: 200 },
      ],
    ] as const) {
      const steps = segmentSteps([parent, was], [parent, now])!;
      expect(worstOffLine([parent, was], [parent, now], steps)).toBeLessThanOrEqual(1);
      for (let i = 1; i < steps.length; i++) {
        expect(Math.abs(steps[i]!.deg - steps[i - 1]!.deg)).toBeLessThanOrEqual(HALF_TURN);
      }
    }
  });

  it('stays a few steps for a link reversed along a line, whatever rounding does to its turn', () => {
    // Collinear to within rounding: the turn's sign is noise until the link passes through nothing.
    for (const e of [1e-13, -1e-13, 3e-12, 1e-9]) {
      const parent = { x: 300, y: 200 };
      const was: Segment = [parent, { x: 400, y: 200 + e }];
      const now: Segment = [parent, { x: 200, y: 200 - e }];
      const steps = segmentSteps(was, now)!;
      expect(steps.length, `${e}`).toBeLessThanOrEqual(24);
      expect(worstOffLine(was, now, steps)).toBeLessThanOrEqual(1);
      for (let i = 1; i < steps.length; i++) {
        expect(Math.abs(steps[i]!.deg - steps[i - 1]!.deg)).toBeLessThanOrEqual(HALF_TURN);
      }
    }
  });

  it('turns one way when a link points straight back, to within rounding', () => {
    // Found by sampling near-straight reversals through the parent. Measured on its own at each
    // point, the turn's sign is rounding here, and two steps read -180 and 180, a whole turn apart.
    const parent = { x: 580, y: 280 };
    const was: Segment = [parent, { x: 627.1971776412722, y: 279.9999999999997 }];
    const now: Segment = [parent, { x: 80.00000000000091, y: 280.00000000000324 }];
    const steps = segmentSteps(was, now)!;
    for (let i = 1; i < steps.length; i++) {
      expect(Math.abs(steps[i]!.deg - steps[i - 1]!.deg)).toBeLessThanOrEqual(HALF_TURN);
    }
    expect(worstOffLine(was, now, steps)).toBeLessThanOrEqual(1);
  });

  it('is one step each way for a link that only shifts', () => {
    const was: Segment = [
      { x: 10, y: 10 },
      { x: 60, y: 30 },
    ];
    const now: Segment = [
      { x: 40, y: 50 },
      { x: 90, y: 70 },
    ];
    expect(segmentSteps(was, now)).toHaveLength(2);
  });

  it('draws nothing for a link with no length', () => {
    const p = { x: 3, y: 4 };
    expect(segmentSteps([p, { x: 9, y: 9 }], [p, p])).toBeNull();
  });
});
