# SPEC 5.1a — acceptance sweep, §15 criteria

Captured 2026-08-06 at Stage 6 close-out. Every row states what was actually run. Anything not met is
stated as not met.

## Two corrections to the criteria list itself

**There is no A-series.** §15 of the spec is **B1–B17**; "A1–B17" is shorthand that has been carried in
the handoff. There is a separate **I1–I6** invariants table (§11), which B14 refers to. This sweep
covers B1–B17 and reports on I1–I6 where B14 needs them.

**Three criteria are not 5.1a's to meet.** §14 splits the spec across two terminals, and places §9
(honest scoring), §10 (calibration) and §11 (invariants as property tests) in **Terminal 5.1b, a fresh
terminal after 5.1a merges.** So B14 (I1–I6 mutation-verified) and B15 (the before/after calibration
panel) belong to 5.1b by the spec's own plan. They are marked accordingly rather than reported as
5.1a failures — and rather than quietly counted as passes.

*(Note an internal inconsistency in the spec worth flagging to whoever picks up 5.1b: the §9/§10/§11
headers read "Stage 6 / Stage 7 / Stage 8" while §14's plan calls the same sections Stages 7/8/9. The
terminal assignment is unambiguous either way; the stage numbers are not.)*

---

## The sweep

| # | Criterion | Status | Evidence |
|---|---|---|---|
| **B1** | Robots on all paths | **MET** | `robots.ts` is one shared gate; sitemap-seed, redirect-target and rel=canonical-target all consult `isUrlAllowed`. `robots.test.ts`; redirect path pinned in `crawler.ts`'s `makeRedirectHook` (throws `RobotsRefusedRedirectError`, marked non-retryable). §4.1 entry paths 3 and 4 both covered. |
| **B2** | Origin | **MET** | `ssrf-guard.test.ts` (private/reserved ranges, redirect revalidation, DNS-pinned lookup); `www.` equivalence via `sameHostIgnoringWww` in `extract.ts`, `unifyHost` in canonicalisation. Untouched this stage. |
| **B3** | Canonicalisation | **MET** | `url-canonical.test.ts` + `crawl-integrity.test.ts`. Effect on counts measured and reported in `evidence/2026-08-03-stage1-crawl-integrity.md`. |
| **B4** | Classification | **MET** | `analysis/classify-pages.test.ts`, `analysis/page-kind.test.ts`. Grade delta reported in `evidence/2026-08-03-stage2-classification.md`. |
| **B5** | SimHash | **MET** | `analysis/simhash.test.ts` — deterministic given a fixed tokenizer/hash, k=3 collapsing pinned. |
| **B6** | Frontier determinism | **MET** | `reproducibility.test.ts` — "produces an identical grade across two runs", "grade is within ±2 across caps when the site fits". `analysis/frontier.test.ts` + `analysis/arrival-order-determinism.test.ts` pin selection as a pure function of the discovered set. The strongest evidence is `crawl-frontier-batch-bounding.test.ts`, which asserts BOTH digest equality AND the banked page set across two real crawls — the assertion pair gate 1's lesson demands. |
| **B7** | Stratification | **MET** | `analysis/frontier.test.ts` — per-template quota, every stratum served before any gets a second slot, uncapped phase-2 redistribution (found by the B7 budget test, not by reasoning). |
| **B8** | E1 replay | **MET** | `analysis/frontier.test.ts` uses a `duskrouteShaped()` fixture — one enormous template plus small ones, the E1 shape — and asserts the quota bounds it. `crawl-frontier-budget.test.ts` covers the budget interaction. |
| **B9** | Coverage | **MET** | `coverage.test.ts` — `fetched` / `gradeable` / `estimatedTotal` distinguished with provenance; `coverageRatio` null when unknowable rather than 1.0; exclusions tallied by `PageKind`. |
| **B10** | Sitemap orphans | **NOT 5.1a's — D4 CUT, moved to 5.1b by owner ruling** | **This row read MET twice and was wrong both times**, which is why it is now out of 5.1a rather than fixed again. `sitemapUnreached` was differenced against `GraphAnalysis.depths`, and `buildGraph` drops edges to unfetched targets, so the published count was a function of our page cap. Gate 4 measured 36 / 31 / 0 across caps 5 / 10 / 41 on a complete-mesh fixture; gate 5 measured **400 / 400 / 400 / 230 / 0 across caps 5 / 10 / 25 / 60 / 441** on a zero-orphan hub-and-leaf site whose every leaf is two clicks from the homepage, and **400 of 601 at the real `FREE_PAGE_CAP = 500`** on an ordinary paginated blog. Critical severity, leading the findings, on **graded** audits. **Both acceptance fixtures were vacuous in the same shape** — first leaves with no inbound link at any cap, then a complete graph where one hop trivially reaches everything — so each certified the rule on the one input class where it could not fail. Owner ruling 2026-08-07: a finding derived from our own page cap is a claim about the customer's site manufactured from our budget, so it does not ship. **Cut in `9a73197`.** 5.1b inherits the feature **with its design constraint: a sitemap-orphan claim must be budget-independent or refused**, and its acceptance fixture must be a paginated hub, not a complete graph. Full diagnosis, both reviewers' fixtures and both candidate designs: `evidence/2026-08-07-d4-cut-and-b5-1-diagnosis.md`. |
| **B11** | Checkpoint | **NOT MET — moved to SPEC 06** | Stage 5's wiring was built, gated, found defective and **cut from 5.1a on measured evidence: zero of 234 production audits would have resumed rather than restarted.** The checkpoint deletes its recovery data (`deleteAll`) immediately before the most common real failure point (`persistAuditResults`), so the one failure class it exists to serve is the one where the frontier is guaranteed empty. The wiring also shipped with B-1 — a resumed crawl discarded every page the dead attempt fetched while the fingerprint certified the sample identical (measured B+/80 → refusal, 5 of 85 pages). Full record, ruled fix and everything SPEC 06 inherits: `evidence/2026-08-06-spec06-frontier-carry-forward.md`. |
| **B12** | Refusal | **MET** | `refusal.test.ts` (the gate), `refusal-surfaces.test.ts` (26 tests covering surfaces 3-8, 10-12, byte-level at the serialization boundary; surfaces 1, 2 and 13 are pinned in `mint-snapshot.test.ts`, `og-report-model.test.ts` and `dashboard.test.ts` respectively — surfaces 1, 2 and 13 are covered elsewhere as listed; **surface 9 — the result page — had NO refusal test at all until this stage**, which is where two live defects were found), and new this stage: `refusal-gate-import-graph-guard.test.ts`, which derives the surface set from the import graph so a fourteenth surface is covered on the day it is imported. |
| **B13** | Headline | **PARTIAL — stated as such** | `refusal-copy.test.ts` and `grade-absence-of-evidence.test.ts` cover the headline/finding relationship by **example**, including every owner-approved copy revision. The criterion says "for any finding set (**property**)", and no property-based (`fast-check`) test exists for it. `fast-check` is available and used elsewhere (`text-safety.test.ts`). **The property form is I4, which §14 places in 5.1b.** |
| **B14** | Invariants I1–I6 | **NOT MET — 5.1b** | §14 places §11 (invariants as property tests) in Terminal 5.1b. Current state: **I1** is covered by B6's determinism tests; **I5** by B12's surface tests; **I6** by `analysis/template-key.test.ts`. **I2 (orphan monotonicity), I3 (coverage non-inflation — explicitly "the E1 property"), and I4 (copy–findings consistency)** have **no property test**, and I confirmed the only `monotonic` match in the suite is about `pagesFetched` progress, not orphans. Not mutation-verified as a set. |
| **B15** | Panel | **NOT MET — 5.1b** | The before/after calibration panel is §10, Terminal 5.1b. The backtest harness itself is ready and was substantially reworked this spec (`scripts/backtest-runner.ts`: refusal is a panel outcome, four transitions, `graded→refused` enumerated as the headline). Prior panels exist in `evidence/`, but the 5.1 before/after panel across panel **and** corpus has not been produced. |
| **B16** | Security | **MET** | Verified live via MCP: `frontier` and `frontier_politeness` have RLS **on**, **0 policies**, grants to `postgres`/`service_role` only. No policy was created, changed or widened by any migration in this branch. All four SQL functions are `SECURITY INVOKER`, `search_path` pinned, `EXECUTE` false for anon/authenticated and true for service_role, ACL with no PUBLIC entry — read from `pg_proc`, not from the migration text. `ssrf-guard.ts` and `safe-fetch.ts` untouched (empty diff). Gate 4's three reviewers scored security 9/8/9 with no security blocker; gates 5 and 6 scored security 8/8/8 and 8/7/8, each time for guard evasions rather than live posture, which was verified correct from `pg_proc` at every gate. The live posture has never moved. |
| **B17** | Live smoke | **NOT MET — deferred to a post-merge production smoke** | The smoke cannot run before merge: production runs `main@69b039f`, and a preview deployment cannot substitute because preview apps never sync to Inngest — `audit.requested` is executed by the *production* deployment, so a preview crawl runs main's code and proves nothing. SPEC 05 hit the same wall and recorded the same thing (PR #21). §14 agrees: *"Post-merge: confirm the Vercel production deployment reaches READY and run a production smoke."* Closing condition: the post-merge smoke plus the ~15-site live sample. |

