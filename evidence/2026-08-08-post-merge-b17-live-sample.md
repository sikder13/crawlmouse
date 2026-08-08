# B17 — the post-merge live sample on the DEPLOYED function. MEASURED RESULT: one shipped-behaviour blocker.

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
| Audits complete on the deployed function | ✅ 13 of 15 completed; 2 still crawling at report time |
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
| 10 | rewardguru.in | 118 | 2 412 | B / 75.52 | — | 118→66 | low | 187 s |
| 11 | **quotes.toscrape.com** | **214** | **3 978** | **REFUSED ❌** | `site_too_small_to_measure` | 214→**1** | high | 22 s |
| 12 | hafiz.dev | 389 | 15 590 | A− / 87.59 | — | 389→386 | low | 155 s |
| 13 | racedays.run *(health check)* | 500 | 7 863 | B / 79.93 | — | 500→**26** | low | 68 s |
| 14 | freepltn.com | — | — | *still crawling at report time* | | | | |
| 15 | mohammadalinijhoom.com | — | — | *still crawling at report time* | | | | |

**`fingerprint` present: 0 of 13.**

### Observed refusal rate

**7 refused of 13 completed = 53.8%.** Across all fresh 5.1a audits in production: **7 of 12 with a
terminal refusal decision = 58.3%.**

**This sample is deliberately biased** toward shapes chosen to refuse (four small sites, three JS
shells), so it is **not** an unbiased population estimate and must not be quoted as one. What it does
establish is that the mechanism fires far more often than the sign-off figure suggested, and that at
least one firing is false.

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
  did not recur. 13 of 15 completed, the slowest large site in 187 s.
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

> **B17 · Live smoke · NOT MET → RUN, AND IT FAILED THE HONESTY BAR.**
> The post-merge smoke and the ~15-site live sample were executed against the deployed function on
> 2026-08-08 (deployment `dpl_AUzxC1uMaJQ6JG8ijTkFP4n9iTk7`, merge `6d9c676`). The pipeline, the
> refusal gate, persistence of `refusal`/`coverage`, and the empty-frontier invariant all pass. **Two
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
