export interface FindingRow { category: string; severity: string; pages?: { url: string } | null }
export interface FindingGroup { category: string; total: number; shown: FindingRow[]; hidden: number }

/**
 * Group findings by category and, for free users, cap each group to the top `freeLimit`.
 * Capping here (server-side, before the rows ever leave the API) is what enforces the paywall —
 * the gated rows are never sent to a non-Pro client. Pro users get every row.
 */
export function groupAndCapFindings(findings: FindingRow[], isPro: boolean, freeLimit = 5): FindingGroup[] {
  const byCat = new Map<string, FindingRow[]>();
  for (const f of findings) {
    const arr = byCat.get(f.category) ?? [];
    arr.push(f);
    byCat.set(f.category, arr);
  }
  return [...byCat.entries()].map(([category, rows]) => {
    const shown = isPro ? rows : rows.slice(0, freeLimit);
    return { category, total: rows.length, shown, hidden: rows.length - shown.length };
  });
}
