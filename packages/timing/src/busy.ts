/** One frame at 60 Hz, in microseconds: the slice the work is measured in. */
export const SLICE_US = 1_000_000 / 60;

/**
 * The main thread's busy time in each 16.7 ms slice of [from, to), in ms: every task's duration,
 * split across the slices it spans, and clipped to the window. Times are in microseconds, as a
 * Chromium trace records them. The slices are fixed in time, not drawn from the frames the browser
 * produced, so the reading does not depend on the refresh rate a machine manages.
 */
export function busyPerSlice(
  tasks: readonly { ts: number; dur: number }[],
  from: number,
  to: number,
): number[] {
  const n = Math.max(1, Math.ceil((to - from) / SLICE_US));
  const slices = new Array<number>(n).fill(0);
  for (const { ts, dur } of tasks) {
    const start = Math.max(ts, from);
    const end = Math.min(ts + dur, to);
    if (end <= start) continue;
    const first = Math.min(n - 1, Math.floor((start - from) / SLICE_US));
    const last = Math.min(n - 1, Math.floor((end - from) / SLICE_US));
    // One step per slice index, so the loop ends however the edges round.
    for (let i = first; i <= last; i++) {
      const lo = Math.max(start, from + i * SLICE_US);
      const hi = Math.min(end, from + (i + 1) * SLICE_US);
      if (hi > lo) slices[i]! += (hi - lo) / 1000;
    }
  }
  return slices;
}

/** The value at the given quantile of the readings (nearest rank, rounding down). */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) throw new Error('quantile of no readings');
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
}
