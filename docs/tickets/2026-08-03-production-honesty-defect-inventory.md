# Production honesty defect inventory — systematic sweep of the live corpus

**Recorded:** 2026-08-03 · corpus: 212 completed audits, 40 927 page rows, Supabase `ezspnfeyzwsisymytssm`
**Why this exists:** four honesty defects were found by an owner running two live audits. None was in
SPEC 5.1. That means the spec was built on *reported* evidence rather than a systematic sweep, so the
corpus was interrogated directly before any more code was written.

**Headline: 64 of 212 completed audits (30.2 %) would change verdict under honest rules.**
**Seven defect classes were found that SPEC 5.1 does not cover, two of them more severe than anything
currently in §7.**

---

## Severity summary

| # | Defect | Rows | In SPEC 5.1? | Severity |
|---|---|---|---|---|
| **D6** | **Grading a site with ZERO observed internal links** | **34 (16 %)** | **No** | **CRITICAL** |
| **D5** | **Grading a site where ZERO fetches succeeded** | **4** | **No** | **CRITICAL** |
| D7 | Projection that LOWERS the grade | 4 | No (§9.8 too narrow) | HIGH |
| D3 | No minimum-page floor for asserting a letter | 39 (18 %) | 5.1b §9.2 — owner pulled forward | HIGH |
| D1 | `confidence: high` with no coverage estimate | 22 (10 %) | No | HIGH |
| D8 | Projection immaterial (same band / < 1 pt) | 56 (34 % of projections) | No (§9.8 too narrow) | MEDIUM |
| D9 | The 60.00 clamp means three different things | 42 (20 %) | No | MEDIUM |
| D10 | `confidence: high` on a crawl known to be partial | 13 | Partly (§9.1) | MEDIUM |
| D2 | Circular estimation (estimate derived from the crawl) | 9 | No | MEDIUM |
| D4 | Sitemap-delta counted, never surfaced as a finding | — | §7.2 (as a count, not a finding) | MEDIUM |
| D11 | Headline contradicts findings | 6 (2 over 20 %) | Yes — E6 / §9.4 | MEDIUM |

---

## D6 — CRITICAL: we grade internal linking on sites where we observed no internal links

**34 of 212 audits (16 %) have `link_count = 0`. Of those, 30 carry `confidence: high` and 10 receive
A/A−/B+/B.**

The `88.00` cluster in the score histogram is entirely this defect. Eight audits sit at *exactly*
88.00 — `alynthe.com` (×4), `catchscroll.com`, `hopsquad.gg`, `chappie.app`, `orbitbudget.com` — every
one with `link_count = 0`, `confidence: high`, and **exactly one finding: the JS banner.**

### The mechanism, and why 88.00 is not a coincidence

With no edges in the graph, three of the four grade components score **full marks precisely because
there is nothing to measure**:

| component | weight | value | why |
|---|---|---|---|
| orphan ratio | 40 | **1.00** | A4 JS-suppression forces `orphanRatio` to 0 |
| depth | 20 | **1.00** | every node is a raw orphan, so none is counted "unreachable" |
| anchor diversity | 20 | **1.00** | no edges ⇒ empty HHI map ⇒ mean 0 ⇒ full marks |
| structure | 20 | 0.40 | `0.6 × 0 + 0.4 × 1` — the lone hub is the homepage, at depth 0 |

`40 + 20 + 20 + 8 = 88.00` exactly. **The score is high *because* the evidence is absent.**

### The sharpest statement of it

`rewardguru.in` — 76 pages, 0 links, JS detector did **not** fire → orphans not suppressed → 75 orphan
findings → **D−/42.53**.
`provion.io` — 79 pages, 0 links, JS detector **did** fire → orphans suppressed → **B+/82.00, high
confidence.**

The same underlying reality — a site whose internal links we cannot see — yields **A−/88 or D−/42
depending only on whether a heuristic fired.** That is a 45-point swing on a detector, not on the site.

**Not covered by SPEC 5.1.** §5 and §7 concern which *pages* enter the population; nothing addresses a
graph with no *edges*. A4's orphan suppression was correct for its purpose (don't manufacture false
orphans on a JS site) but it was never paired with a refusal, so suppression became endorsement.

## D5 — CRITICAL: we grade sites where every fetch failed

**4 audits have `fetched_ok_count = 0` and still produced C/60.00.**

- `leetcode.com` — 50 pages attempted, **50 blocked**, 0 OK → C/60.00
- `swarovski.com`, `spplus.com.au`, `reflectoes.com` — 1 page, blocked → C/60.00

We read nothing and printed a letter. **Not covered by SPEC 5.1.**

## D7 — HIGH: the fix list makes the grade worse

