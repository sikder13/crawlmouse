# SPEC 5.1a Stage 4 — re-deriving the refusal rate, and what it says about the floor

**Recorded:** 2026-08-04 · branch `engine/spec-5-1a` · corpus: 212 completed audits, 41 103 page rows

---

## 1. Why this re-derivation happened, and the standard it sets

The refusal rate was first reported as **51 refused / 64 verdict-changed** using `page_count` as a
proxy for the gradeable population. The implemented trigger counts the **gradeable population**, which
is a different number, and I withdrew the figure on discovering the discrepancy.

Re-derived, the numbers came back **identical: 51 and 64.**

**That does not retroactively justify the original claim, and the distinction matters more than the
result.** The first number was right by luck: I could not have known the two bases agreed without
measuring, and reporting a figure whose provenance I had not checked is the defect regardless of
whether it happened to land. A number is only as good as the method behind it, and "it turned out
fine" is not a method. The withdrawal was correct **because it was unverified**, not because it was
wrong.

This is the same class as the confounded banking measurement earlier on this branch: both were
plausible, both were nearly published, and both were caught by checking provenance rather than by
noticing a wrong-looking answer.

## 2. Method and its limits, labelled

A faithful corpus-wide replay is **impossible**, and no estimate was substituted for it.

The thin-content gate needs `mainTextChars`, which lives in `pages.ai_signals` — present on only
**1 933 of 41 103 page rows (4.7 %)** and complete on only **9 of 212 audits (4.2 %)**. The other 200
audits predate that instrumentation entirely.

So two numbers exist, with different standing, and both are labelled where they are used:

| basis | n | what it applies | standing |
|---|---|---|---|
| **gradeable proxy** | 212 | status-200 ∧ `NOT excluded_from_grade` (recorded) | thin gate NOT applied ⇒ upper bound on gradeable ⇒ **lower bound on refusals** |
| **full replay** | 9 | the above **plus** the thin gate from persisted `mainTextChars` | classification **REPLAYED, not recorded**; URL-rule / noindex / near-dupe exclusions still unreplayable ⇒ still an upper bound |

**Both numbers are lower bounds on the refusal rate.** Applying the missing exclusions can only move
audits *into* refusal, never out.

## 3. The result

| | `page_count` basis (withdrawn) | gradeable proxy |
|---|---|---|
| refused (no letter) | 51 | **51** |
| verdict changed | 64 | **64** |
| unevaluable (`fetched_ok_count IS NULL`) | 6 | 6 |

Switching basis moves **exactly one audit** (`newly_refused = 1`, `newly_kept = 0`).

## 4. THE THIN-GATE QUESTION, ANSWERED BY MEASUREMENT

The open worry was whether the 80-character thin gate over-excludes — every engine test fixture
derives `gradeable = 1`, including one with `fetchedOk = 16` and 15 observed edges.

The n=9 full replay answers it. **Real prose sites keep 78–96 % of their pages gradeable:**

| site | pages | gradeable (replayed) | kept |
|---|---|---|---|
| **alynthe.com** | 9 | **0** | 0 % |
| defaultoffice.com | 15 | 15 | 100 % |
| mohammadalinijhoom.com | 60 | 57 | 95 % |
| mohammadalinijhoom.com | 61 | 58 | 95 % |
| racedays.run | 419 | 69 | **16 %** |
| racedays.run | 418 | 70 | 17 % |
| rewardguru.in | 90 | 73 | 81 % |
| rewardguru.in | 91 | 74 | 81 % |
| recurpay.com | 182 | 175 | 96 % |

**The gate does not over-exclude. The `gradeable = 1` collapse is a property of the FIXTURES**, which
serve minimal HTML — anchors without prose — meeting a gate that correctly requires roughly two
sentences. `alynthe.com` is the one real collapse and it is a genuine D6 site that already refuses on
zero observed edges.

Stated plainly because the opposite conclusion was the tempting one: this is a finding about the test
fixtures, not about the floor or the gate feeding it.

## 5. Why the floor is defensible — insensitive, not tuned

Distribution of gradeable pages across the corpus (proxy basis):

| gradeable | 0 | 1 | 2 | 3 | 4 | 5–10 | >10 |
|---|---|---|---|---|---|---|---|
| audits | 4 | **28** | 3 | 2 | 3 | 23 | 149 |

Sensitivity of the full gate to the floor:

| floor | refused on the floor alone | full gate (floor ∪ nothing-read ∪ zero-edges) |
|---|---|---|
| 3 | 35 | 46 |
| **5** | **40** | **51** |
| 8 | 49 | 60 |

The distribution is **bimodal**: 28 audits sit at exactly one gradeable page, then it falls off a
cliff. **32 of the 40 audits refused at floor 5 have ≤ 1 page of evidence**, so every floor in the
plausible range catches substantially the same population.

**`MIN_GRADEABLE_PAGES = 5` is therefore an INSENSITIVE choice, which is a stronger claim than a tuned
one.** "We picked 5" invites an argument about 4 or 6; "every floor between 3 and 8 gives the same
answer" ends it. The rationale and the table now live in the constant's comment, so the next person to
question the value finds the evidence rather than the number.

## 6. Carried forward

**5.1b calibration panel — `racedays.run`.** 419 pages crawled, **69 gradeable (16 %)**. This is the M9
population split working correctly on a listings site whose pages are genuinely thin, and it is also
the most dangerous shape in the corpus: **a large legitimate site graded on a small fraction of itself
while page-count coverage looks healthy.** It is the case most likely to expose either a mis-set floor
or a coverage claim that reads better than it is. Add it to the panel explicitly.

**Stage 6 acceptance item — the live sample.** Both numbers above are lower bounds and only a live
re-run can tighten them. Ruled to run **after** the surface work, not before: a live rate can only move
*up*, and the floor is provably insensitive across the whole plausible range, so nothing about the copy
or the gate changes on the result. **Run ~15 sites across the size strata during Stage 6 close-out,
alongside the live smoke** — one round of live crawling, two purposes. Recorded here so it cannot be
lost between stages.

## 7. Reproduce

Every figure came from direct SQL against the live database on 2026-08-04; none is sampled or inferred.
The replay applies `status_code = 200 AND NOT excluded_from_grade` and, where `ai_signals` carries it,
`(ai_signals->>'mainTextChars')::int >= MIN_GRADEABLE_TEXT_CHARS`.
