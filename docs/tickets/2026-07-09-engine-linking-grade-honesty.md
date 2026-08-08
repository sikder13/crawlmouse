# Engine ticket — the linking grade reads dishonestly on heavily-orphaned & JS-rendered sites

**Status:** OPEN · logged 2026-07-09 · **scope AFTER SPEC 05 locks** · standalone engine ticket
**Do NOT** fix in `ai/spec-05-readiness`, and do NOT absorb into the SPEC 05 spec — SPEC 05 keeps the A–F
grade byte-identical (non-regression contract §13.1). This is about the **linking grade's own honesty**.

## Symptoms

1. **JS-rendered sites over-credited.** `alynthe.com` scores **A-/88 with "0 orphans"** even though its
   pages are effectively JS-only / unreachable to a non-rendering crawler — a static/AI crawler following
   links from the homepage can't reach them. The grade rewards a site whose content a non-JS crawler can't
   actually traverse.
2. **Heavily-orphaned sites read dishonestly.** `mohammadalinijhoom.com` grades **B-/74 with "Strong
   internal linking — keep it up"** while **~47% of the site is orphaned (130 of 277 pages)**. The grade
   reads clean/strong even though nearly half the pages have no inbound internal links.

## Why this is separate from SPEC 05 (and evidence the honesty design already works)

SPEC 05's **AI/agent-readiness** score is the counter-signal, and it functions correctly: the same
`alynthe.com` scores **40 / at_risk** on AI-readiness. **The two scores disagreeing loudly IS the intended
honesty design** — the AI-readiness score exposes exactly the reachability/JS-blindness the linking grade
currently glosses over. So SPEC 05 needs no change here; the linking grade does.

## Where it lives

Next to the **`jsOnly` reachability signal** SPEC 05 already reasons about — the site-level JS/SPA detector +
its orphan suppression (`packages/engine/src/analysis/js-detect.ts`), the reachability/`jsOnly` derivation in
graph assembly, and the orphan/depth/coverage inputs to `grade.ts`. Any fix must respect the same
non-regression guards (four components/weights, A–F scale, coverage floor) and re-run the backtest.

## Repro

- `https://alynthe.com` — A-/88, "0 orphans", JS-only/unreachable nodes (linking) vs 40/at_risk (AI-readiness).
- `https://mohammadalinijhoom.com` — B-/74, "Strong internal linking — keep it up", while ~47% orphaned
  (130 of 277 pages).

## Disposition

Scoped **after** SPEC 05 locks; owned by the engine, not SPEC 05. Logged per owner ruling 2026-07-09.

---

# Addendum — 2026-08-03, SPEC 5.1a Stage 0

**Why this addendum exists.** SPEC 5.1 (`docs/specs/05_1-engine-honesty-spec.md` §1) cites *this ticket* as
the source for evidence items E1, E2, E4, E5, E6, E7 and E9 — but the ticket above records only the
`alynthe.com` / `mohammadalinijhoom.com` symptoms, and it lived only on the `engine/grade-honesty-ticket`
branch, never on `main`. Stage 0 re-derived the numbers directly from the production database rather than
carrying the citation forward on trust. **The corrections are kept visible rather than folded in**: the
filed figures are shown beside the measured ones, because the discrepancies are themselves informative.

Measured against Supabase `ezspnfeyzwsisymytssm` on **2026-08-03**, `audits WHERE status='completed'`.

## A1 — duskroute.com (SPEC 5.1 E1): confirmed, and larger than filed

**Ten** runs (SPEC 5.1 says nine), **every one at `page_count = 500`**:

| day | pages | score | grade | coverage | discovered | `crawl_estimated_total` |
|---|---|---|---|---|---|---|
| 2026-07-19 | 500 | 32.88 | **F** | 32.4 % | 1 545 | 1 745 |
| 2026-07-20 | 500 | 46.40 | D | 28.9 % | 1 731 | 1 765 |
| 2026-07-21 | 500 | 61.20 | C | 19.8 % | 2 526 | 1 847 |
| 2026-07-21 | 500 | 61.20 | C | 16.8 % | 2 979 | 1 847 |
| 2026-07-22 | 500 | 61.28 | C | 16.8 % | 2 978 | 1 851 |
| 2026-07-22 | 500 | 61.28 | C | 16.8 % | 2 978 | 1 851 |
| **2026-07-22** | 500 | **88.89** | **A−** | 18.2 % | 2 744 | 1 851 |
| 2026-07-23 | 500 | 62.96 | C | **6.7 %** | 7 342 | **7 735** |
| 2026-07-26 | 500 | 69.99 | C+ | 20.2 % | 2 471 | 2 924 |
| 2026-07-29 | 500 | 77.69 | B | 8.7 % | 5 740 | 4 242 |

