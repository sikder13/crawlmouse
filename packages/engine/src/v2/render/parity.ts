/**
 * The two determinism bounds the live tests hold real renders to (DECISION-LOG I8): five renders of one
 * page within REPEAT_SPREAD of each other in rendered words, and, on a page served whole without
 * JavaScript, its two sides within PARITY_SPREAD. Offline, a replayed reply is identical every time, so
 * neither bound is shown there; they are checked against Browser Run when a token is present.
 */
export const REPEAT_SPREAD = 0.02;
export const PARITY_SPREAD = 0.05;

/** |a − b| over the larger of the two; 0 when both are 0. */
export function spread(a: number, b: number): number {
  const larger = Math.max(a, b);
  return larger === 0 ? 0 : Math.abs(a - b) / larger;
}

/** Rounded to 12 places first, so a spread of exactly the bound passes despite binary fractions. */
export const within = (a: number, b: number, bound: number): boolean =>
  Math.round(spread(a, b) * 1e12) / 1e12 <= bound;
