/** The median: the middle value of an odd count, the mean of the middle two of an even one. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('median of no samples');
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A number as a reader wants it in a message: at most two decimals, no trailing zeros. */
export function fmt(n: number): string {
  return String(Number(n.toFixed(2)));
}