---

## Summary

**MET: 11 of 17** (B1–B12 excluding B10 and B11, plus B16).
**PARTIAL: 1** (B13 — example-based, not property-based; the property form is I4, scheduled 5.1b).
**NOT 5.1a's: 5** — **B10** (D4 **CUT** on 2026-08-07 by owner ruling, moved to 5.1b with its design
constraint), B11 (**cut to SPEC 06 on measured evidence**), B14 and B15 (both 5.1b by §14's terminal
split), B17 (deferred to the post-merge production smoke).

**B10 is counted as a REMOVAL, not a pass and not a failure.** It read MET twice on two different
vacuous fixtures. Recording it as "met" a third time would have been the fifth instance of this
branch's signature defect — a number quoted from a different number — inside the document whose
closing line forbids exactly that.

No criterion is reported met on the strength of a stub. Where the evidence is example-based rather
than property-based (B13), that is said rather than rounded up.

## The supabase-js coverage boundary — no longer load-bearing, but recorded

With Stage 5 cut, **no branch code calls PostgREST for the frontier at all** — the store adapter is
deleted and the four SQL functions are applied but uncalled. The boundary that mattered while the
checkpoint was wired is therefore no longer a live gap for 5.1a; it returns as a real constraint for
SPEC 06, and is recorded in the carry-forward document.

What remains true for 5.1a: B17's post-merge smoke is the only thing that exercises the **deployed**
worker end to end. Stated as a limit, not as a risk that has been mitigated.
