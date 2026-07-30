# AI-score delta from the entity-signal changes (re-measured 2026-07-29)

**Result: 69 corpus homepages · 4 gained +3.0 · 0 lost · 65 unchanged. Strictly corrective.**

> **This file has now contradicted the code twice, and that is itself the finding.** The first version
> said the vocabulary *"stays exact-match … widening is FU-4"* after the owner had ruled the widening
> in. The second was re-measured correctly but went stale within the same review round: it listed
> `sourceOrganization` as a crediting position after that position was removed, and stated a 168-type
> closure after the closure was regenerated to 187. Both were caught by gate reviewers, not by me.
>
> A shipped scoring change whose only evidence artifact disagrees with the code is a defect regardless
> of who authorised the change. The lesson recorded here: **this file must be re-measured in the same
> commit as any change to the predicate it measures** — not updated afterwards from memory.

## What is measured

Four changes to the homepage-entity signal, measured together because they ship together:

1. **Recursion**: `@graph`-only → a whitelist of self-declaring property positions —
   `@graph`, `publisher`, `isPartOf`, `mainEntityOfPage`, and **nothing else**.
2. **Vocabulary**: exact-match on `{Organization, WebSite}` → a **generated closure of the Schema.org
   Organization subtree — 187 types** (`schema-org-types.ts`) plus both full-IRI spellings.
3. **Positions removed** after proven third-party counterexamples: `provider` (credited MIT on a
   course directory), `mainEntity` (credited someone else's restaurant on a listings page), and
   `sourceOrganization` — Schema.org defines the last as *"the Organization on whose behalf the creator
   was working"*, which on syndicated content is the wire service, not the site.
4. **`author` REMOVED from crediting entirely** (round 8, owner ruling — a reversal of the owner's own
   earlier instruction). `author` had been traversal-only so that `author.worksFor` could still be
   credited. It fails the rule in 3: on the syndicated article that makes `author` untrustworthy, the
   reporter's `worksFor` **is** the wire service, and a guest post's author often has a day job
   elsewhere. Ambiguous means exclude.

   The asymmetry decided it: a false positive **suppresses a true finding**, handing +3.0 to a site
   that genuinely does not declare itself — the product lying toward comfort. A false negative merely
   asks a site to add markup. The removal deleted the whole traversal-only mechanism, including the
   array-shape handling that had been a round-7 blocking fix — that fix was correct for the design it
   served, and the design is now gone.

Each change can move a site by exactly `LEGIBILITY_ENTITY_WEIGHT 0.15 × component weight 20 = 3.0`
AI points, in either direction, plus the presence or absence of a `missing_entity_link` finding.

## Method

Fetched the homepage of the most recent completed audits (69 distinct origins reachable at the time of
measurement), parsed every `<script type="application/ld+json">` block, and evaluated **both**
predicates — the pre-change `@graph`-only/two-name walk and the current shipped walk — on the **same
parsed JSON**. Fetching once and evaluating twice is what makes a disagreement a real delta rather than
crawl variance. The shipped predicate is read through the real `extractPage` — the production crawl
path, not a reimplementation — so this measurement cannot drift from what the worker computes. Only the
RETIRED predicate is reconstructed, because by definition it no longer exists in the codebase.

**The harness is committed: `scripts/measure-entity-delta.ts`.** Re-run it in the SAME commit as any
change to the entity predicate and paste the summary below:

```
nvm use 22 && npx tsx scripts/measure-entity-delta.ts --limit=80
```

It was a throwaway script for the first two measurements, which is precisely how this document drifted
from the code twice: the rule "re-measure when the predicate changes" had no mechanism behind it. The
numbers below are reproducible from this repository.

## Result

```
SUMMARY: 69 homepages | 4 gained +3.0 | 0 lost -3.0 | 65 unchanged
```

| direction | count | meaning |
|---|---:|---|
| **gained +3.0** | 4 | a false `missing_entity_link` removed — the site DID declare an entity |
| **lost −3.0** | **0** | no site lost a credit it legitimately had |
| unchanged | 65 | already credited, or genuinely declares no entity |

Gainers: `alynthe.com`, `flooddamagepro.com`, `thejerseyworld.com.au`, `taskrabbit.co.uk` — each
declares its organisation through a position or subtype the old two-name exact-match could not see.

**Zero regressions is the number that matters.** The narrowing (`provider`, `mainEntity` and
`sourceOrganization` removed, `author` demoted to traversal-only) was the part that could have cost
sites a legitimate credit, and on this corpus it cost none — while the closure recovered four false
findings.

## What this corpus CANNOT show

Two measurements taken on the same pass, both returning zero, and both worth stating plainly rather
than leaving as an implied claim:

- **Sites with an array-valued `author` carrying `worksFor`: 0.** So the `author` removal (change 4)
  costs nothing measurable here — re-running this harness after the removal returned the identical
  69 / 4 / 0 / 65 with the same four gainers. But that is weak evidence, and it is stated as weak: the
  corpus is what real users audited — small business and SaaS marketing sites — while the author-employer
  shape belongs to editorial, agency and staff-author blogs, which are barely represented. A staff-author
  blog whose ONLY Organization declaration sits in `author.worksFor` will now draw a
  `missing_entity_link` it did not draw before. That is the accepted cost of the ruling, not an
  unforeseen consequence: a false negative asks for markup, a false positive suppresses a true finding.
- **Sites using a CURIE-prefixed `@type` (`schema:Organization`): 0.** Recognising CURIE forms was
  raised in review as a possible false-negative source. On this evidence it is a speculative widening
  of a scoring predicate with no measured beneficiary, so it is deferred (FU-4 family) rather than
  added at a final gate.

## Scope of the claim

- The **A–F grade is untouched by construction**: `aiSignals` never reach `grade.ts`, and no
  grade-path file has changed since `5fc5673` (`crawler.ts`, `audit.ts`, `extract.ts`, `grade.ts` and
  the four analysis modules are byte-identical). Separately proven in
  `evidence/grade-identity-spec05-hardening.md` and re-run each round in the A15 backtest.
- This measures the **homepage** signal only, which is the only place `hasEntityType` is read
  (`assemble.ts`).
- The corpus skews toward small business and SaaS marketing sites — the intended audience, but not a
  uniform sample of the web, and (see above) not a sample that contains every shape the code handles.
