/**
 * The layout's repulsion pass: each pair of cloud pages no further apart than `range` pushes apart.
 *
 * It does the arithmetic of the plain scan over every pair, in the same order: `a`, then each
 * `b > a` ascending, `f = strength / max(d², 1)`, a pair with `d² > range²` skipped
 * (repel.test.ts checks this bit for bit against that scan, as it stood in CC-22). What it saves is
 * time, in two ways:
 *
 * - It does not visit pairs the scan would skip because they are far apart. Pages are put on a
 *   grid of cells a little over half the range wide, so a pair in range sits at most two cells
 *   apart on each axis. Each row reads its partners from a bitmap of the pages near its cell,
 *   lowest bit first, which is ascending `b`, so the order needs no sort.
 * - It first lists a row's partners in range, then applies their forces in a second loop, so the
 *   loop doing the arithmetic has no branch that depends on the data.
 *
 * Positions do not move during the pass, only velocities, so the grid is built once per call.
 */

/**
 * A pair in range sits at most REACH cells apart on each axis: REACH cells span `range + 1`, and the
 * extra unit absorbs rounding.
 */
const REACH = 2;
/**
 * Where coordinates are small enough for the cell arithmetic to keep that promise: below 2^30, a
 * difference and a quotient are each off by less than 2^-21 of a unit, far inside the margin the
 * extra unit leaves. Outside it, and for a coordinate that is not finite, the pass scans every pair.
 */
const GRID_LIMIT = 2 ** 30;

export function repel(
  cloud: readonly number[],
  x: Float64Array,
  y: Float64Array,
  vx: Float64Array,
  vy: Float64Array,
  strength: number,
  range: number,
): void {
  // max(d², 1) > range² decides as d² > range² does only while range² is at least 1.
  if (!(range >= 1)) throw new RangeError(`repel: range must be at least 1, got ${range}`);
  const m = cloud.length;
  // Positions and velocities in cloud order, so the inner loops read memory in sequence.
  const px = new Float64Array(m);
  const py = new Float64Array(m);
  const pvx = new Float64Array(m);
  const pvy = new Float64Array(m);
  for (let a = 0; a < m; a++) {
    const i = cloud[a]!;
    px[a] = x[i]!;
    py[a] = y[i]!;
    pvx[a] = vx[i]!;
    pvy[a] = vy[i]!;
  }
  const near = nearbyPages(px, py, (range + 1) / REACH);
  const range2 = range * range;
  const partners = new Int32Array(m);
  for (let a = 0; a < m; a++) {
    const xi = px[a]!;
    const yi = py[a]!;
    const bits = near[a]!;
    const first = a + 1;
    let count = 0;
    for (let w = first >>> 5; w < bits.length; w++) {
      // In the first word, only the bits from `first` on; -1 << 0 keeps a whole word.
      let word = w === first >>> 5 ? bits[w]! & (-1 << (first & 31)) : bits[w]!;
      while (word !== 0) {
        const lowest = word & -word;
        const b = (w << 5) + 31 - Math.clz32(lowest);
        word ^= lowest;
        const dx = px[b]! - xi;
        const dy = py[b]! - yi;
        partners[count] = b;
        // Kept unless out of range; NaN is kept, as the scan keeps it (NaN > range² is false).
        count += +!(dx * dx + dy * dy > range2);
      }
    }
    // The row's own velocity accumulates in a local until the row ends, in the scan's order.
    let vxi = pvx[a]!;
    let vyi = pvy[a]!;
    for (let k = 0; k < count; k++) {
      const b = partners[k]!;
      const dx = px[b]! - xi;
      const dy = py[b]! - yi;
      const f = strength / Math.max(dx * dx + dy * dy, 1);
      vxi -= dx * f * 0.05;
      vyi -= dy * f * 0.05;
      pvx[b]! += dx * f * 0.05;
      pvy[b]! += dy * f * 0.05;
    }
    pvx[a] = vxi;
    pvy[a] = vyi;
  }
  for (let a = 0; a < m; a++) {
    vx[cloud[a]!] = pvx[a]!;
    vy[cloud[a]!] = pvy[a]!;
  }
}

/**
 * For each page, a bitmap of the pages within REACH cells of its own on each axis, itself included;
 * pages in one cell share one bitmap. When a coordinate is outside GRID_LIMIT or not finite, every
 * page's bitmap holds every page.
 */
function nearbyPages(px: Float64Array, py: Float64Array, cell: number): Int32Array[] {
  const m = px.length;
  const words = (m + 31) >>> 5;
  const gridded = [px, py].every((axis) => axis.every((v) => Math.abs(v) <= GRID_LIMIT));
  if (!gridded) {
    const all = new Int32Array(words);
    for (let b = 0; b < m; b++) all[b >>> 5]! |= 1 << (b & 31);
    return new Array<Int32Array>(m).fill(all);
  }
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const cellX = new Int32Array(m);
  const cellY = new Int32Array(m);
  const cells = new Map<string, Int32Array>();
  for (let b = 0; b < m; b++) {
    cellX[b] = Math.floor(px[b]! / cell);
    cellY[b] = Math.floor(py[b]! / cell);
    const k = key(cellX[b]!, cellY[b]!);
    let bits = cells.get(k);
    if (!bits) cells.set(k, (bits = new Int32Array(words)));
    bits[b >>> 5]! |= 1 << (b & 31);
  }
  const unions = new Map<string, Int32Array>();
  const near: Int32Array[] = [];
  for (let a = 0; a < m; a++) {
    const k = key(cellX[a]!, cellY[a]!);
    let union = unions.get(k);
    if (!union) {
      union = new Int32Array(words);
      for (let gx = cellX[a]! - REACH; gx <= cellX[a]! + REACH; gx++) {
        for (let gy = cellY[a]! - REACH; gy <= cellY[a]! + REACH; gy++) {
          const bits = cells.get(key(gx, gy));
          if (bits) for (let w = 0; w < words; w++) union[w]! |= bits[w]!;
        }
      }
      unions.set(k, union);
    }
    near.push(union);
  }
  return near;
}
