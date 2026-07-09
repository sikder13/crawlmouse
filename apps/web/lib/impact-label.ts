// SPEC 04.1 §6 — the single honest representation of a per-fix marginal impact, shared by the result
// surface (result-logic → FreeFixCard / LockedCureCard / dashboard FixChecklist) and the /r/ report
// (sections). One decimal place matches the report's existing `.toFixed(1)` and never collapses a
// sub-1 nonzero delta to "+0". These are RELATIVE per-fix estimates — never summed (SPEC 02 §3).
export function impactLabel(marginalDelta: number): string {
  // Engine deltas are finite + non-negative today, but never render "+NaN pts" / "+-0.5 pts" if that
  // ever changes — clamp to a non-negative finite value so the honest label can't become garbage.
  const d = Number.isFinite(marginalDelta) ? Math.max(0, marginalDelta) : 0;
  return `+${d.toFixed(1)} pts`;
}
