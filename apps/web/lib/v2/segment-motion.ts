import type { Point } from './map-layout';

/**
 * One step of a link's move, at `offset` (the move's progress, 0 to 1): the transform
 * `translate(tx, ty) rotate(deg) scale(scale) translate(-parent)` applied to the link as drawn,
 * with `parent` its parent end as drawn. It turns and stretches the link about its parent end and
 * carries that end to (tx, ty).
 */
export interface SegmentStep {
  offset: number;
  tx: number;
  ty: number;
  deg: number;
  scale: number;
}

/** How far, in view-box units, a link's end may stray from its page between two steps. */
const TOLERANCE = 0.5;

/** The most steps a link's move is given, whatever the error measured between them. */
export const MAX_STEPS = 128;

/** How many times a stretch of the move can be halved: to about a millionth of it. */
const MAX_DEPTH = 20;

const mix = (a: number, b: number, f: number) => a * (1 - f) + b * f;
const lerp = (a: Point, b: Point, f: number): Point => ({
  x: mix(a.x, b.x, f),
  y: mix(a.y, b.y, f),
});

/**
 * The steps that move a link drawn at `now` (parent end first) from where it was drawn, `was`, while
 * its two pages each move in a straight line, as the map's nodes do. At every step both ends of the
 * link are on their pages. Between steps the browser interpolates translate, rotate and scale each
 * on its own (every step names the same four functions, which is what makes it do so), so the
 * parent end follows its page exactly and the child end bends off its page's line; a stretch is
 * halved wherever, checked at its quarter points, the child end would stray more than half a
 * view-box unit, up to MAX_STEPS steps (segment-motion.test.ts samples 401 points of random moves
 * and holds both ends within one unit).
 *
 * The turn needs no unwrapping. The link's direction is the difference of its two ends, each moving
 * in a straight line, so at progress f it is (1 - f) times where it was plus f times as drawn, and
 * its cross product with the link as drawn is (1 - f) times where it started: one sign throughout.
 * The turn sweeps one way, from where it was to 0, never more than half a turn. The sign is taken
 * once, from where the link was; rounding, near a link pointing straight back, would flip it.
 *
 * Null when the link as drawn has no length: there is no turn or stretch that maps onto it.
 */
export function segmentSteps(was: [Point, Point], now: [Point, Point]): SegmentStep[] | null {
  const vx = now[1].x - now[0].x;
  const vy = now[1].y - now[0].y;
  const length = Math.hypot(vx, vy);
  if (length === 0) return null;

  type Step = SegmentStep & { child: Point };
  const side = vx * (was[1].y - was[0].y) - vy * (was[1].x - was[0].x) < 0 ? -1 : 1;
  const at = (f: number, before: number): Step => {
    const a = lerp(was[0], now[0], f);
    const b = lerp(was[1], now[1], f);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // Where the link has no length, to within rounding (a billionth of a view-box unit, far above
    // the rounding of coordinates under 1160), it has no direction: it keeps the one it had.
    const deg =
      len <= 1e-9
        ? before
        : (Math.atan2(side * Math.abs(vx * dy - vy * dx), vx * dx + vy * dy) * 180) / Math.PI;
    return { offset: f, tx: a.x, ty: a.y, deg, scale: len / length, child: b };
  };

  const childAt = (s: Omit<SegmentStep, 'offset'>): Point => {
    const x = vx * s.scale;
    const y = vy * s.scale;
    const r = (s.deg * Math.PI) / 180;
    return {
      x: s.tx + x * Math.cos(r) - y * Math.sin(r),
      y: s.ty + x * Math.sin(r) + y * Math.cos(r),
    };
  };

  const strays = (a: Step, b: Step) => {
    return [0.25, 0.5, 0.75].some((t) => {
      const drawn = childAt({
        tx: mix(a.tx, b.tx, t),
        ty: mix(a.ty, b.ty, t),
        deg: mix(a.deg, b.deg, t),
        scale: mix(a.scale, b.scale, t),
      });
      const truth = at(mix(a.offset, b.offset, t), a.deg).child;
      return Math.hypot(drawn.x - truth.x, drawn.y - truth.y) > TOLERANCE;
    });
  };

  const first = at(0, 0);
  const steps: Step[] = [first];
  const split = (a: Step, b: Step, depth: number) => {
    if (depth < MAX_DEPTH && steps.length < MAX_STEPS - 1 && strays(a, b)) {
      const m = at((a.offset + b.offset) / 2, a.deg);
      split(a, m, depth + 1);
      split(m, b, depth + 1);
    } else {
      steps.push(b);
    }
  };
  split(first, at(1, first.deg), 0);

  return steps.map(({ offset, tx, ty, deg, scale }, i) =>
    i === steps.length - 1
      ? { offset: 1, tx: now[0].x, ty: now[0].y, deg: 0, scale: 1 }
      : { offset, tx, ty, deg, scale },
  );
}

/** A step as a CSS transform, for a link whose parent end is drawn at `parent`. */
export function segmentTransform(s: SegmentStep, parent: Point): string {
  return `translate(${s.tx}px, ${s.ty}px) rotate(${s.deg}deg) scale(${s.scale}) translate(${-parent.x}px, ${-parent.y}px)`;
}
