# Crawlmouse — SPEC 5.1a handoff

**Rewritten 2026-08-04 for someone with zero context.** Read top to bottom before touching anything.
It should be enough to resume without archaeology.

Orientation if you have read nothing else: **`docs/OPERATING-RULES.md`** (the tracked operating law —
read it and follow it), **`PROJECT_OVERVIEW.md`**, **`docs/specs/00-crawlmouse-master-build-plan.md`**,
then **`docs/specs/05_1-engine-honesty-spec.md`** (the active spec).

---

## 1. Where the work is, and the RED STATE

| | |
|---|---|
| Branch | `engine/spec-5-1a` |
| Worktree | `/home/udsik/nahl-clients-projects/crawlmouse-51a` |
| HEAD | `9be9648` (before this handoff commit) |
| Base | `origin/main` = `69b039f` |
| Commits ahead | **54** |
| **Pushed?** | **NO. Nothing pushed, no PR, no merge.** |
| Working tree | clean except untracked `CLAUDE.md` (deliberate — §9) |
| Helper worktree | `../crawlmouse-base`, detached at `69b039f`, the backtest's base engine. **Keep it.** |

**Green:** typecheck, lint, `next build`, engine **786 tests / 63 files**, web 1318, inngest 136.

### ⚠ THE BRANCH IS RED: 2 tests in `scripts/`

`scripts/backtest-runner.test.ts` — *"THE FIX: the base-vs-head axis…"* and *"reports identical
composition…"* — both fail with `expected 'refused: no verdict asserted' to be null`.

**They fail because of a `throw` in `scripts/backtest-runner.ts` that must be REPLACED, not satisfied.**
Do **not** green these by keeping the throw and updating the tests to expect an excluded row. That
throw was invented mid-session, never ruled, and it is wrong: it turns a refusal into a harness *error*
and drops the row, hiding the most valuable output the panel produces.

**The fix is §3. Delete the throw as part of it.**

---

## 2. THE INVERTED CONTRACT — read before judging any result

Every prior spec held grades byte-identical. **SPEC 5.1 deliberately changes grades. That is its
purpose.** A grade change is not a regression. The gate is **attribution, not identity**: name the
stage and the mechanism for each movement. `Δ = 0` is not a pass; an *unexplained* Δ is the only fail.

Do not tune a constant to shrink a delta. A delta you dislike is a finding.

---

## 3. NEXT TASK — harness option (a): refusal as a first-class panel outcome

**Owner-ruled 2026-08-04. Build this first; it greens the branch.**

### Why it matters — do not skip this

**10 of the 51 refused audits currently show A / A− / B+ / B.** The row **`base B+ → head REFUSED`** is
the single most valuable output the panel can produce, and it is exactly what the owner signs off in
5.1b. A harness that excludes those rows hides the deliverable. Coercing a refusal to `0` is worse:
**0 renders as F, and "we declined to assert" must never read as "we judged you badly."**

### Specification

- **Nullable score** in the diff row.
- **An explicit `REFUSED` outcome carrying the trigger list** — not an error, not a bare null.
- **Four transitions handled distinctly:**
  1. `graded → graded` — numeric delta, as today;
  2. **`graded → refused` — THE HEADLINE CASE. Surface it prominently, never as a null row buried among
     deltas;**
  3. `refused → graded`;
  4. `refused → refused`.
- **Summary counts report refusals SEPARATELY from deltas.** A panel reporting "mean Δ −2.1" while
  silently dropping 51 refusals is the same class of dishonesty this spec exists to remove.
- **Two mutations required, both must fail a named test:**
  1. coercing a refusal to a score;
  2. dropping refused rows from the summary.

Then green the 2 scripts tests against the new outcome, and run the full verification order (§9).

---

## 4. THEN — the 13 surface proofs

**The standard: byte-level proof at the SERIALIZATION boundary. The payload must not carry a letter or
a score. "The component doesn't render it" is NOT proof** (see `feedback_gate_security_at_serialization`).

**Why each surface needs its own test rather than a type:** making `AuditResult.score/grade` nullable
made the compiler enumerate the *persistence* boundary — it found `inngest/persist-results.ts`, the
Inngest step summary, and the `audit.completed` event schema. It could **not** enumerate the render
surfaces, because the web layer reads DB rows and never typechecks against `AuditResult`. That is the
justification for this checklist, and it is evidenced rather than assumed.

