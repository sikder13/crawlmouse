# Crawlmouse — SPEC 5.1a handoff

**Rewritten 2026-08-06 for someone with ZERO context.** Read top to bottom before touching anything.
It is meant to be sufficient on its own.

Orientation if you have read nothing else: **`docs/OPERATING-RULES.md`** (the tracked operating law —
read it and follow it), **`PROJECT_OVERVIEW.md`**, **`docs/specs/00-crawlmouse-master-build-plan.md`**,
then **`docs/specs/05_1-engine-honesty-spec.md`** (the active spec).

---

## 1. Where the work is, and the current state

| | |
|---|---|
| Branch | `engine/spec-5-1a` |
| Worktree | `/home/udsik/nahl-clients-projects/crawlmouse-51a` |
| HEAD | this file is the tip. Last CODE commit is `c02e9d7`; everything after it is documentation. Run `git log --oneline -6`. |
| Base | `origin/main` = `69b039f` |
| Commits ahead | **73** |
| **Pushed?** | **NO. Nothing pushed, no PR, no merge.** |
| Working tree | clean except untracked `CLAUDE.md` (deliberate — §7) |
| Helper worktree | `../crawlmouse-base`, detached at `69b039f`, the backtest's base engine. **Keep it.** |

**THE BRANCH IS GREEN.** engine **826** · web **1384** · inngest **144** · scripts **40** · types.
`pnpm typecheck`, `pnpm lint` and `next build` all pass.

---

## 2. THE INVERTED CONTRACT — read before judging any result

Every prior spec held grades byte-identical. **SPEC 5.1 deliberately changes grades. That is its
purpose.** A grade change is not a regression. The gate is **attribution, not identity**: name the
stage and the mechanism for each movement. `Delta = 0` is not a pass; an *unexplained* delta is the
only fail.

Do not tune a constant to shrink a delta. A delta you dislike is a finding.

---

## 3. STAGE 4 — COMPLETE

All merged into the branch, tested, and (where it needed schema) **applied to production and
independently verified by the owner on 2026-08-04.**

### 3.1 The scoring change and the refusal gate

- **Absence-of-evidence ceiling.** `NO_EVIDENCE_COMPONENT_CEILING = 0.5`, applied through **one helper
  every component passes through**, gated on edges observed **into the graded population** (not raw
  graph edges — deliberately different sets).
- **`gradeInputsFrom`** — the `GraphAnalysis -> GradeInputs` spread was duplicated at **three** call
  sites; wiring two of three made the projection disagree with the grade it projects from.
  **Add new grade inputs THERE.**
- **The refusal gate** — `packages/engine/src/refusal.ts`, pure `decideRefusal`.
- **Refusal is decided at the SOURCE.** A refused audit carries no letter and no score, and
  `confidenceBand`, `projectedGrade`, `prescriptions` and `freeFix` are withheld with it — nulling
  score/grade alone was NOT enough, because the band carried the point estimate (41.42 measured beside
  a null score).

| trigger | condition | effect |
|---|---|---|
| `site_too_small_to_measure` | gradeable < floor **AND** crawl completed | withhold letter |
| `too_few_gradeable_pages` | gradeable < floor **AND** crawl truncated (or unknown) | withhold letter |
| `nothing_read` | `fetchedOk === 0` (**null => unevaluable, never refuses**) | withhold letter |
| `no_observed_links` | zero edges into the graded population | withhold letter |
| *coverage unknowable* | `estimateSource === 'none'` | **caps confidence only** — keeps the letter |

**The floor is INSENSITIVE, not tuned.** Over 212 audits: 4 at 0 gradeable, **28 at exactly 1**, 3/2/3
at 2/3/4, 23 at 5–10, 149 above 10. Floor 3 -> 46 refuse, floor **5 -> 51**, floor 8 -> 60. *"We picked
5" invites an argument about 4 or 6; "every floor between 3 and 8 gives the same answer" ends it.*

**The small/large split** is categorical, on crawl-health `partial`, so it needs no threshold. Telling
a legitimate 3-page brochure "we couldn't read enough of your site" is **false** — we read all of it.
**Unknown truncation takes the insufficient-evidence branch.**

### 3.2 The backtest harness — REFUSED is a panel outcome, not an error

