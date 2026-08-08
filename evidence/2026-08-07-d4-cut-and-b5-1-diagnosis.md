# D4 CUT from 5.1a — the full B5-1 diagnosis, and the constraint 5.1b inherits

**Ruling:** 2026-08-07, by the owner, after gate 5. *"A finding derived from our own page cap is a
claim about the customer's site manufactured from our budget — the exact class this spec deletes.
Same logic as the Stage 5 cut: measured dishonesty does not ship."*

**Cut in:** `9a73197`. **Gate reports:** `evidence/2026-08-07-gate5-reports.md`
(frozen SHA `5c5204a6b3377b53dd83024c0828d4f8317de6eb`).

This document exists so 5.1b does not have to re-derive any of it.

---

## 1. What D4 claimed, and what it actually measured

The finding: **"N of the M pages in your sitemap can't be reached by following links."** Emitted
FIRST so it led the findings list, at `critical` severity when the unreachable pages outnumbered the
reachable ones, and deliberately surviving a refusal.

The implementation differenced the declared set against `GraphAnalysis.depths` — BFS over
`buildGraph(pages, links)`. **`graph.ts` drops every edge whose target was not fetched.** So
"reachable by following links" silently meant *"fetched, and reachable through other fetched pages,
in the crawl we could afford."*

The sentence is about the site. The number was about our budget.

## 2. The measurements

### Gate 4 (reviewer 3) — the complete-mesh fixture

Every page links to every other page; sitemap declares all 41. Zero orphans by any definition.

| pageCap | fetched | reported unreached | severity | verdict |
|---|---|---|---|---|
| 5 | 5 | **36** | critical | C+/68 — **graded** |
| 10 | 10 | **31** | critical | C+/68 |
| 41 | 41 | 0 | — | C+/68 |

### Gate 5 (reviewer 3) — the hub-and-leaf fixture, which is the one that matters

Homepage → 40 section pages → 10 leaves each = **441 declared**. Zero orphans. **Every leaf is
exactly two clicks from the homepage.**

| pageCap | fetched | reported unreached | severity | leads? | verdict |
|---|---|---|---|---|---|
| 5 | 5 | **400** | critical | yes | **GRADED D** |
| 10 | 10 | **400** | critical | yes | **GRADED D-** |
| 25 | 25 | **400** | critical | yes | **GRADED F** |
| 60 | 60 | **230** | critical | yes | **GRADED C+** |
| 441 | 441 | **0** | — | — | **GRADED B** |

`reachable` stuck at 41 from cap 5 through cap 25 — **the crawl had fetched pages whose outbound
links we parsed and then discarded**, because those pages were not BFS-reachable through *fetched*
intermediates.

### Gate 5 (reviewer 1) — at the real production cap

An ordinary paginated blog: 600 posts, `/page/2…/page/61` archives linking 10 posts each plus
next/prev, sitemap declaring the homepage + 600 posts and **not** the paginated archives — the
default output of every major WordPress SEO plugin. Every post is two clicks from the homepage.

```
cap 500 (= FREE_PAGE_CAP) → 400 of 601 unreached, critical, leading, GRADED D/45.27
cap 900                   → 0 unreached,                              GRADED C/61.1
```

A scaled 120-post run reproduces the gate-4 signature exactly: cap 20 → 110 · cap 60 → 90 · cap 200 → 0.

### Exposure

`FREE_PAGE_CAP = 500`; sitemaps are collected to `DEFAULT_MAX_SITEMAP_URLS = 10 000`. Live corpus at
the time of the cut: of **215 completed audits, 25 sit at ≥500 pages and 62 at ≥200.** Nothing
suppressed the finding on a truncated crawl — `sitemapDeltaSeverity` read only `coverage`, never
`crawlHealth.partial`.

## 3. The two failed fix attempts — and why each test could not fail

Recorded because the *pattern* is the transferable lesson, not the two patches.

**Attempt 1 (gate 4 → gate 5), `6c09b9a`: measure reachability ONE HOP past the fetch boundary.** A
declared URL that any reachable page links to counts as reached, whether or not we fetched it.

Correct as far as it went, and it does kill the complete-mesh case at every cap. It fails on any
structure needing **more than one hop**, which is exactly what hub-and-leaf and pagination are — and
the crawler's own seeding guarantees that shape whenever a sitemap declares more URLs than the cap,
because the budget is spent on declared URLs and the hubs that connect them are truncated mid-chain.

