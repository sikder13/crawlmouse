# B17 — the post-merge live sample on the DEPLOYED function. MEASURED RESULT: one shipped-behaviour blocker.

> **STATUS: CLOSED — B17 is CLEARED and §6 is MET.** Both blockers below were fixed in PR #26 and
> verified on the deployed function after merge `4c11d92`. The body of this file is preserved as the
> record of what the sample found; the close-out is at the end.

**Date:** 2026-08-08 · **Merge commit:** `6d9c676` (PR #25, merge commit, full history, 133 commits)
**Deployment:** `dpl_AUzxC1uMaJQ6JG8ijTkFP4n9iTk7` — **READY**, `iad1`, built in ~170 s, aliased to
`crawlmouse.com` + `www.crawlmouse.com`, `aliasError: null`.
**Method:** real audits submitted through `https://crawlmouse.com/api/audits/start`, i.e. **the deployed
Vercel function and the production Inngest worker.** All verification via Supabase MCP against the
production database, never the UI.

---

## VERDICT

**The pipeline works. The refusal gate works. One shipped-behaviour defect was found, and it is
user-visible on the product's core market.**

| check | result |
|---|---|
| Deployment READY | ✅ |
| Audits complete on the deployed function | ✅ **15 of 15 completed** |
| `refusal` persists | ✅ on every completed audit |
| `coverage` persists | ✅ on every completed audit |
| **`fingerprint` persists** | ❌ **NEVER — 0 of 231 audits. §6.7 is unwired.** |
| Frontier tables remain EMPTY | ✅ `frontier` 0 rows, `frontier_politeness` 0 rows |
| New Sentry issues | ✅ none in the last 3 h |
| **A healthy site is never falsely refused** | ❌ **FAILS — see BLOCKER 1** |

---

## BLOCKER 1 — a healthy 214-page site is told "your site is too small to measure"

**`quotes.toscrape.com`** — 214 pages fetched, **3,978 internal links**, every page HTTP 200, every page
`excluded_from_grade = false` in `pages`, **213 of 214 carrying ≥ 80 characters of main text (mean 876)**.

**Result: REFUSED, trigger `site_too_small_to_measure`.**

The cause is `coverage.excluded`:

```json
[{"kind":"pagination","count":152},{"kind":"archive","count":60},{"kind":"auth","count":1}]
```

213 of 214 pages excluded by the **URL-kind classifier**, leaving `gradeable: 1`, which is below
`MIN_GRADEABLE_PAGES = 5`, which fires the small-site trigger.

The excluded pages are ordinary content, sampled from the run:

```
/tag/love/page/1                        3333 chars
/author/James-Baldwin                   2053 chars
/tag/connection/page/1                   351 chars
/tag/simile/page/1                       301 chars
/tag/misattributed-john-lennon/page/1    295 chars
```

**Why this is a blocker and not an honest refusal.** The owner's standing instruction is that honest
refusals are the release working. This one is not honest: the site is not small, and the copy asserts a
cause that is false. Asserting a false cause on the primary screen is the exact defect class SPEC 5.1a
exists to delete — it is gate 3's blocker in a new costume, reached through the coverage accounting
rather than through the render path.

**Blast radius is the core market.** `/tag/…`, `/page/N`, `/author/…` and `/category/…` are the default
URL structure of WordPress, Ghost and most blogs — the audience `PROJECT_OVERVIEW` §1 names first. Any
such site whose content lives behind those prefixes collapses to a near-zero gradeable population.

**This is the ORPHAN-UNDER-CAP family, one surface over.** That ticket records our own page cap
manufacturing orphans; this is our own *classifier* manufacturing a refusal. Same shape: a population
we cut ourselves, then reported on as though the site had produced it.

---

## BLOCKER 2 (severity: medium) — `fingerprint` is computed and thrown away

§6.7's artifact is never persisted. **0 of 231 audits have a non-null `fingerprint`**, including every
fresh 5.1a audit whose `refusal` and `coverage` both landed.

Traced end to end:

| stage | state |
|---|---|
| `packages/engine/src/crawler.ts:832` | builds the fingerprint, sets `out.fingerprint` ✅ |
| `packages/engine/src/audit.ts` | **zero occurrences of `fingerprint`** — `analyzeCrawl` never reads `crawlOut.fingerprint`, and the `AuditResult` it returns has no such field ❌ |
| `inngest/audit.ts:197` | passes that result to `persistAuditResults` |
| `inngest/persist-results.ts:182` | `...(result.fingerprint ? { fingerprint: … } : {})` → **always false** |

The column, the migration, `boundFingerprintForPersist`, the persist wiring and the runbook's
verification step all exist. Nothing populates them. The stage-4 runbook §4c check for it can never
pass.

---

## The sample — 15 sites across size strata, on the deployed function

Sorted by pages. `gradeable` is the engine's §7 graded population, not the row count.

| # | site | pages | links | verdict | trigger(s) | fetched→gradeable | conf | dur |
|---|---|---|---|---|---|---|---|---|
| 1 | zofbox.com | 1 | 2 | **REFUSED** | `site_too_small_to_measure`, `no_observed_links` | 1→1 | high | 4 s |
| 2 | careerbrainhq.com | 4 | 18 | **REFUSED** | `too_few_gradeable_pages` | 4→4 | medium | 2 s |
| 3 | randomcircles.com | 5 | 52 | **REFUSED** | `site_too_small_to_measure` | 5→**1** | high | 2 s |
| 4 | gloatroom.com | 6 | 37 | B / 75.81 | — | 6→5 | low | 5 s |
| 5 | exersaas.be | 7 | 35 | B+ / 82.12 | — | 7→5 | high | 6 s |
| 6 | chappie.app | 8 | **0** | **REFUSED** | `site_too_small_to_measure`, `no_observed_links` | 8→1 | high | 3 s |
| 7 | alynthe.com | 9 | **0** | **REFUSED** | `site_too_small_to_measure`, `no_observed_links` | 9→1 | high | 2 s |
| 8 | defaultoffice.com | 15 | 236 | B− / 70.61 | — | 15→15 | high | 3 s |
| 9 | provion.io | 79 | **0** | **REFUSED** | `site_too_small_to_measure`, `no_observed_links` | 79→3 | high | 12 s |
| 10 | mohammadalinijhoom.com | 58 | 2 629 | C / 62.51 | — | 58→44 | low | 250 s |
| 11 | rewardguru.in | 118 | 2 412 | B / 75.52 | — | 118→66 | low | 187 s |
| 12 | **quotes.toscrape.com** | **214** | **3 978** | **REFUSED ❌** | `site_too_small_to_measure` | 214→**1** | high | 22 s |
| 13 | freepltn.com | 219 | 14 823 | C− / 56.66 | — | 219→122 | low | 247 s |
| 14 | hafiz.dev | 389 | 15 590 | A− / 87.59 | — | 389→386 | low | 155 s |
| 15 | racedays.run *(health check)* | 500 | 7 863 | B / 79.93 | — | 500→**26** | low | 68 s |

**`fingerprint` present: 0 of 15.**

### Observed refusal rate

**7 refused of 15 completed = 46.7%.**

> ⚠ **CORRECTED after the last two audits finished.** This section first reported *7 of 13 = 53.8%* with
> `freepltn.com` and `mohammadalinijhoom.com` listed as still crawling. Both then completed and **both
> GRADED**, so the denominator moved and the rate fell. Re-measured against the finished sample per
> `OPERATING-RULES` §10 — the rule this branch added, applied to its own report.

**This sample is deliberately biased** toward shapes chosen to refuse (four small sites, three JS
shells), so it is **not** an unbiased population estimate and must not be quoted as one. What it does
establish is that the mechanism fires far more often than the sign-off figure suggested, and that at
least one firing is false.

**A prediction that was wrong, recorded rather than dropped.** `freepltn.com` was expected to refuse
with honest copy and no letter. It **graded C− / 56.66** over 219 pages and 14,823 links, with 122
gradeable. The expectation came from its corpus entry of 2 pages / 1 gradeable; the live crawl reached
219 pages. Either the site changed or the earlier crawl was throttled — this run does not distinguish
them, which is precisely the question §6.7's fingerprint exists to answer and cannot, because of
BLOCKER 2. Grading it is the correct outcome for a 219-page site; the prediction was simply stale.

### Reconciling with the §5 sign-off (51 of 215 = 23.7%)

The sign-off basis was `pages.status_code = 200 ∧ NOT excluded_from_grade`. **That proxy does not model
the kind-based exclusions the shipped engine applies** — `pagination`, `archive`, `thin`, `auth`,
`search`, `duplicate`. `quotes.toscrape.com` is the proof: 214 pages pass the proxy and **1** survives
the engine.

`evidence/2026-08-04-stage4-floor-calibration.md` said so at the time — *"Both numbers are lower bounds
on the refusal rate. Applying the missing exclusions can only move audits into refusal, never out."*
**§5's sign-off table carried the 51 without that qualifier.** The evidence was honest; the artifact the
sign-off was given against was not qualified. That is the same class this branch spent gates 7–10 on,
and it reached the tracked operating law.

---

## What held, and it is most of the release

- **The deployed pipeline works.** Audits submitted through production complete on the production
  Inngest worker — the §11 failure mode (crawlee untraced, concurrency over the Free cap, `spawn ps`)
  did not recur. 15 of 15 completed, the slowest in 250 s.
- **JS shells refuse correctly and for the right reason.** `chappie.app`, `alynthe.com`, `provion.io` —
  all with **0 observed internal links** — refuse on `no_observed_links`. This is the case the spec was
  written for, and it is exactly right.
- **Genuinely small sites refuse correctly.** 1-page and 4-page sites, with the correct small-vs-truncated
  split (`site_too_small_to_measure` when the crawl completed, `too_few_gradeable_pages` when partial).
- **Healthy sites still grade, including large ones.** `hafiz.dev` A−/87.59 over 389 pages,
  `rewardguru.in` B/75.52 over 118, `racedays.run` B/79.93 over 500.
- **`refusal` and `coverage` persist on every completed audit**, and `coverage` survives a refusal as
  designed — it is the evidence shown instead of a verdict.
- **Frontier tables remain empty** (0 / 0). Stage 5's wiring is cut and stays cut.
- **No new Sentry issues** in the 3 hours spanning the merge, the deploy and 15 live audits.

---

## B17 — the acceptance line, at its measured result

> **B17 · Live smoke · NOT MET → RUN, AND IT FAILED THE HONESTY BAR.** *(Superseded — see the
> close-out at the end of this file. Kept verbatim because it is what the sample measured on the day.)*
> The post-merge smoke and the ~15-site live sample were executed against the deployed function on
> 2026-08-08 (deployment `dpl_AUzxC1uMaJQ6JG8ijTkFP4n9iTk7`, merge `6d9c676`). The pipeline, the
> refusal gate, persistence of `refusal`/`coverage`, and the empty-frontier invariant all pass across **15 of 15 completed audits**. **Two
> defects block a clean close:** a false `site_too_small_to_measure` refusal on a healthy 214-page site
> caused by kind-based exclusion collapsing the gradeable population (BLOCKER 1), and `fingerprint`
> never being persisted because `analyzeCrawl` drops it (BLOCKER 2). B17 is therefore **RUN but NOT
> CLEARED**.

## Recommendation — the owner's call

1. **BLOCKER 1 is the decision.** It is user-visible, it asserts a false cause, and it targets the core
   market. Options: (a) revert the merge commit (`git revert -m 1 6d9c676`), (b) leave the release up
   and hotfix the classifier's participation in the gradeable population, or (c) raise
   `MIN_GRADEABLE_PAGES`' input so kind-excluded pages still count toward the floor. **(b) or (c) look
   right and (a) is available** — nothing about the release is unsafe, and reverting re-introduces the
   dashboard fabrication hazard for the 7 refused rows now in the database (see the stage-4 runbook §5,
   and note remedy C is one-way without the `expires_at` snapshot).
2. **BLOCKER 2 is a small, contained fix** — propagate `crawlOut.fingerprint` through `analyzeCrawl`'s
   result. It ships no user-visible behaviour, so it can follow.
3. **Correct §5's sign-off table** to state that 51/215 is a **lower bound**, which its own source
   evidence already said.

## Also found, unrelated to this release

**The GitHub repository is PUBLIC** (`gh api repos/sikder13/crawlmouse` → `private: false`).
`PROJECT_OVERVIEW` §9 records it as private. Vercel deployment metadata dates the flip between
`69b039f` (2026-07-31, `githubRepoVisibility: "private"`) and `f3a501b` (2026-08-07, `"public"`), so it
predates this work. Secret scans have been clean on every branch range pushed, but **no scan of the
full repository history has been run** — that is the check to run, and the overview needs correcting
either way.

---

# B17 — CLEARED. The §6 obligation is MET.

**Measured 2026-08-08 on the deployed function**, after the hotfix merge `4c11d92` (PR #26, merge
commit, 7 commits, full history) reached production as `dpl_HKJTVjXYbxqvMqLJ5bViGujDoyhT`
(state `READY`, aliased to `crawlmouse.com`).

Both blockers this file raised are closed, and both were verified from the deployed function rather
than from a local run.

## Blocker 1 — the false `site_too_small_to_measure` on a healthy 214-page site

A fresh production audit of `quotes.toscrape.com`, submitted through the site
(`91c6d29f-75dd-486d-b21f-03c7583a26de`):

| | |
|---|---|
| status | `completed` |
| grade | **withheld** (null) — correct, one gradeable page cannot support the measurement |
| triggers | **`["too_few_gradeable_after_exclusion"]`** — the new trigger, live |
| page_count / link_count | 214 / 3,978 |
| `coverage.excluded` | pagination 152, archive 60, auth 1 |
| `coverage.gradeable` | 1 |

**Rendered on crawlmouse.com**, captured from the live page rather than described:

> **No grade** — Too few content pages to grade the link structure
> Of the 214 pages we read on this site, 152 pagination pages, 60 tag or category archives, and
> 1 login or account page were not content we grade.
> That left 1 content page — too few to measure how a site links itself together.
> Below 5 content pages we don't publish a letter. This is about what we could measure — it isn't a
> judgement about the size or quality of your site.

Three things to read off that: the composition is the row's own (`152 / 60 / 1`, not a written-about
generalisation); the site is never called *too small*; and the list carries its conjunction — the
comma splice a reviewer found on this exact row is gone from the shipped page.