`scripts/backtest-runner.ts` used to `throw` on a refusal, so `runEnginePair`'s catch filed it as an
EXCLUDED row backed by a `{ score: 0, grade: '—' }` sentinel. Both halves were wrong: it filed the
engine's most informative verdict as an instrument failure, and **0 renders as F**.

Now: `GradeSnapshot`/`SideResult`/`PairResult` are discriminated unions; `scoreDelta` is null on any
transition without a score on both sides; the **four transitions** (`graded->graded`,
**`graded->refused` — THE HEADLINE**, `refused->graded`, `refused->refused`) render distinctly, with
lost letters banner-logged live and **enumerated** at the top of the summary.
`summarisePairs`/`formatPanelSummary` reconcile: every pair lands in exactly one bucket summing to the
corpus size.

### 3.3 The 13 surface proofs — 5 of 13 were LEAKING

**The standard: byte-level proof at the SERIALIZATION boundary.** "The component doesn't render it" is
NOT proof. Making `AuditResult.score/grade` nullable let the compiler enumerate the *persistence*
boundary; it **cannot** enumerate render surfaces, because the web layer reads DB rows and never
typechecks against `AuditResult`. That gap is evidenced, not assumed.

| # | surface | result |
|---|---|---|
| 1 | minted snapshot | **FIXED** — `asNumber(score) ?? 0` would freeze **0** into an immutable public artifact |
| 2 | OG image | **FIXED** — `grade ?? '?'`, `score ?? '—'`, failure colour; now `lib/og-report-model.ts` |
| 3 | public report | pass, pinned (`isReportGone`) |
| 4 | white-label | pass, pinned (same gate) |
| 5 | embed badge | **FIXED** — rendered `Score — / 100`; now **refuses to mint** (a badge is a claim) |
| 6 | completed event | pass, pinned |
| 7 | CSV export | pass — structurally cannot carry a verdict |
| 8 | SSE stream | pass, pinned |
| 9 | result page | pass; **copy fixed** |
| 10 | share text | **FIXED** — would emit "I scored /0" |
| 11 | leaderboard | pass — excluded in SQL, not the mapper |
| 12 | compare | pass; **copy fixed** |
| 13 | dashboard | **FIXED — the worst one** |

**The dashboard leak was the most serious defect in the whole spec.** `grade ?? ''` / `score ?? 0`
made a refused re-audit read not as blank but as a **collapse**: gauge at 0, sparkline diving to the
floor, and `0 - 81.39` telling the owner *"Down 81 points since your last visit — worth a look."* The
RED output literally read `expected -81.39 to be null`. Types are now nullable end to end; the
sparkline **breaks at a gap** rather than plotting zero.

### 3.4 §7 coverage accounting + D4 sitemap delta

`CoverageAccounting` distinguishes `fetched` / `gradeable` / `estimatedTotal` **with provenance**
(`estimateSource`). `coverageRatio` is **null when unknowable, never 1.0**, and clamps at 1.
Exclusions are tallied by `PageKind`. `sitemapUnreached` = declared minus link-reachable (`ga.depths`
keys), with **robots-disallowed URLs counted separately** — the owner chose those; conflating them
turns an ordinary `Disallow: /cart` into a finding against the site.

**D4:** the sitemap delta is emitted **FIRST** and **survives a refusal**. Severity is **categorical**
(`unreached > reachable`) so 5.1a admits no new tuned threshold. **Acceptance proven end to end
through the real crawler** on the freepltn shape: 821 declared, 820 unreached, reachable 1, it leads,
it is critical, it still leads when the audit is REFUSED, and it reports **the same count at pageCap
4 and 16** — a delta that moved with our crawl budget would be a statement about us, not the site.

### 3.5 The five approved refusal copy bodies — WIRED

`apps/web/lib/refusal-copy.ts`, function `refusalCopy`. **ONE call site, not thirteen.** Every surface
routes through it.

Precedence, because triggers co-fire: **`nothing_read` -> sitemap-delta shape -> below-floor ->
`no_observed_links`.** (If the server returned nothing the rest is a consequence; copy (d) is explicit
that the sitemap number outranks the refusal reason; at <5 pages absent edges are a property of the
sample.) The delta's "does it lead" reuses **D4's own categorical rule** — two rules for one concept is
how the copy and the finding would come to disagree.

