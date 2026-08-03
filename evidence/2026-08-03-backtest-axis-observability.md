# SPEC 5.1a Stage 0.5 — evidence that the backtest can now observe a crawl-half change

**Recorded:** 2026-08-03 · branch `engine/spec-5-1a` · base `origin/main` = `69b039f`
**Status:** gate evidence. Nothing here changes the engine; the engine is byte-identical to `main`.

---

## 1. The claim under test

SPEC 5.1a Stage 1 (robots on every entry path, canonicalisation, trap caps) and Stage 3 (stratified
frontier) change **which pages are fetched**. The pre-5.1 harness crawled each site **once** and graded
that single output under v1 and v2, so its axis was the **grading** half. A crawl-half change is applied
identically to both sides of that diff and cancels out exactly.

**Claim: the old harness would have reported "no change" for a change that moves grades — and the
re-axed harness reports it, with the moved pages named.**

This is not a hypothetical failure mode. It is the same blindness SPEC 05 found when this harness
silently could not observe AI-readiness output.

## 2. Method

Two independent engine builds in one process:

- **base** — a `git worktree` at `origin/main` (`69b039f`), loaded by absolute path via dynamic import.
- **head** — this branch's engine.

Target: `https://defaultoffice.com/` (already in the audit corpus), `pageCap=8`, `budget-ms=60000`.

To create a *pure crawl-half* difference, the **base** worktree's engine was temporarily probed with a
one-line change in `packages/engine/src/audit.ts` — the page cap handed to `runCrawl` reduced by 3. It
touches only which pages are fetched; no grading logic changes. The probe was reverted afterwards and
the base worktree verified clean (`git status --porcelain` empty).

## 3. Control — identical engines

Before the probe, both sides ran the unmodified engine:

```
| URL                        | base      | head      | Δ     | grade | composition (base→head) |
| https://defaultoffice.com/ | B-/72.74  | B-/72.74  | +0.00 | same  | 8→8 identical           |
```

Two independent builds, two independent crawls, **identical composition and identical grade**. This is
the control: it establishes that a difference in §4 comes from the engine and not from crawl jitter on
this site.

## 4. The measurement

### 4.1 New axis — with the crawl-half probe on the base engine

```
| URL                        | base     | head      | Δ     | grade | composition (base→head)                                                        |
| https://defaultoffice.com/ | B/75.21  | B-/72.74  | -2.47 | B→B-  | 5→8 −0/+3 (/projects/bound-looplock /projects/daylight-computer /projects/grab-lamp) |

**1** site(s) where the fetched-page set changed (an explained input change; the moved URLs are named).
**0** site(s) where the grade moved on an IDENTICAL sample.
```

The harness reports the grade movement (−2.47, B→B−), reports that the **sample moved** (5→8), and
**names the three pages** that entered. The row is attributable without further investigation.

### 4.2 Old axis — the same two engines, measured not assumed

Reconstructing the pre-5.1 axis (crawl once, grade that one output under v1 and v2) against each engine:

| engine | pages fetched | v1 | v2 | **old-axis Δ** |
|---|---|---|---|---|
| base, **with** the crawl-half probe | 5 | B/75.21 | B/75.21 | **0.00** |
| head, without it | 8 | B−/72.74 | B−/72.74 | **0.00** |

**The old harness reports Δ0.00 for both.** The two engine builds genuinely differ by 2.47 points and by
three pages, and the old axis registers nothing, because it only ever compares two gradings of *its own*
single crawl. It would have signed off "no change" on a change that moves grades — which is exactly the
failure this stage exists to remove.

## 5. Deterministic coverage

The live run above proves the CLI plumbing. The *structural* claim is pinned by tests that run in the
suite and do not depend on a third-party site:

- `scripts/backtest-runner.test.ts` — "THE DEFECT": both gradings of one crawl read the same `pages`
  array, so the fetched-URL set is identical **by construction**. "THE FIX": the base-vs-head axis
  reports the digest difference and asserts the **content** of the set difference (`/c`, `/d`), not
  merely that it is non-empty. A third test pins that the same engine twice yields an identical digest,
  so a flaky fixture cannot masquerade as observability.
- `scripts/backtest-diff.test.ts` — digest order-independence, duplicate-independence, non-collision
  across differently-split URL sets, and a pin against an **independently computed** sha256 rather than
  the function's own output.

### Mutation verification

Harness liveness was proven first with an unconditional `throw` (14 tests failed). Each mutation was
applied to a `cp` backup and reverted from it — never `git checkout --`. All eight were killed by named
tests:

| # | Mutation | Killed by |
|---|---|---|
| M1 | `crawlDigest` drops `.sort()` (arrival order leaks in) | 4 tests |
| M2 | `crawlDigest` drops the per-URL terminator | collision test + the hand-computed pin |
| M3 | `diffCrawlComposition` always reports `identical` | 4 tests |
| M4 | `formatCompositionDelta` hides what it withheld | truncation-disclosure test |
| M5 | `okUrls` stops filtering on status 200 | status-filter test |
| M6 | `runSide` stops rejecting a 0-page crawl | exclusion test |
| M7 | excluded rows fabricate a composition instead of `null` | exclusion test |
| M8 | **head side silently reuses the base crawl (the old axis, restored)** | "THE FIX" |

M2 initially had only the hand-computed pin killing it; a behavioural non-collision test was added so
the property does not depend on a single constant.

## 6. Incidental finding, carried into Stage 1

The fixture first drove the difference through campaign-tagged links (`?utm_source=`), assuming only the
v2 identity path strips them. It produced **identical compositions**: Crawlee's own request-queue dedup
normalises common tracking params away at **enqueue** time, before our canonicalisation is consulted.

So part of the URL collapse SPEC 5.1 §4.3 predicts **already happens one layer below us**, and Stage 1's
measured effect on page counts must be read with that in mind — it will be smaller than the spec implies.
This compounds the Stage 0 finding that `url-canonical.ts` already implements most of §4.3.

## 7. Verification

`pnpm test` green — engine 48 files, inngest 8, web 197, scripts 2 (5/5 turbo tasks). `pnpm lint` clean.
`pnpm typecheck` run after the final commit. The three pre-existing eslint errors under `scripts/`
(`measure-entity-delta.ts`, `p5/reconcile-dryrun.ts`) are unchanged from `origin/main`, are in files this
work does not touch, and are outside the project lint gate because the `scripts` package declares no
`lint` script.

## 8. How to reproduce

```bash
nvm use 22
git worktree add --detach ../crawlmouse-base origin/main && (cd ../crawlmouse-base && pnpm install)
pnpm backtest -- --mode=ab \
  --base-engine=$PWD/../crawlmouse-base/packages/engine/src/index.ts \
  --urls=https://defaultoffice.com/ --pageCap=8 --budget-ms=60000
```