## Blocker 2 — `fingerprint` never persisted

**0 of 231 when this file was written; 0 of 252 immediately before the smoke; 2 of 254 after it.**
Both smoke audits carry one.

| audit | wire bytes | column bytes | strataTotal | strataWithheld |
|---|---|---|---|---|
| quotes.toscrape.com | 7,717 | 1,803 | 151 | **51** |
| hafiz.dev | 1,390 | — | — (uncapped) | — |

Sanitization verified against the persisted rows, not against a fixture: **0 strata carrying any
control character**, longest key 45 bytes against the 256-byte bound, 100 distinct keys with no
collision. The 100-row cap **states what it withheld** (`strataTotal 151`, `strataWithheld 51`)
rather than silently reporting 100.

The real-world size is worth recording beside the worst case: 7.7 kB on the wire for a 214-page site,
against a bounded hostile worst case of ~57 kB. The cap binds on pathological keys, not on ordinary
sites.

## The second changed path — a site that grades normally

`hafiz.dev` (`5a06437d-135f-499d-880b-16446995aa73`): **A− / 87.59**, 389 pages, 15,590 links,
386 gradeable, `refusal.triggers` empty. The live page renders the full result arc — grade card,
opportunity, graph, share text *"I scored A-/87.59 on internal linking"* — with no refusal copy
anywhere in it. The refusal path did not leak into the grading path.