**The owner's three revisions, each pinned by a test that fails without it:**
1. **(a)** the floor as a **number** and as **OUR rule** — `"Below 5 pages we don't publish a letter"`.
   A hedge inside the honesty gate reads as uncertainty about our own threshold.
2. **(c)** *"links between the pages we graded"* + the archive/tag clause emitted **only when such
   pages were actually excluded**.
3. **(e)** the **403/429 -> AI-crawlers-likely-blocked** connection, with the reproducing
   `curl -A "CrawlmouseBot/1.0" <origin>`.

**Two rules asserted across all five bodies:** never described as a failing grade, and **no next step
is ever a Pro upsell** — none of the triggers is solved by a bigger crawl budget. *(The upsell check
matches WORD BOUNDARIES: "reproduces" contains "pro".)*

Numbers are **omitted rather than guessed** — pre-migration rows were not backfilled, so the
no-trigger fallback stays. *"We crawled all 0 pages" is worse than saying nothing.*

### 3.6 The Stage 4 migration — APPLIED

`infra/supabase/migrations/20260804000001_spec51a_stage4_refusal_coverage_fingerprint.sql`.
Applied and independently verified by the owner **2026-08-04**: `audits.refusal` / `coverage` /
`fingerprint` all jsonb, nullable, no default, **0 rows (no backfill)**; `audits` 904 kB -> 912 kB;
database unchanged at 226 MB.

**Privilege boundary:** `refusal` + `coverage` readable by anon + authenticated (user-facing by design;
no URLs, no crawled text, no user_id); **`fingerprint` NOT granted** — the `seed` is our sampling salt
and `strata[].templateKey` is an internal taxonomy. `audits` has been on explicit column grants since
`20260707000003`, so new columns are **deny-by-default**.

**⚠ The migration LEDGER under-reports.** `list_migrations` stops at `20260707000005` while
`ai_readiness` and the `pages.ai_signals` privilege change are both live. **Trust
`information_schema`, not the ledger.**

---

## 4. STAGE 5 — engine work COMPLETE; migration AWAITING OWNER APPLY

**NOT applied.** `infra/supabase/migrations/20260805000001_spec51a_stage5_frontier_checkpoint.sql`
with `docs/deploy/spec51a-stage5-frontier-runbook.md`. Its **own** migration, owner-ruled — bundling
it into close-out would land unverified schema last.

Two new tables: `frontier` keyed `(audit_id, url_hash)` holding canonical URL, `template_key`,
`sample_key`, `depth`, `state`, `source`, indexed on `(audit_id, state)` for the claim and on
`updated_at` for the sweep; and `frontier_politeness` keyed `(audit_id, host)`. Internal only — **no
anon/authenticated grant**, RLS on with no policies.

### 4.1 B6 — THE ACCEPTANCE CRITERION, in full

**A resumed crawl must select the SAME pages a straight-through crawl would have.** A checkpoint
without that is worse than none: it reintroduces composition drift through the back door.

**The naive resume — "select from what is LEFT" — is wrong**, and it was committed FIRST and proved
RED rather than argued. `selectFrontier` is a pure function of the set it is *given*, so feeding it the
remainder feeds it a different set; the stratified round-robin re-balances quotas across strata already
partly consumed. **Measured: naive digest `b6860ec…` against straight-through `d64233f…`.**

The rules, all in `packages/engine/src/analysis/frontier-checkpoint.ts`:

1. **Persist EVERY discovered URL.**
2. **Re-run selection over the COMPLETE set** on resume — `resumeSelection(all, budget)`.
3. **Fetched rows subtract from the WORK, never from the BASIS** (`pendingAfterResume`, `claimOrder`).
4. **`failed` rows STAY in the basis** — a dead URL was still discovered; dropping it shrinks the set
   and re-balances every quota around the gap, the same bug wearing a hat.
5. **`state` is deliberately unread by `resumeSelection`.** That is not an oversight. **A future edit
   that "optimises" by filtering on it is the regression.**

