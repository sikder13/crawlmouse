// SPEC 04.1 §6 — the single honest representation of a per-fix marginal impact, shared by the result
// surface (result-logic → FreeFixCard / LockedCureCard / dashboard FixChecklist) and the /r/ report
// (sections). One decimal place matches the report's existing `.toFixed(1)` and never collapses a
// sub-1 nonzero delta to "+0". These are RELATIVE per-fix estimates — never summed (SPEC 02 §3).
export function impactLabel(marginalDelta: number): string {
  return `+${marginalDelta.toFixed(1)} pts`;
}
