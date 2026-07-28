# AI-score delta from widening the entity scan (owner ruling, 2026-07-28)

**Result: 37 homepages checked, 0 changed. No measured AI-score movement on the corpus.**

## What changed

`scanForEntityType` (`packages/engine/src/analysis/ai-readiness/legibility.ts`) previously recursed into
arrays and `@graph` **only**. A homepage declaring its Organization under an ordinary property —
`publisher`, `isPartOf`, `author.worksFor`, the shape plain Article markup and Squarespace/Wix emit —
was reported as declaring no entity at all: a factually false `missing_entity_link` finding and a
**3.0-point** AI-score loss (`LEGIBILITY_ENTITY_WEIGHT` 0.15 × component weight 20).

The walk now descends into every property value, under the **same** depth and node budgets — widening
redistributes a fixed budget over more of the document rather than raising the ceiling.
`ENTITY_TYPES` stays exact-match on `Organization` / `WebSite`; widening the vocabulary to subtypes and
IRI forms is FU-4 and deliberately not part of this change.

## Method

Fetched the homepage of the backtest corpus (most recent completed audits), parsed every
`<script type="application/ld+json">` block, and evaluated the entity predicate **both** ways on the
same parsed JSON — `@graph`-only vs all-properties — reporting any site where they disagree.

## Result

```
SUMMARY: 37 homepages checked, 0 changed
```

Every corpus site that declares an entity does so via `@graph` (the Yoast/RankMath shape) or a
top-level `@type`, both of which the old walk already reached. Sites without an entity have none to
find under either predicate.

## Reading this honestly

Zero movement is **not** evidence the defect was theoretical — the nested-publisher shape is
reproducible on demand and is covered by fixtures in `legibility.test.ts`. It means the corpus happens
to be dominated by WordPress SEO plugins, which emit `@graph`. The fix is a correctness fix that
removes a class of false finding; the measured blast radius on today's corpus is nil, which is the
best possible outcome for a pre-launch correction.

**The A–F grade is unaffected by construction** — `aiSignals` never reach `grade.ts` — and is
separately proven byte-identical in `evidence/grade-identity-spec05-hardening.md`, with the A15
backtest re-run in `evidence/backtest-spec05-stage7-round3.md`.