Also pinned: idempotent across repeated resumes · unaffected by the order Postgres returns rows (no
`ORDER BY` guarantees none, and arrival order is forbidden under §6.6) · unaffected by which rows a
parallel worker claimed (`FOR UPDATE SKIP LOCKED` changes *who fetches what*, never *what is
selected*) · pinned against `selectFrontier` itself so the checkpoint cannot become a second
implementation of §6.

**Scope, stated honestly:** this proves selection determinism GIVEN the same discovered set. It cannot
prove the discovered set is identical against a live host — a budget-bounded crawl discovers as far as
latency allows. That limit is recorded in `frontier.ts`'s header and
`evidence/2026-08-03-stage3-carry-forward.md`.

### 4.2 Politeness

`restorePoliteness` clears an **expired** backoff (a deadline already past is not a restriction) while
keeping `crawlDelayMs` and `consecutive429s` exactly — those describe the **host**, and resetting them
walks a resume straight back into the throttle it just earned, turning a transient 429 into a durable
block that would later read as the site's own configuration. **Timing only**; a test pins that
`resumeSelection` takes no politeness argument.

### 4.3 Retention — the answer for every non-happy path

**Frontier rows are TRANSIENT working state, NOT kept for the audit's 30-day TTL.** Had the frontier
existed for the corpus so far it would hold **602 149 rows, about 300 MB — larger than the whole
226 MB database.**

Three paths, because the first two cover only the happy path:
1. explicit delete at completion (worker) — a crawl that finishes;
2. `on delete cascade` — an audit the TTL cron actually deletes;
3. **`deleteOrphanFrontierRows` — sweeps on AGE ALONE** (`FRONTIER_ORPHAN_TTL_HOURS = 24`), saying
   nothing about audit status or TTL. A crawl cannot meaningfully outlive its 240s budget, so
   "untouched for 24h" is dead by construction whatever killed it — **one predicate instead of one
   branch per failure mode**, at about 360x the budget. It rides the **existing** daily cron as its own
   step, running **first** so an Inngest retry on the frontier cannot abort the audit TTL sweep.

`frontier_updated_at_idx` is **load-bearing**: without it the sweep is a full scan of the largest table
exactly when it is largest.

**Storage**, anchored on a real row-per-URL table rather than estimated: `pages` = **41 228 rows in
24 428 544 B = 593 B/row** (indexes 45%). A frontier row is about **500 B**. Typical audit ~1.5 MB, p95
~1.8 MB, **worst measured (100 684 discovered) ~50 MB for ONE audit**. Steady state is bounded by
**concurrent crawls, not corpus size**: ~8 MB typical at concurrency 5, ~250 MB pathological ceiling —
transient and self-clearing.

---

## 5. THE TWO OWNER RULINGS (2026-08-06)

### 5.1 DISCOVERY CAP — **DROPPED**

Built, measured, stopped, and now **dropped**. *A guard that moves grades to solve a problem already
solved is pure cost.*

`capDiscovered` / `discoveryCapInfo` / `MAX_DISCOVERED_URLS` and the fingerprint fields
`discoveryCapped` / `discoveredAtCap` **remain in the tree, UNWIRED** — kept deliberately, because the
tests *are* the measurement apparatus for the watch-item below, and deleting them would mean
re-deriving the table from scratch if a site ever enters the band. **Nothing calls them.**

Why it was dropped, both facts:
- **Storage is already solved by the orphan sweep** — a transient ceiling, not a permanent cost.
- **It replaces about 78% of the sample** on the one-stratum-per-URL shape, which is *the only shape
  that reaches it*.

**Rejecting a first-N-arrival cap was right** — arrival order is forbidden under §6.6; it is
concurrency and host latency wearing a hat. The built version keeps the smallest **sample keys** (the
§6.4 min-k mechanism), which is order-free.

**WATCH-ITEM for 5.1b — not planned work.** *If a NON-Wikipedia site ever reaches this band, revisit.*
Measured overlap after capping (budget 500):

| shape | strata | overlap |
|---|---|---|
| one stratum | 1 | 500/500 — unchanged |
| forty even strata | 40 | 500/500 — unchanged |
| two lopsided strata | 2 | 346/500 |
| long tail | 101 | 206/500 |
| **one stratum per URL (Wikipedia)** | **5 000** | **111/500 — about 78% replaced** |