| # | surface | file(s) | proof |
|---|---|---|---|
| 1 | **minted snapshot** — FIRST: permanent + public | `apps/web/lib/mint-snapshot.ts`, `app/api/reports/mint/route.ts` | ☐ |
| 2 | **OG image** — SECOND: permanent + public | `apps/web/app/r/[slug]/opengraph-image.tsx` | ☐ |
| 3 | public report | `app/r/[slug]/page.tsx`, `components/report/sections.tsx`, `ReportLegacyFallback.tsx` | ☐ |
| 4 | white-label PDF | `app/api/reports/[slug]/white-label/route.ts` | ☐ |
| 5 | embed badge | `app/embed/[domain]/route.ts`, `lib/badge-report.ts` | ☐ |
| 6 | completed email | `lib/audit-completed-event.ts` | ☐ |
| 7 | CSV export | `app/api/audits/[id]/export/route.ts` | ☐ |
| 8 | SSE stream | `app/api/audits/[id]/stream/route.ts`, `lib/audit-stream-projection.ts` | ☐ |
| 9 | result page | `components/audit/{ResultView,GradeReveal,GradeGauge,result-logic}` | ☐ |
| 10 | share text | `components/share/{ShareSurface,share-intents}` | ☐ |
| 11 | leaderboard | `app/top/[platform]/page.tsx`, `lib/leaderboard.ts` | ☐ |
| 12 | compare | `components/share/CompareView.tsx` | ☐ |
| 13 | dashboard | `components/dashboard/{SiteCard,dashboard-logic}`, `lib/dashboard.ts` | ☐ |

**One seam already helps:** `mint-snapshot.ts` opens with `if (!audit.grade) return null`, so minting
already declines. **That is a start, not coverage** — prove it end to end with a refused audit.

---

## 5. THE APPROVED REFUSAL COPY — approved 2026-08-04, NOT YET WIRED

Wire at surface time. The owner's three revisions are already folded in.

**(a) Small site, fully crawled** — `site_too_small_to_measure`

> **Your site is too small for an internal-linking grade**
> We crawled all 4 pages — that's the whole site, not a partial read.
>
> Internal-link structure is a measurement across many pages: hubs, depth, orphans. **Below 5 pages we
> don't publish a letter** — any letter would describe four pages rather than a site.
>
> **What we did find:** *(findings)*
> **Next:** as you add pages the structure becomes measurable — re-run then.

*(The floor is stated as a NUMBER and as OUR rule. Never "about five": a hedge in the honesty gate reads
as uncertainty about our own threshold.)*

**(b) Large site, barely reached** — `too_few_gradeable_pages`

> **We didn't read enough of your site to grade it**
> We reached 3 of an estimated 821 pages.
> **Next:** *(diagnostic per trigger)*

**(c) `no_observed_links` — the finding leads**

> **We didn't find any links between the pages we graded**
> Across 79 pages, we saw no internal links connecting the pages in the graded set. **Links pointing at
> archive or tag pages don't count — those aren't the pages we grade.**
>
> Usually one of two things: your navigation renders in JavaScript (we read HTML as a non-rendering
> crawler does), or those pages genuinely aren't linked.
> **This matters beyond us:** AI crawlers and assistants read the same static HTML. What we couldn't
> see, they can't either.
> **No grade follows,** because every internal-linking measurement needs at least one internal link.

*(Precision over punch: we observed no links INTO the graded population; excluded pages may carry links.
This is the copy that proves we say only what we measured. Include the archive/tag clause only when
true.)*

**(d) freepltn shape — the finding leads**

> **820 of the 821 pages in your sitemap can't be reached by following links**
> Only your homepage is reachable by clicking. The other 820 exist in your sitemap but nothing links to
> them.
> **This is the finding, not a caveat.** We're not giving a letter because we could only reach one page
> — but the number above is the more useful answer.

**(e) `nothing_read`**

> **Your server didn't return a single page to us**
> 50 requests, 50 refused. Nothing was read, so there is nothing to grade.
> **How to check:** a blocking host usually returns 403 or 429 to non-browser traffic.
> `curl -A "CrawlmouseBot/1.0" https://yoursite.com` reproduces what we saw. If that's a WAF or bot
> rule, allow our user-agent and re-run.
> **A 403/429 to us likely means AI crawlers are blocked too** — GPTBot, ClaudeBot and the rest identify
> themselves the same way, so the same rule usually catches them.

**(f) Share / OG / badge — refusal copy, never a suppressed letter**