## Invariants

| check | result |
|---|---|
| production deployment | `dpl_HKJTVjXYbxqvMqLJ5bViGujDoyhT` **READY**, sha `4c11d92` |
| frontier tables | **0 / 0** — Stage 5's wiring stays cut |
| audits failed in the smoke window | **0** |
| Sentry | unchanged — one pre-existing `crawl.degraded` signal at 10 events, last seen 2 h before the smoke. No new issues, no new events |

## The acceptance line, restated

> **B17 · Live smoke · MET.** Executed against the deployed function on 2026-08-08 after merge
> `4c11d92` (deployment `dpl_HKJTVjXYbxqvMqLJ5bViGujDoyhT`). Both changed paths were driven with real
> audits submitted through the site: the refusal path renders the true composition with correct
> grammar and never calls a 214-page site small, and the grading path is unaffected. Both blockers
> this file raised are closed and verified in the production database. `OPERATING-RULES` §6 —
> *"proven live counts only from the deployed function"* — is satisfied.

**Recommendation 3 of this file was also actioned:** §5's sign-off table no longer presents its
figures as a standing property. The corpus grew (215 → 236 completed) and the trigger counts moved
with it, so the table is now dated and marked as one moment's reading, with the query to re-derive it.

*Numbers here were measured against the tree and the database at the time of writing. The corpus
grows with every audit; the load-bearing claims are the two transitions — a false cause replaced by
the row's own composition, and a fingerprint count that moved off zero.*
