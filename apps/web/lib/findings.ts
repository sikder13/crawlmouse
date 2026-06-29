import { FREE_FINDING_LIMIT } from './limits';
import type { Finding, FindingCategory } from '@crawlmouse/types';

export interface FindingRow { category: string; severity: string; pages?: { url: string } | null }
export interface FindingGroup { category: string; total: number; shown: FindingRow[]; hidden: number }

/**
 * Group findings by category and, for free users, cap each group to the top `freeLimit`.
 * Capping here (server-side, before the rows ever leave the API) is what enforces the legacy paywall —
 * the gated rows are never sent to a non-Pro client. Pro users get every row.
 *
 * SPEC 02 D4 ("gate value, not volume"): on the v2 conversion experience the volume cap is RETIRED —
 * free sees the full diagnosis and the wall moves to the cure. Callers pass `uncapped=true` for a v2
 * audit; v1 (uncapped omitted/false) stays byte-identical to today.
 */
export function groupAndCapFindings(
  findings: FindingRow[],
  isPro: boolean,
  freeLimit = FREE_FINDING_LIMIT,
  uncapped = false,
): FindingGroup[] {
  const byCat = new Map<string, FindingRow[]>();
  for (const f of findings) {
    const arr = byCat.get(f.category) ?? [];
    arr.push(f);
    byCat.set(f.category, arr);
  }
  return [...byCat.entries()].map(([category, rows]) => {
    const shown = isPro || uncapped ? rows : rows.slice(0, freeLimit);
    return { category, total: rows.length, shown, hidden: rows.length - shown.length };
  });
}

/**
 * Map DB finding rows → the typed `Finding[]` (SPEC 02 v1.1 full diagnosis). `pageUrl` comes from the
 * joined pages.url; `payload` is never stored or emitted, keeping the wire lean.
 */
export function mapFindingRows(rows: FindingRow[]): Finding[] {
  return rows.map((r) => ({
    category: r.category as FindingCategory,
    severity: r.severity as Finding['severity'],
    pageUrl: r.pages?.url,
  }));
}
