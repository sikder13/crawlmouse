/** Arithmetic the grades share. */
import { DECIMALS } from './weights.js';

/** The scores an unmeasured component could take. */
export interface Range {
  min: number;
  max: number;
}

/** A component: a score, or no score and the range it could take. */
export type Measure = { score: number; range: null } | { score: null; range: Range };

const SCALE = 10 ** DECIMALS;

/** `x` to DECIMALS places, halves away from zero. */
export function round(x: number): number {
  return Math.sign(x) * (Math.round(Math.abs(x) * SCALE + Number.EPSILON) / SCALE);
}

export const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The middle value, or the mean of the middle two. `xs` must not be empty. */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export const scored = (score: number): Measure => ({ score: round(score), range: null });

export const ranged = (min: number, max: number): Measure => ({
  score: null,
  range: { min: round(min), max: round(max) },
});
