# FALSE REFUSAL — kind-based exclusion collapses the gradeable population and fires "too small to measure"

**Filed:** 2026-08-08 · **Source:** B17 post-merge live sample on the deployed function
**Severity:** HIGH — user-visible false verdict with a false stated cause, on the core market
**Status:** open — **owner decision required** (revert / hotfix / accept)

## The defect

A healthy site is told **"your site is too small for an internal-linking grade"** when it is not small.

Measured on production, 2026-08-08, deployment `dpl_AUzxC1uMaJQ6JG8ijTkFP4n9iTk7`:

**`quotes.toscrape.com`** — 214 pages fetched, **3,978 internal links**, every page HTTP 200, every page
`excluded_from_grade = false` in `pages`, **213 of 214 with ≥ 80 chars of main text (mean 876)**.

**Verdict: REFUSED, trigger `site_too_small_to_measure`.**

```json
coverage.excluded = [{"kind":"pagination","count":152},{"kind":"archive","count":60},{"kind":"auth","count":1}]
coverage.gradeable = 1        // < MIN_GRADEABLE_PAGES (5)  ->  small-site refusal
```

The excluded pages are ordinary content:

```
/tag/love/page/1                        3333 chars
/author/James-Baldwin                   2053 chars
/tag/connection/page/1                   351 chars
/tag/misattributed-john-lennon/page/1    295 chars
```

## Why it is HIGH

- **The stated cause is false.** The refusal copy names a reason the evidence contradicts. Asserting a
  false cause on the primary result screen is the exact defect SPEC 5.1a was written to delete — it is
  gate 3's blocker reached through the coverage accounting instead of the render path.
- **It targets the core market.** `/tag/…`, `/page/N`, `/author/…`, `/category/…` is the default URL
  structure of WordPress, Ghost and most blogs, which `PROJECT_OVERVIEW` §1 names as the primary
  audience.
- **It is the ORPHAN-UNDER-CAP family.** That ticket records our page cap manufacturing orphans; this is
  our classifier manufacturing a refusal. Both report on a population we cut ourselves as though the
  site produced it.

Also observed: `randomcircles.com` — 5 pages, 52 links, `gradeable: 1` → same refusal. Previously B−/71.

## Root cause, precisely

`classifyPages` assigns a `PageKind` from URL shape; kinds `pagination` / `archive` (among others) are
excluded from the §5 M9 graded population. `decideRefusal` then reads `gradeablePageCount` and fires
`site_too_small_to_measure` when it is below `MIN_GRADEABLE_PAGES`.

Excluding archives from *grading* is defensible — they are index pages, not destinations. **Letting that
exclusion drive the "is this site big enough to measure" question is not.** The floor is asking about
the site; the classifier is answering about the sample.

## Candidate fixes, none applied

1. **Separate the two populations.** Grade over `gradeable`, but evaluate the size floor over the
   *fetched* (or fetched-minus-error) population. One-line intent change, and it makes the floor answer
   the question it is actually asking. **Recommended starting point.**
2. **Exclude kind-excluded pages from grading but not from the floor**, i.e. count them toward
   `MIN_GRADEABLE_PAGES` while keeping them out of the components.
3. **Make the trigger honest instead.** If the population really is 1, do not say "too small" — say the
   evidence was excluded, and name the kinds. Weaker: it keeps a refusal that arguably should not fire.

Whichever is chosen, **the acceptance test must be a real tag/paginated site** — `quotes.toscrape.com`
is stable, public and reproduces it in 22 s.

## The measurement this also invalidates

`docs/OPERATING-RULES.md` §5's sign-off records **51 of 215 (23.7%)** on the basis
`status_code = 200 ∧ NOT excluded_from_grade`. **That proxy does not model kind-based exclusion.**
`quotes.toscrape.com` passes the proxy at 214 and survives the engine at 1.

`evidence/2026-08-04-stage4-floor-calibration.md` already said the figure was a **lower bound** — *"Applying
the missing exclusions can only move audits into refusal, never out."* §5 carried the number without
that qualifier. Observed on the (deliberately refusal-weighted, therefore non-representative) live
sample: **7 of 13 refused**.

§5 should be corrected to state the bound, and a representative re-measurement scheduled.

## Related

- `evidence/2026-08-08-post-merge-b17-live-sample.md` — the full sample and the measurements above.
- `docs/tickets/2026-08-07-orphan-under-cap.md` — same family, grade instead of refusal.
- `docs/deploy/spec51a-stage4-migration-runbook.md` §5 — rollback, if that is the chosen path. Note
  remedy C is one-way without the `expires_at` snapshot.
