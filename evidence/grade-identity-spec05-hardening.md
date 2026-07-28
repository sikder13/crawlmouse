# Grade identity across the SPEC 05 Stage-7 hardening round

**Question:** did the Stage-7 hardening commits move the grade?

**Answer: no. Zero deltas, byte-identical, across 10 fixture shapes × 2 engine paths = 20 comparisons.**

---

## Why this probe exists alongside the A15 backtest

The A15 harness (`scripts/backtest-engine.ts`) crawls real sites and diffs **engine v1 against v2**.
That is the right instrument for an engine cutover, and it is the wrong one for this question:

- it does not compare *pre-change* code to *post-change* code — both columns come from the same build;
- it re-crawls live sites, so crawl-to-crawl drift is present in every number. Drift can mask a small
  real delta, and can manufacture an apparent one. It cannot establish a byte-level identity claim.

So the A15 backtest was run (it is a named gate condition, and its v1↔v2 picture must not shift), and
this deterministic probe was run alongside it to answer the actual condition: **zero grade deltas from
these commits.**

## Method

`analyzeCrawl(crawlOut, ctx, v2)` is pure, so grading can be driven offline with no network and no DB.
The probe builds a corpus of fixed synthetic crawls, grades each under both v1 and v2, and prints
grade + score + page/link counts + findings by category.

The identical script was run in two worktrees:

| | |
|---|---|
| pre-change | detached worktree at `5fc5673` (the frozen handoff SHA) |
| post-change | `ai/spec-05-readiness` @ `1d470d0` |

and the two output streams were diffed.

**Fixtures are adversarial by construction.** Titles and anchor text are astral (`A` + emoji, so every
even-numbered cap lands mid-pair) and long enough to hit every cap the change touches. If any of that
crawled text leaked into a grade input, the numbers move. Shapes vary across all four grade components
— orphan rate, depth profile, anchor diversity, hub concentration — plus a sub-floor thin crawl, so a
delta cannot hide in an untested dimension.

## Result

```
diff pre-change post-change  →  IDENTICAL (exit 0)
```

| shape | pages | grade / score (v1) | grade / score (v2) | findings |
|---|---:|---|---|---:|
| small-clean | 12 | A / 91.4 | A / 91.4 | 0 |
| small-astral | 12 | A / 91.4 | A / 91.4 | 0 |
| orphan-heavy | 60 | C− / 59.38 | C− / 59.38 | 17 |
| deep-chain | 80 | C+ / 68.39 | C+ / 68.39 | 1 |
| generic-anchors | 50 | C+ / 68.96 | C+ / 68.96 | 2 |
| diverse-anchors | 50 | C+ / 68.96 | C+ / 68.96 | 2 |
| hub-concentrated | 120 | B / 75.11 | B / 75.11 | 3 |
| flat-no-hub | 120 | A− / 88.11 | A− / 88.11 | 0 |
| thin-crawl | 4 | C / 60 (coverage floor) | C / 60 | 2 |
| large-mixed | 300 | C+ / 65.76 | C+ / 65.76 | 33 |

Every row is identical pre- and post-change, and identical between v1 and v2 (expected: none of these
fixtures exercises a v1/v2 node-eligibility difference — every page is a clean 200).

## Why this is the expected result

`aiSignals` never feeds `grade.ts` — the AI-readiness score is a **sibling** of the grade, never blended
into it. The three pre-existing SPEC 02 sites the round also fixed (`sanitizeText`, `sanitizeUrl`,
`cleanInline`) feed the `fixes` table: the ledger's diagnosis text, target titles and action-packet
bodies. None is a grading input either.

That was the argument for expecting no delta. This probe is the proof, which is the part that matters —
"it should hold" and "it holds" are different claims.

## Reproducing

The probe is intentionally not committed as a repo script: it is a one-shot differential instrument
whose only meaning is *between two SHAs*, and a committed copy would rot into a fixture nobody diffs.
Recreate it by driving `analyzeCrawl` over fixed synthetic crawls (as described above) and running the
same file in a `git worktree --detach` at the comparison SHA.