**4 audits have `projected_score < score`** — the "here is what you could be" number is *below* the
current one:

| site | current | projected | delta |
|---|---|---|---|
| eyondo.com | A−/88.29 | **B+/80.33** | **−7.96** |
| duskroute.com | B/77.69 | **B−/71.59** | **−6.10** |
| crawlmouse.com | B+/80.13 | B/79.34 | −0.79 |
| fellowaidenprofiler.com | D−/41.33 | D−/41.09 | −0.24 |

Two of them cross a band *downward*. §9.8 covers "you're an A — you could be an A" (a null
improvement); it does not cover a **negative** one, which is worse: the product recommends work that
its own model says would hurt.

## D8 — MEDIUM: a third of all projections promise nothing

Of 167 audits with a projection: **56 (33.5 %) project the same band**, **47 (28 %) have total gain
< 1 point**, **42 (25 %) are both**. This is the owner's PlayStation observation (+0.68 across all 9
fixes), quantified — it is a third of the corpus, not an edge case.

## D9 — MEDIUM: 60.00 means three different things

**42 audits (20 %) sit at exactly 60.00** and the user cannot tell which cause applies:

1. **Thin crawl** — `page_count < 5`, the `LOW_CONFIDENCE_SCORE_CAP` (38 rows).
2. **Legacy low-confidence cap** — 4 substantial crawls capped by the pre-SPEC-02 rule:
   `nodejs.org` (200 pages, 15.6 % coverage), `nextjs.org` (150), `drupal.org` (22), `leetcode.com` (50).
3. **Zero successful fetches** — D5 above, also landing on 60.00.

One displayed number, three unrelated meanings, none of them explained on the surface.

## D1 / D2 / D3 / D10 — confidence asserted beyond the evidence

- **D1** — 22 audits are `confidence: high` with `crawl_estimated_total` NULL. Unknown coverage is
  being treated as *good* coverage.
- **D2** — 9 audits have `crawl_estimated_total = page_count` at `page_count ≤ 3` (29 at any size):
  crawl one page, estimate the site is one page, compute 100 % coverage, declare high confidence.
- **D3** — 39 audits (18 %) graded from fewer than 5 pages; **29 from a single page**.
- **D10** — 13 audits are `confidence: high` **and** `partial: true`; 27 have high or medium confidence
  at fewer than 5 pages. `partial` means we know we did not finish.

## D11 — headline contradicts findings (already E6 / §9.4)

6 audits with A/A−/B+/B and > 10 % orphans; 2 over 20 %. `physiohub.pro` B/75.17 at **35.7 % orphans**;
`www.mroads.com` B/75.16 at 23.2 % **with high confidence**. Lower row count than the other classes,
and already specified — recorded for completeness.

---

## What this changes about Stage 4

**Recommendation: re-scope Stage 4 from "Coverage accounting & orphan triangulation" to "Coverage
accounting and REFUSAL conditions".**

The reason is that D5 and D6 are not coverage-accounting problems. §7 as written makes the *counts*
honest — `fetched` / `gradeable` / `estimatedTotal` distinguished, exclusions surfaced. That is
necessary and it does nothing for a site where we fetched nothing, or saw no edges: those need the
product to **decline to assert a letter**, which is the D3 mechanism the owner has already pulled
forward from 5.1b §9.2.

So the economical move is to build **one refusal gate with four triggers**, rather than a page-count
floor now and three more mechanisms later:

| trigger | condition | rows |
|---|---|---|
| too few pages | `gradeable < MIN_GRADEABLE_PAGES` | 39 |
| nothing read | `fetchedOk == 0` | 4 |
| **nothing observed to grade** | **zero edges among gradeable pages** | **34** |
| coverage unknowable | `estimateSource = 'none'` ⇒ `coverageRatio = null` ⇒ confidence cannot be high | 22 |

The calibrated coverage-*ratio* threshold stays in 5.1b with the panel, as ruled. These four are all
categorical — no calibration needed, no panel required, and each is a fact about the evidence rather
than a judgement about the site.

D4 (sitemap-delta as a leading finding) fits naturally alongside, since it is the same question asked
of a different signal: *we hold evidence that contradicts the letter we are about to print.*

D7 and D8 are projection defects. They belong with §9.8 in 5.1b, but §9.8 must be widened from "null
improvement" to "immaterial **or negative** improvement" — recorded here so the scope change is not
lost.

## Method

Every number is from a direct query against the live database on 2026-08-03; no figure is inferred
from sampling. Queries are reproducible from this document's structure. The mechanism for D6 was
confirmed by cross-referencing `findings` (the `js_rendered` flag, orphan counts and total finding
counts per audit), not by reading the code and assuming the data matched.
