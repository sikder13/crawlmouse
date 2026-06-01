export interface GraphStatPage { is_orphan: boolean; depth: number | null }
export interface GraphStats { orphanCount: number; avgDepth: number }

/**
 * Headline link-graph stats for the GradeCard: how many orphan pages, and the
 * mean click depth. Pages without a computed depth are excluded from the average
 * (and the divide-by-zero case is guarded), so an audit with no depths reports 0
 * rather than NaN.
 */
export function aggregateGraphStats(pages: GraphStatPage[]): GraphStats {
  let orphanCount = 0;
  let depthSum = 0;
  let depthCount = 0;
  for (const p of pages) {
    if (p.is_orphan) orphanCount++;
    if (p.depth != null) {
      depthSum += p.depth;
      depthCount++;
    }
  }
  return { orphanCount, avgDepth: depthCount === 0 ? 0 : depthSum / depthCount };
}