**The accompanying comment was the real error:** *"the residue is no longer the systematic case,
because a site with ordinary navigation links its pages from every page we fetch."* Reasoned, not
measured, and false. Paginated navigation is ordinary navigation and does not do that. The project's
own rule — **measure, don't reason** — was available and not applied.

**Both acceptance fixtures were vacuous, in the same shape, one level apart:**

| attempt | fixture | why the property could not fail |
|---|---|---|
| original | declared leaves with **no inbound link at any cap** | the cap can never bind on them |
| attempt 1 | a **complete graph** | one hop from any fetched page reaches everything |

The second was titled *"reports ZERO unreached at a cap that binds — the count is not a function of
our budget"*. It does bind the **cap**, which is what gate 4 asked for. It cannot bind the **one-hop
rule**, which is what it certifies. **Fixing the stated defect in the fixture is not the same as
making the fixture able to falsify the claim.**

Worse, the branch then contradicted itself in three places at once:

- `coverage.test.ts` **pinned the residue as correct** — *"does NOT take a second hop — a page linked
  only from an unfetched page stays unreached"* — which is the failing case, asserted as intended.
- the code comment claimed the residue was no longer systematic.
- the acceptance sweep read **B10: MET**, in a document whose closing line is *"No criterion is
  reported met on the strength of a stub."*

## 4. What was cut, and what deliberately stayed

**Cut:** `sitemapUnreachedFinding`, `sitemapDeltaSeverity`, `linkReachableUrls`, the
`sitemapUnreached` field on `CoverageAccounting`, the `sitemap_unreached` finding category, its
entry in `INFORMATIONAL`, its comprehension entry in `finding-meta`, and refusal copy body (d).

**Stayed**, because neither moves with our budget: `sitemapDeclared` (we received the declaration)
and `sitemapRobotsExcluded` (the owner wrote the rule).

**Body (d) mattered most.** It made the number the HEADLINE of a refusal — *"This is the finding, not
a caveat"* — and on a refused audit the `incomplete_crawl` caveat is deliberately withheld by
`assertsVerdict`. So the false number led with its only qualifier removed **by design**.

**The freepltn shape that motivated D4 loses nothing honest.** With one reachable page and no
observed edges into the graded population it refuses on `no_observed_links` — a measurement we hold.

**Legacy rows are safe by construction and pinned:** pre-cut audits still carry `sitemap_unreached`
in `findings`; `findingMeta` falls back for unknown categories and the category is no longer
informational, so an old row renders as a generic ledger row and never as a banner asserting
reachability.

---

## 5. WHAT 5.1b INHERITS — read this before rebuilding it

### The constraint, stated as an acceptance criterion

> **A sitemap-orphan claim must be budget-independent, or refused.**
>
> If the number can move when only our page cap moves, it is not a statement about the site and must
> not be published as one — at any severity, in any position, under any wording.

**B10 moves to 5.1b with the feature.** It is marked NOT-5.1a's *by design* in
`evidence/2026-08-06-stage6-acceptance-sweep.md`, not as a 5.1a failure and not quietly counted as a
pass.

### The two candidate designs both reviewers named

1. **Widen the basis to ALL FETCHED PAGES rather than BFS-reachable ones.** We already parsed those
   links; discarding them is a pure loss. R3 measured that this alone recovers cap-25 behaviour to
   cap-60 behaviour on the hub-and-leaf fixture. It reduces the budget dependence; it does not
   eliminate it.
2. **Withhold the delta entirely when `crawlHealth.partial` and the declared set exceeds what we
   fetched.** Categorical, so it introduces no tuned threshold — which matters, because 5.1a admits
   none and the calibrated thresholds are 5.1b's own §10.

They compose. Neither has been implemented or measured beyond the notes above.

### The acceptance fixture requirement

**It must be a PAGINATED HUB — a structure needing more than one hop — not a complete graph and not
a set of unlinked leaves.** Both previous fixtures certified the rule on the one input class where
it could not fail. Before shipping the next version, answer explicitly: *what input would make this
test go red?* If you cannot construct one, the test is decoration.

Reference fixture shapes, both already written and measured:
- homepage → 40 sections → 10 leaves each (441 declared), caps 5 / 10 / 25 / 60 / 441;
- 600 posts + 60 `/page/N` archives, sitemap declaring posts only, caps 500 / 900.

### Related carry-forward

`refusal-copy.ts` reimplemented the D4 categorical rule instead of importing
`sitemapDeltaSeverity` — a second copy of one concept, and mutating its boundary (`>` → `>=`) left
all 1477 web tests green (gate 5, R1-NB2). Moot under the cut; **it returns the moment the feature
does.** One derivation, passed down.