- **Swing 56.01 points, six letters (F → A−), all at an identical page count.** Confirmed as filed.
- `crawl_estimated_total` **1 745 → 7 735**. Confirmed exactly as filed.
- **Correction to SPEC 5.1's framing.** The spec preamble says "the A− came from the run with the *lowest*
  coverage (18.2 %)". 18.2 % is **not** the lowest — 6.7 % (C/62.96) and 8.7 % (B/77.69) are lower. The
  accurate statement is stronger: **the grade is not monotonic in coverage in either direction.** 32.88 at
  32.4 % coverage, 88.89 at 18.2 %, 62.96 at 6.7 %. Sample size explains none of it.
- **The sharpest single fact, not previously recorded:** **2026-07-22 produced both 61.28/C and 88.89/A−**
  — same site, same day, 500 pages both, a 27.6-point / four-letter gap. Same-day recurrence removes site
  drift as a plausible explanation for that pair, which is precisely the distinction SPEC 5.1 §6.7's
  fingerprint exists to make routinely instead of anecdotally.
- Also visible: the two 2026-07-21 runs score **identically (61.20)** from **different discovered sets**
  (2 526 vs 2 979). Equal grades therefore do **not** imply equal crawl composition — a reminder that grade
  equality is a weak reproducibility signal, which is the E3 lesson in a second form.

## A2 — mohammadalinijhoom.com (E2): confirmed

73.92/B− at 277 pages → 62.87/C at 71 pages, as filed. Two further runs since: 63.58/C at 61 pages
(2026-07-31) and 62.67/C at 60 pages (2026-08-03). Neither recent run hit its page cap.

## A3 — racedays.run (E3): confirmed

419 pages / 80.32 twice, then 418 / 80.60 — matching
`evidence/2026-07-31-racedays-reproducibility-control-retired.md`.

## A4 — population statistics (E4): proportions hold, absolute counts have grown

| metric | filed in SPEC 5.1 | measured 2026-08-03 |
|---|---|---|
| completed audits | — | 209 |
| partial crawls | 60 % | **129 (61.7 %)** |
| low confidence | 45 % | **95 (45.5 %)** |
| reassuring grade (A/A−/B+/B) *while* low-confidence | 19 | **24** |
| grade produced from a single crawled page | 21 | **29** |

The proportions are stable; the absolute counts are **worse** than when filed, because the population keeps
growing and nothing has been fixed.

## A5 — evidence with no locatable source

E5 (justinjackson.ca tweet permalinks, `/cp/auth/login` recommended as an orphan fix, the
`"RT @mattpocockuk: 🦋"` action packet), E6 (headline/finding contradictions), E7 (the profane title in a
white-labelable report; +0.0-point fixes in the *prioritised* list) and E9 (magazine.atavist.com, 550 of
~878 pages) are **not recorded here and not found anywhere in the repository.** They are carried as
**owner-attested** per the 2026-08-03 ruling. E5 in particular is a SPEC 5.1 acceptance criterion (B4), so
its URLs are pinned as fixtures from the spec text rather than from a measured source.

## A6 — E8 (sitemap seeds bypass robots): verified in code, not re-measured

`docs/tickets/2026-07-31-sitemap-seeds-bypass-robots-disallow.md`, code anchors re-verified against
`main` at `69b039f`: the robots predicate is `packages/engine/src/crawler.ts:277-285`, applied **only** at
`:469`; sitemap seeds are assembled at `packages/engine/src/audit.ts:207-240` and reach the crawler at
`:246` with no robots check; the same-origin prefix test is `audit.ts:221`.