| surface | copy |
|---|---|
| share text | "Crawlmouse couldn't grade *example.com* — it found **no internal links** across 79 pages." **Never "I scored —".** |
| OG image | Grade slot reads **"NO GRADE"** in the muted style; subtitle carries the reason (*"No internal links observed"*). **Never a dash where a letter goes.** |
| badge | **Refuses to mint.** A badge is a claim and there is nothing to claim; the embed route returns the "not available" badge. |

**Two rules throughout:** refusal is **never styled as an F** or a failure colour, and **no next step is
ever a Pro upsell** — none of the four triggers is solved by a bigger crawl budget, so an upsell here
would be a lie.

---

## 6. Stage 4 — what is DONE

1. **The absence-of-evidence ceiling.** `NO_EVIDENCE_COMPONENT_CEILING = 0.5`, applied through **one
   helper every component passes through**, gated on edges observed **into the graded population** (not
   raw graph edges — deliberately different sets). Property test sweeps component inputs; two negative
   controls (a well-linked site still earns full marks; a genuine zero stays a measurement).
2. **`gradeInputsFrom`** — the `GraphAnalysis → GradeInputs` spread was duplicated at **three** call
   sites, and wiring two of three made the projection disagree with the grade it projects from.
   **Add new grade inputs THERE.**
3. **The refusal gate** — `packages/engine/src/refusal.ts`, pure `decideRefusal`, complete trigger list.
4. **Refusal decided at the SOURCE.** A refused audit carries no letter and no score, and
   `confidenceBand`, `projectedGrade`, `prescriptions` and `freeFix` are withheld with it — nulling
   score/grade alone was NOT enough, because the band carried the point estimate (41.42 measured beside
   a null score).
5. **The small/large split** (§7).
6. **Persistence contracts** made null-capable end to end.

### The triggers

| trigger | condition | effect |
|---|---|---|
| `site_too_small_to_measure` | gradeable < floor **AND** crawl completed | withhold letter |
| `too_few_gradeable_pages` | gradeable < floor **AND** crawl truncated (or unknown) | withhold letter |
| `nothing_read` | `fetchedOk === 0` (**null ⇒ unevaluable, never refuses**) | withhold letter |
| `no_observed_links` | zero edges into the graded population | withhold letter |
| *coverage unknowable* | `estimateSource === 'none'` | **caps confidence only** — keeps the letter |

---

## 7. The rulings behind Stage 4 — do not relitigate

**The small/large split.** Both fall below the floor and both refuse, but they are not the same
statement. Telling a legitimate 3-page brochure "we couldn't read enough of your site" is **false** — we
read all of it — and a falsehood inside the honesty gate is the worst possible place for one. The split
is categorical, on crawl-health `partial`, so it needs no threshold. **Unknown truncation takes the
insufficient-evidence branch**, because claiming a site is small on an un-instrumented crawl asserts
something we never established.

**The floor is INSENSITIVE, not tuned** — a stronger claim than "calibrated". Distribution over 212
audits:

| gradeable | 0 | 1 | 2 | 3 | 4 | 5–10 | >10 |
|---|---|---|---|---|---|---|---|
| audits | 4 | **28** | 3 | 2 | 3 | 23 | 149 |

| floor | full gate refuses |
|---|---|
| 3 | 46 |
| **5** | **51** |
| 8 | 60 |

28 audits sit at exactly one gradeable page, then a cliff. **"We picked 5" invites an argument about 4
or 6; "every floor between 3 and 8 gives the same answer" ends it.** Do not re-tune on a single site;
re-measure the distribution. The table lives in the constant's comment.

**The withdrawal standard.** 51/64 was first computed with `page_count` as a proxy for gradeable count,
withdrawn, then re-derived on the gradeable basis and came back **identical**. **That does not
retroactively justify it.** It was right by luck; the withdrawal was correct **because it was
unverified**, not because it was wrong. See `evidence/2026-08-04-stage4-floor-calibration.md`.

**The thin gate does NOT over-exclude** — measured, not argued (n=9 replay): real prose sites keep
**78–96 %** of pages gradeable. Only `alynthe.com` collapses (9 → 0) and it already refuses on zero
edges. The `gradeable=1` collapse across engine fixtures is a property of **minimal fixture HTML**, not
of the gate.

**SPEC 02 §2 is SUPERSEDED in the overlap** — amendment now in both specs, and
`docs/specs/02-conversion-core-spec.md` is tracked with its nine `CLAUDE.md` citations repointed at
`docs/OPERATING-RULES.md` (each verified to still carry the same meaning; nothing was lost in the
split). §2 removed the C/60 clamp because clamping produced a **fake letter**; Stage 4 removes the
**assertion**. Same intent, carried further. A test asserting "a degraded crawl still gets a score"
encodes §2's **mechanism**, not its **intent** — three were updated on that basis.