Distribution over 208 live audits: p50 **79** · p90 **2 098** · p95 **3 539** · p99 **100 236** · max
**100 684**. **Bimodal** — 202 under 12 000, five between 88 583 and 100 684, and the band
**11 487 to 88 582 is EMPTY**, so every cap in a 76 000-wide window hits the same five.

The five are all Wikipedia (`ru.wikipedia.org` x4, `ar.wikipedia.org` x1), all already `partial`,
`confidence: low`, coverage **0.40–0.49%**. They are *already* non-reproducible: four runs of
`https://ru.wikipedia.org/` discovered 100 684 / 100 576 / 100 236 / 100 152 and scored
83.82 / 83.76 / 83.66 / 83.65.

### 5.2 ORPHAN SWEEP — **APPROVED**

Sweeping on staleness alone, knowing nothing about audit status or TTL, is the right predicate: a
crawl cannot meaningfully outlive its own working state, so one rule covers failed, cancelled,
null-expiry and worker death. `frontier_updated_at_idx` correctly identified as load-bearing. Running
it before the audit TTL sweep, so an Inngest retry cannot abort the latter, was called out as a good
detail.

---

## 6. STAGE 6 — CLOSE-OUT (what remains)

1. **Wire the SQL-backed `FrontierStore`** into the crawl path — the interface is defined and
   unit-tested in `frontier-checkpoint.ts`. `upsertDiscovered` on discovery; `claim` via **`FOR UPDATE
   SKIP LOCKED`**; `settle` per fetch outcome; the explicit delete at completion. **The engine stays
   DB-free — the store is injected by the worker.** *(Requires the Stage 5 migration applied first.)*
2. **The import-graph REGRESSION GUARD.** Fail the build if any surface serialises `grade` or `score`
   without passing the refusal gate. **Derive the surface list from the IMPORT GRAPH, never a
   hardcoded list — a hardcoded list is what made the SPEC 05 barrel guard vacuous.** Five of thirteen
   surfaces leaked because each was written before the gate existed; the fourteenth will be written
   after it, and inspection will not catch that one either. Mirror the positioning-guard pattern, and
   match the OPERATION rather than identifier names (see
   `apps/web/__tests__/crawled-text-cut-guard.test.ts`, which learned this expensively).
3. **The full A1–B17 acceptance sweep.**
4. **The live sample: ~15 sites across the size strata.** The 51/64 refusal numbers are **lower
   bounds** — the thin gate is unreplayable for 95% of the corpus and can only move audits *into*
   refusal. Run it alongside the live smoke: one round of crawling, two purposes.
5. **The 3x adversarial gate** — independent correctness / security / deploy-safety / test-quality
   reviewers, **on a frozen SHA, in isolated worktrees**, fix-loop to >=9, 0 blocking. Do not
   self-review in one pass.
6. **The PR.** Never push to `main`, never self-merge, **no merge without the owner's explicit go.**

**Definition of done** also requires a live smoke **on the deployed Vercel function** — never the local
Inngest dev server (`PROJECT_OVERVIEW.md` §11).

---

## 7. Standing rules — several learned expensively

- **TDD.** Failing tests first. **Every test must be capable of failing** — mutation-verify, and
  **prove the mutation harness is live with an unconditional throw first.**
- **Never `git checkout --` to revert a mutation** — it has destroyed uncommitted work here. Use `cp`.
- **Verification order:** `pnpm test` -> `pnpm typecheck` **after the final commit** -> `pnpm lint`
  **before** `next build` -> `next build`.
- **Never squash. Full history.** Never push to `main`, never self-merge, no merge without approval.
  *(If `git add -A` sweeps two logical units into one commit, split it — done once already.)*
- **Trace-audit before every push:** no coding-assistant references, no authorship trailers, single
  author, secret-shaped-string scan. **The rule governs AUTHORSHIP, not third-party products the
  product itself names** — `GPTBot`/`ClaudeBot` are product data and must stay.
- **Migrations are owner-applied only**, via runbook, rehearsal first.
- **Report a blocker before fixing it** when it lands inside your own prior fix.
- **Background waits: sentinel file, or a `[b]racket` pattern** — `pgrep -f` matches its own command
  line.
