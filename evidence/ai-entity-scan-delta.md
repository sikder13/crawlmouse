# AI-score delta from the entity-signal changes (measured 2026-07-28)

**Result: 57 corpus homepages · 4 gained +3.0 · 0 lost · 53 unchanged. Strictly corrective.**

> **This file previously stated the opposite of the code.** An earlier version said *"ENTITY_TYPES
> stays exact-match on Organization / WebSite; widening the vocabulary to subtypes and IRI forms is
> FU-4 and deliberately not part of this change"* — which stopped being true when the owner ruled the
> widening in. A gate reviewer caught the contradiction. A shipped scoring change whose only evidence
> artifact contradicts it is a defect regardless of who authorised the change, so this file is
> rewritten against what the code now does and re-measured from scratch.

## What is measured

Three changes to the homepage-entity signal, measured together because they ship together:

1. **Recursion**: `@graph`-only → a whitelist of self-declaring property positions
   (`@graph`, `publisher`, `isPartOf`, `mainEntityOfPage`, `sourceOrganization`), with `author`
   traversal-only and crediting re-enabled solely at `worksFor`.
2. **Vocabulary**: exact-match on `{Organization, WebSite}` → a **generated closure of the Schema.org
   Organization subtree** (168 types, `schema-org-types.ts`) plus both full-IRI spellings.
3. **Positions removed** after proven third-party counterexamples: `provider` (credited MIT on a
   course directory) and `mainEntity` (credited someone else's restaurant on a listings page).

Each change can move a site by exactly `LEGIBILITY_ENTITY_WEIGHT 0.15 × component weight 20 = 3.0`
AI points, in either direction, plus the presence or absence of a `missing_entity_link` finding.

## Method

Fetched the homepage of the 60 most recent completed audits (57 distinct origins), parsed every
`<script type="application/ld+json">` block, and evaluated **both** predicates — the pre-change walk
and the post-change walk — on the **same parsed JSON**. Any site where they disagree is a real delta.

## Result

```
SUMMARY: 57 homepages | 4 gained +3.0 | 0 lost -3.0 | 53 unchanged
```

| direction | count | meaning |
|---|---:|---|
| **gained +3.0** | 4 | a false `missing_entity_link` removed — the site DID declare an entity |
| **lost −3.0** | **0** | no site lost a credit it legitimately had |
| unchanged | 53 | already credited, or genuinely declares no entity |

Example gainer: `taskrabbit.co.uk`, which declares its organisation through a position or subtype the
old two-name exact-match could not see.

**Zero regressions is the number that matters.** The narrowing (`provider`/`mainEntity` removed,
`author` demoted) was the part that could have cost sites a legitimate credit, and on this corpus it
cost none — while the closure recovered four false findings.

## Scope of the claim

- The **A–F grade is untouched by construction**: `aiSignals` never reach `grade.ts`, and no
  grade-path file has changed since `5fc5673` (`crawler.ts`, `audit.ts`, `extract.ts`, `grade.ts` and
  the four analysis modules are byte-identical). Separately proven in
  `evidence/grade-identity-spec05-hardening.md` and re-run each round in the A15 backtest.
- This measures the **homepage** signal only, which is the only place `hasEntityType` is read
  (`assemble.ts`).
- The corpus is what real users audited; it skews toward small business and SaaS marketing sites,
  which is the intended audience but not a uniform sample of the web.
