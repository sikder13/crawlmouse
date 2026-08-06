# `confidenceBand` passes through the projection chokepoint unchecked

**Filed** 2026-08-06, during the SPEC 5.1a Stage 6 import-graph guard work.
**Severity** latent — not reachable today. **Do not fix inside 5.1a**: the fix is a behaviour change.

## What

`projectAuditForClient` (`apps/web/lib/audit-stream-projection.ts`) correctly nulls the verdict —
`grade: row.grade`, `score: asNumber(row.score)` — but passes `conversion.confidenceBand` straight
through with **no refusal check of its own**:

```ts
return {
  ...base,
  confidenceBand: conversion.confidenceBand,   // <- no gate
  projectedGrade: conversion.projectedGrade,
  ...
};
```

Measured: constructing a refused row (`grade: null, score: null`) with a populated band serialises

```
"grade":null "score":null
"confidenceBand":{"lower":38,"upper":45,"point":41.42}
```

— a point estimate of 41.42 sitting beside a null score. **That is the exact shape of the Stage 4
defect**, which was found when the band carried the point estimate after the verdict had been withheld.

## Why it is not a live bug

The withholding happens **at the source**: the engine nulls `confidenceBand` together with `grade`,
`score`, `projectedGrade`, `prescriptions` and `freeFix` when the refusal gate fires, so the worker
never persists a band beside a null score and `conv.confidence_band` is NULL for a refused audit. The
probe above fabricated a row shape the engine cannot currently emit.

## Why it is worth a ticket anyway

Correctness rests entirely on one producer never emitting a shape, with **nothing downstream that would
stop it**. Every other withheld field has the same property, but the band is the one with history: it
is the field that already leaked once, for this exact reason, and the reason it leaked was that nulling
`score` alone was assumed to be sufficient.

The projection is the natural chokepoint — it is already where `canCure` and `canMonitor` gate the
owner-scoped fields. A refusal check belongs beside them.

## Suggested fix (5.1b or later)

Gate the withheld set at the chokepoint as well as at the source, keyed on the same signal the copy
seam uses (`row.refusal`), so the rule is enforced where the bytes are assembled rather than only where
they are produced. Two independent enforcements of one rule is the correct shape here — unlike the
hand-synchronised *derivation* class, this is one rule checked twice, not one value computed twice.

Add a `refusal-surfaces.test.ts` case using the **two-argument** overload of `projectAuditForClient`.
The current SURFACE 8 test calls the one-argument overload, so it never exercises `confidenceBand`,
`projectedGrade`, `freeFix` or `monitoring` on a refused audit at all — which is why this was invisible.

## How it was found

Not by a failing test. By writing the import-graph guard, seeing the SSE route's `?? ''` / `?? 0`
defaults, and checking what actually reaches the payload instead of assuming they were leaks. They were
not — `reconstructConversion` returns all-null for an empty fix set — but the check surfaced this.