- **`CLAUDE.md` stays untracked.** The law is `docs/OPERATING-RULES.md`.
- `nvm use 22`. A fresh worktree has no `apps/web/.env.local`; copy it in or `next build` fails on
  `/api/billing/checkout` — environmental, reproduces on untouched `origin/main`.

---

## 8. Lessons, in plain language

- **Byte-level proof at the serialization boundary is not pedantry.** Five of thirteen surfaces were
  leaking and inspection caught none of them. "The component doesn't render it" proves nothing about
  the bytes.
- **In the honesty gate, state only what was established.** Two surfaces asserted a CAUSE we never
  measured ("We reached too few pages", "usually a site that blocks crawlers") — one trigger of four
  stated as all of them. **Then my own first draft of the share copy smuggled the same invented cause
  back in** ("not enough to measure yet"); a test caught it. A plausible reason is still a fabrication.
- **The hand-synchronised derivation class — three instances, one pattern.** `gradeInputsFrom` (found
  **by accident**), the `reachPercent`/FU-12k case, and `estimateSiteTotal` (caught **on sight**,
  called twice for the refusal gate and the confidence band). **The remedy is always ONE derivation
  passed down, never two kept in agreement.** Search hints: the same expression in two files; a value
  recomputed from raw inputs where a computed one is in scope; any `?? 0` / `?? ''` re-establishing a
  default another module already decided.
- **The fingerprint has paid for itself three times** — over-counting, the banking limit, and storage
  (the unbounded strata table, about 6 MB on one row; the old note said "~120 KB", wrong by about 50x
  because it reasoned from the page cap rather than the pre-selection discovered count). Recorded
  together in `evidence/2026-07-31-racedays-reproducibility-control-retired.md`.
- **Fix the FIXTURE, not the assertion.** Twice: a stale thin-gated fixture, and the cap impact test —
  `/p/{n}` collapses to one stratum while `/a/p0` does not, so a "single-stratum" fixture was
  measuring the opposite of what it claimed.
- **NULL is not zero.** A trigger query counted 10 "nothing read" by COALESCE-ing nulls; the truth is 4,
  plus 6 unevaluable.
- **A smaller sample LOOKS more stable**, because there is less of it to disagree about. **Prove the
  control COMPLETES, not merely runs.** Stability through consistent failure is not reproducibility.
- **A surviving mutation can mean a real gap.** Counting raw edges instead of edges-into-population
  passed every test until one was written for it.
- **Measure, don't reason.** "A sum is order-free" was false (float addition is not associative).
  Classification was predicted to lower grades; it raised them.
- **Better coverage can produce a WORSE grade.** `info.cern.ch` went A-/88.79 -> B+/81.39 once the
  crawl reached the slow corners. That is the thesis confirmed, not a regression.
- **crawlee:** `teardown()` does **not** clear its internal `running` flag — await the abandoned
  `run()`. Its timeout has `constructor.name === 'TimeoutError'` but `name === 'Error'`, and the class
  is not exported — match the constructor name, never `instanceof`.

---

## 9. Carried forward

- **TICKET (pre-existing, do NOT fix in 5.1a):**
  `docs/tickets/2026-08-06-expired-audits-null-expiry-never-deleted.md` — `deleteExpiredAudits`
  filters on `expires_at` only, so audits with a NULL expiry are never deleted and their cascade never
  fires.
- **5.1b — the discovery-cap WATCH-ITEM** (§5.1 above). Not planned work.
- **5.1b panel — `racedays.run`:** 419 pages crawled, **69 gradeable (16%)**. The most dangerous shape
  in the corpus: a large legitimate site graded on a small fraction of itself while page-count coverage
  looks healthy.
- **5.1b — the round-budget trade:** `FRONTIER_ROUND_BUDGET_MS` 30s -> 35s restored recorded dead paths
  (0 -> 4) but cost coverage (100 -> 83 pages). Settle against a corpus, not one site.
- **Repo-wide sweep (5.1b or later):** the hand-synchronised derivation class (§8).
- **SPEC 02 §2 is SUPERSEDED in the overlap** — amendment in both specs. §2 removed the C/60 clamp
  because clamping produced a **fake letter**; Stage 4 removes the **assertion**. A test asserting "a
  degraded crawl still gets a score" encodes §2's **mechanism**, not its **intent**.
