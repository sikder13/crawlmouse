import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { repel } from './repel.js';

const RANGE = 260;
/** The grid's cell (repel.ts): REACH cells span `range + 1`. */
const CELL = (RANGE + 1) / 2;

/**
 * The repulsion loop as CC-22 shipped it (apps/web/lib/v2/map-layout.ts at origin/main 86ea1d5),
 * copied verbatim but for its constants becoming parameters. It is the truth `repel` must match
 * bit for bit.
 */
function plainScan(
  cloud: readonly number[],
  x: Float64Array,
  y: Float64Array,
  vx: Float64Array,
  vy: Float64Array,
  strength: number,
  range: number,
): void {
  for (let a = 0; a < cloud.length; a++) {
    const i = cloud[a]!;
    for (let b = a + 1; b < cloud.length; b++) {
      const j = cloud[b]!;
      const dx = x[j]! - x[i]!;
      const dy = y[j]! - y[i]!;
      const d2 = Math.max(dx * dx + dy * dy, 1);
      if (d2 > range * range) continue;
      const f = strength / d2;
      vx[i]! -= dx * f * 0.05;
      vy[i]! -= dy * f * 0.05;
      vx[j]! += dx * f * 0.05;
      vy[j]! += dy * f * 0.05;
    }
  }
}

interface Case {
  xs: number[];
  ys: number[];
  vxs: number[];
  vys: number[];
  /** Which node ids are in the cloud, and in what order. */
  cloud: number[];
  strength: number;
}

/** Same results, element by element, with Object.is: -0 and NaN must match too. */
function sameBits(a: Float64Array, b: Float64Array): boolean {
  return a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
}

function run(c: Case, step: typeof repel) {
  const x = Float64Array.from(c.xs);
  const y = Float64Array.from(c.ys);
  const vx = Float64Array.from(c.vxs);
  const vy = Float64Array.from(c.vys);
  step(c.cloud, x, y, vx, vy, c.strength, RANGE);
  return { vx, vy };
}

function agrees(c: Case): boolean {
  const ours = run(c, repel);
  const truth = run(c, plainScan);
  return sameBits(ours.vx, truth.vx) && sameBits(ours.vy, truth.vy);
}

/**
 * Coordinates that probe what the grid keys on: ordinary spread, cell boundaries and a hair either
 * side, exact multiples of the range (so pairs fall exactly `range` apart), signed zero, and values
 * the grid must refuse (beyond 2^30, infinite, NaN).
 */
const coordinate = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: -900, max: 900, noNaN: true }) },
  {
    weight: 3,
    arbitrary: fc
      .tuple(fc.integer({ min: -6, max: 6 }), fc.constantFrom(-1e-9, 0, 1e-9))
      .map(([k, e]) => k * CELL + e),
  },
  {
    weight: 3,
    arbitrary: fc
      .tuple(fc.integer({ min: -3, max: 3 }), fc.constantFrom(-1e-9, 0, 1e-9))
      .map(([k, e]) => k * RANGE + e),
  },
  { weight: 1, arbitrary: fc.constantFrom(0, -0) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(2 ** 31, -(2 ** 40), 1e12, Infinity, -Infinity, Number.NaN),
  },
);

const caseOf = (maxNodes: number) =>
  fc.integer({ min: 0, max: maxNodes }).chain((n) =>
    fc.record({
      xs: fc.array(coordinate, { minLength: n, maxLength: n }),
      ys: fc.array(coordinate, { minLength: n, maxLength: n }),
      vxs: fc.array(fc.double({ min: -5, max: 5, noNaN: true }), { minLength: n, maxLength: n }),
      vys: fc.array(fc.double({ min: -5, max: 5, noNaN: true }), { minLength: n, maxLength: n }),
      cloud: fc.shuffledSubarray([...Array(n).keys()]),
      strength: fc.double({ min: 0, max: 1200, noNaN: true }),
    }),
  );

describe('repel', () => {
  it('matches the plain scan bit for bit, whatever the positions (property)', () => {
    fc.assert(fc.property(caseOf(70), agrees), { numRuns: 400 });
  });

  it('matches it on clouds wider than one bitmap word, across many cells (property)', () => {
    fc.assert(fc.property(caseOf(200), agrees), { numRuns: 60 });
  });

  it('pushes a pair exactly `range` apart wherever it falls on the grid, and not one a hair further', () => {
    const pair = (from: number, to: number): Case => ({
      xs: [from, to],
      ys: [0, 0],
      vxs: [0, 0],
      vys: [0, 0],
      cloud: [0, 1],
      strength: 1200,
    });
    // Cells (width 130.5): 0 and 1; -1 and 1; -2 and 0. The last two are as far apart as REACH allows.
    for (const [from, to] of [
      [0, 260],
      [-0.5, 259.5],
      [-130.6, 129.4],
    ] as const) {
      expect(Math.floor(to / CELL) - Math.floor(from / CELL)).toBeLessThanOrEqual(2);
      expect(agrees(pair(from, to))).toBe(true);
      expect(run(pair(from, to), repel).vx[1]).toBeGreaterThan(0);
    }
    expect(run(pair(0, 260.000001), repel).vx[1]).toBe(0);
  });

  it('refuses a range below 1, where flooring d² at 1 would change which pairs are in range', () => {
    const one = () => new Float64Array(1);
    expect(() => repel([0], one(), one(), one(), one(), 1, 0.5)).toThrow(RangeError);
  });
});