---

## 8. Carried forward

- **5.1b panel — `racedays.run`:** 419 pages crawled, **69 gradeable (16 %)**. Correct M9 behaviour on a
  thin listings site, and **the most dangerous shape in the corpus**: a large legitimate site graded on
  a small fraction of itself while page-count coverage looks healthy.
- **5.1b — the round-budget trade:** `FRONTIER_ROUND_BUDGET_MS` 30s → 35s restored recorded dead paths
  (0 → 4) but cost coverage (100 → 83 pages). Settle against a corpus, not one site.
- **Stage 6 acceptance item — the live refusal-rate sample:** 51/64 are **lower bounds** (the thin gate
  is unreplayable for 95 % of the corpus and can only move audits *into* refusal). Run **~15 sites
  across the size strata during Stage 6 close-out, alongside the live smoke** — one round of crawling,
  two purposes.
- **Repo-wide sweep (5.1b or later):** find other hand-synchronised derivations of a shared value. The
  `gradeInputsFrom` defect was found *by accident*; nothing was watching for it.

### Remaining after Stage 4

**Coverage accounting §7** (three counts with provenance, exclusions surfaced, `sitemapUnreached`) ·
**D4 — sitemap-delta as a LEADING finding** (`freepltn`, 1 reachable of 821, is the acceptance case) ·
**the migration** (owner-applied only, and LAST — surfaces before persistence) · **Stage 5** durable
frontier checkpoint · **Stage 6** close-out.

---

## 9. Standing rules — several learned expensively

- **TDD.** Failing tests first. **Every test must be capable of failing** — mutation-verify, and **prove
  the harness is live with an unconditional throw first.**
- **Never `git checkout --` to revert a mutation** — it has destroyed uncommitted work here. Use `cp`.
- **Verification order:** `pnpm test` → `pnpm typecheck` **after the final commit** → `pnpm lint`
  **before** `next build` → `next build`.
- **Never squash. Full history.** Never push to `main`, never self-merge, no merge without approval.
- **Trace-audit before every push:** no coding-assistant references, no authorship trailers, single
  author, secret-shaped-string scan. **The rule governs AUTHORSHIP, not third-party products the
  product itself names** (OPERATING-RULES §7).
- **Migrations are owner-applied only**, via runbook, dry-run first.
- **Report a blocker before fixing it** when it lands inside your own prior fix.
- **Background waits: sentinel file, or a `[b]racket` pattern** — `pgrep -f` matches its own command line.
- **`CLAUDE.md` stays untracked.** The law is `docs/OPERATING-RULES.md`.
- `nvm use 22`. A fresh worktree has no `apps/web/.env.local`; copy it in or `next build` fails on
  `/api/billing/checkout` — environmental, reproduces on untouched `origin/main`.

## 10. Lessons, in plain language

- **A smaller sample LOOKS more stable**, because there is less of it to disagree about. **Prove the
  control COMPLETES, not merely runs.** A banking measurement nearly shipped showing variance
  *shrinking*, when in fact the round budget was stranding two-thirds of the crawl.
- **Stability through consistent failure is not reproducibility.** The low-variance arm was stable only
  because it died on the same slow section every run.
- **Measure, don't reason.** "A sum is order-free" was false (float addition isn't associative).
  Classification was predicted to lower grades; it raised them.
- **NULL is not zero.** A trigger query counted 10 "nothing read" by COALESCE-ing nulls; the truth is 4,
  plus 6 unevaluable — the same conflation the whole stage exists to remove.
- **A surviving mutation can mean a real gap.** Counting raw edges instead of edges-into-population
  passed every test until one was written for it.
- **Two tests failing after a fix can be opposite cases.** One asserted the defect (A4 JS-shell); one was
  a **stale fixture** (thin-gated to a population of 1). Fix the fixture; don't flip the assertion.
- **crawlee:** `teardown()` does **not** clear its internal `running` flag — await the abandoned `run()`
  or the next one throws. Its timeout has `constructor.name === 'TimeoutError'` but `name === 'Error'`,
  and the class is not exported — match the constructor name, never `instanceof`.
- **Better coverage can produce a WORSE grade.** `info.cern.ch` went A−/88.79 → B+/81.39 once the crawl
  reached the slow corners. That is the thesis confirmed, not a regression.
