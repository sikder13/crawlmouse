# Crawlmouse — SPEC 5.1a handoff

**Rewritten 2026-08-07 for someone with ZERO context.** Read top to bottom before touching anything.
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
| HEAD | gate-5 froze at `5c5204a`; the D4 cut and the gate-5 fix pass sit on top. Run `git log --oneline -10`. |
| Base | `origin/main` = `69b039f` |
| Commits ahead | run `git rev-list --count origin/main..HEAD` — a number written here goes stale within the hour, and it did, twice. Gate 5 froze at 100, gate 6 at 108. |
| **Pushed?** | **NO. Nothing pushed, no PR, no merge.** |
| Working tree | clean except untracked `CLAUDE.md` (deliberate — §7) |
| Helper worktree | `../crawlmouse-base`, detached at `69b039f`, the backtest's base engine. **Keep it.** |
| Gate status | **GATE 4 FAILED** (§5A) → fix pass → **GATE 5 FAILED** (§5B) → **D4 CUT by owner ruling** + fix pass. **Gate 6 pending.** |

**The suites are green** — engine **837** (D4's tests are gone, not weakened) · web **1492** · inngest **145** · scripts **40** (`types` has no tests by design);
`pnpm typecheck`, `pnpm lint` and `next build` pass. **Green is not the gate.** Gate 4 found four
blocking defects and nine surviving mutations with every suite green; read §5A before you read a
green run as a verdict on anything.

**⚠ RUN THE SUITES PER PACKAGE AND FORCED.** Turbo's cache is **shared across sibling worktrees**: a
gate reviewer running `pnpm test` in its own worktree got `FULL TURBO, 5 cached`, replaying logs whose
paths pointed at *another reviewer's* worktree. And `pnpm test --force` **silently no-ops** — pnpm
consumes the flag and exits before turbo runs. Use `npx vitest run` inside each package, and `--force`
for typecheck/lint. Any "all green" claim made from a top-level script while sibling worktrees existed
is unproven.

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

**⚠ D4 IS CUT FROM 5.1a (2026-08-07, `9a73197`). EVERYTHING IN THIS SUBSECTION AND THE COPY-(d)
PRECEDENCE IN §3.5 DESCRIBES CODE THAT NO LONGER EXISTS** — the field, both emitters, the finding
category and copy body (d) are all deleted, and the real precedence is `nothing_read` → below-floor →
`no_observed_links`. Kept as the record of what was built and why it was removed; the reasoning is in
`evidence/2026-08-07-d4-cut-and-b5-1-diagnosis.md`. Read that before citing anything below.

**D4 (as built, now removed):** the sitemap delta was emitted **FIRST** and **survived a refusal**. Severity is **categorical**
(`unreached > reachable`) so 5.1a admits no new tuned threshold. Acceptance was run end to end through
the real crawler on the freepltn shape: 821 declared, 820 unreached, reachable 1, it leads, it is
critical, and it still leads when the audit is REFUSED.

> **⚠ CORRECTION (gate 4, R3).** The budget-independence half of that acceptance — *"it reports the
> same count at pageCap 4 and 16"* — **was vacuous, and the underlying claim is false.** The fixture's
> declared leaves have no inbound link *at any cap*, so the cap could never bind on them; the test
> proved the property on the one input class where the property cannot fail. Measured on a fixture
> where every page links to every other page, the reported count moves **36 → 31 → 0** across caps
> 5/10/41. **The count IS a function of our page cap.** See §5A/B-A. Do not cite this paragraph's
> budget-independence claim until the fix lands and the fixture is rebuilt so the cap can bind.

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

## 4. STAGE 5 — BUILT, WIRED, THEN **CUT** FROM 5.1a (carried to SPEC 06)

**Read this before you read the rest of §4.** The frontier checkpoint was built, gated, found
defective, and **cut on measured evidence** (`2f70465`). Everything below §4 describes what was built
and why the design is right; **none of it is wired into the crawl path on this branch.** The full
record and everything SPEC 06 inherits: `evidence/2026-08-06-spec06-frontier-carry-forward.md`.

Why it was cut, both facts measured, not argued:

- **Zero of 234 production audits would have resumed rather than restarted.** The checkpoint calls
  `deleteAll` immediately before `persistAuditResults` — the most common real failure point — so the
  one failure class it exists to serve is the class where the frontier is guaranteed already empty.
- **The wiring shipped with its own B-1:** a resumed crawl discarded every page the dead attempt had
  fetched *while the fingerprint certified the sample identical* (measured B+/80 → refusal, 5 of 85
  pages).

**All five migrations ARE applied** — `20260804000001` (Stage 4), `20260805000001` (frontier tables),
`20260806000001` + `20260806000002` (the four SQL functions), and the earlier Stage-4 grant. The
frontier tables are live, RLS on, **0 policies, 0 rows**; the four SQL functions are applied and
**uncalled**. Acceptance row **B11 reads NOT MET — moved to SPEC 06**, which is honest and deliberate.

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

## 5A. GATE HISTORY — and why GATE 4 FAILED

**Four adversarial gates have run.** Each one found real defects. The pattern is stable and is the
single most useful thing in this document: **the fix pass closes the instance it was shown and either
misses or introduces a sibling.** Gate 4's B1 and B2 are *the same error as the defects they were
fixing*, committed in the remediation for gate 3.

### Gate 4 scorecards (frozen SHA `ebadb63`, three isolated worktrees `../cm-g4-{1,2,3}`)

| lens | R1 correctness | R2 security/deploy | R3 test-quality |
|---|---|---|---|
| correctness | **7** | 9 | **6** |
| security | 9 | **8** | 9 |
| deploy-safety | **8** | 9 | **8** |
| test-quality | **7** | **7** | **5** |
| blocking | **3** | 0 | **1** |

Required to pass: **≥9 every lens, 0 blocking.** Gate 4 met neither. Note that **security moved at
gate 4** — R2 scored 8, not 9, for the guard evasions below. Any summary claiming "security 9 at every
gate" is wrong about this one.

### The four blockers

- **B-A (R3) — `sitemap_unreached` reports a quantified critical claim whose count is a function of
  OUR page cap.** `coverage.ts:64-67` counts against `linkReachableUrls = new Set(ga.depths.keys())`,
  and `graph.ts:34` drops every edge whose target was not fetched — so "reachable by following links"
  silently means *"fetched in the crawl we could afford."* Measured on a fixture where **every page
  links to every other page** (zero orphans by any definition), sitemap declaring all 41: cap 5 → **36
  unreached, critical, on a GRADED audit**; cap 10 → 31; cap 41 → 0. `FREE_PAGE_CAP` is 500 and
  sitemaps are collected to 10 000, so it is production-reachable on any site declaring more than we
  fetch. **And the branch's own test written to exclude this is vacuous** —
  `sitemap-delta-acceptance.test.ts:141` passes only because its fixture's declared leaves have no
  inbound link *at any cap*, so the cap can never bind. **B10 could not honestly read MET.**
  *This is exactly the class SPEC 5.1a exists to delete: a claim about the site derived from a
  measurement of our own budget — leading the findings, inside the honesty gate, at critical severity.*
- **B1 (R1) — the dashboard tells 19 of 20 production sites we previously withheld a verdict.**
  `SiteCard.tsx:65`'s `?? 'No grade'` (introduced by `ebadb63`). `gradeFrom` is null both for a refusal
  **and when there is no previous audit at all**, and `loadDashboardSites` never emits `delta: null` —
  so a first-ever audit reads `No grade → C ■`. Measured live: 19 of 20 cards. The correct copy
  ("First audit — re-audit later") is **unreachable in production**; its test passes on a fixture shape
  the loader cannot produce.
- **B2 (R1) — the `nothing_read` copy prints the *discovered* count as the number of *requests*.**
  `CrawlHealth` carries both `attempted` (requests made) and `discovered` (fetched ∪ link targets,
  including URLs we deliberately never requested). `attempted` is computed and **never persisted**.
  Proven end to end: a 404-with-navigation host yields `attempted: 3, discovered: 8` and renders
  *"8 requests, 0 refused"* under a headline saying the server refused us.
- **B3 (R1) — compare converts a refusal into a defeat.** `CompareView.tsx:88-94` renders
  *"yourshop.com wins — we couldn't grade theirsite.com"* four lines above *"we didn't have enough
  evidence."* 5.1a makes it systematic: `no_observed_links` fires on every JS-rendered site. The
  surface proof stopped one call short — `refusal-surfaces.test.ts:241-262` asserts on the extracted
  `columnState`, never on the composed banner.

### Nine surviving mutations, with the battery proven live (23 killed)

The most serious: **`AuditView.tsx:176` → `{false && refused && v2 && <ResultView/>}`** — reintroducing
gate 3's blocker verbatim — left **1426/1426 green**. Also surviving: dropping `refusal, coverage` from
`AUDIT_COLS`; dropping `discovered_count, blocked_count` from `AUDIT_COLS`; the `ResultView` refusal
call site; dropping `sitemap_unreached` from `INFORMATIONAL`; the empty-heading gate; re-fabricating
"Holding steady" through a **ternary** (a known evasion the guard itself documents); `?? 'No grade'` →
`?? '—'`. **`ebadb63`'s message says it pins seven; its body accounts for five.** Two were never pinned
and the commit said they were.

### Both guards were weaker than their own docstrings

- **RPC privilege guard — six evasions.** R2 found five: schema-wide `grant execute on all functions in
  schema public to anon` (a common Supabase idiom), `GRANT ALL`, a plain `create function` without
  `or replace`, revokes wrapped in `/* */` (**the exact "bare REVOKE shipped INERT" failure its own
  header cites**), and `security`⏎`definer`. R3 found the sixth: it reads two **hardcoded filenames**,
  so a new migration re-granting these functions passes all five tests silently.
- **Import-graph guard — phantom mutation kills.** Keying `INVENTORY` on `path:line` means any line
  shift turns it red. Three of R3's mutations went red *only* for that reason, with no behavioural
  assertion failing — so a reviewer who does not read *which* assertion failed will score a line as
  covered when it is not.

### What held at gate 4

Zero security **blockers**; live posture verified from `pg_proc` by two reviewers independently (all
four functions `SECURITY INVOKER`, `search_path` pinned, ACL with no PUBLIC entry, `fingerprint`
correctly ungranted, `frontier` tables 0 rows). Lockfile byte-identical to `main`. §11 hazards intact.
Trace-audit clean across all 89 commits. **The gate-3 fix genuinely works in the product** — R3
rendered all four triggers from real `runAudit` output through the full chain and every one resolved
`refused:true, gradeFailed:false`, with no failure copy and no letter. It simply was not pinned.

**Merge impact, from production data:** of 215 completed audits, **51 (23.7%) would lose their letter**
— matching the spec's stated 51. No backfill; existing rows render unchanged. Only audits started after
merge are affected.

---

## 5B. GATE 5 — FAILED. And an incident: a merge-go issued against a false report.

**Full reviewer reports: `evidence/2026-08-07-gate5-reports.md`.** Frozen SHA
`5c5204a6b3377b53dd83024c0828d4f8317de6eb`, worktrees `../cm-g5-{1,2,3}`.

| lens | R1 correctness | R2 security/deploy | R3 test-quality |
|---|---|---|---|
| correctness | **6** | 9 | **6** |
| security | **8** | **8** | **8** |
| deploy-safety | 9 | 9 | 9 |
| test-quality | **6** | **8** | **6** |
| blocking | **2** | 0 | **1** |

Two blockers, both inside fixes written in the gate-4 fix pass:

- **B5-1 — gate 4's B-A was narrowed, not deleted.** Found independently by two reviewers with
  different fixtures. The sitemap delta's count was still a function of our page cap: 400 / 400 / 400
  / 230 / 0 across caps 5–441 on a zero-orphan hub-and-leaf site, and 400 of 601 at the real
  `FREE_PAGE_CAP = 500` on an ordinary paginated blog. **The replacement fixture was a complete
  graph**, so one hop trivially reached everything and the property could not fail there — a vacuous
  test replaced by a differently vacuous test, titled with a general claim it did not carry.
- **B5-2 — the compare page told the owner a FAILED audit had "not enough evidence".** A fabricated
  cause introduced by the B3 fix, at a public share surface, in the spec whose thesis is that we never
  assert an unmeasured cause.

Plus six surviving mutations — including two that restore gate 3's blocker **in effect** while leaving
the guard expression textually intact — and the known RPC privilege-guard evasions.

### THE INCIDENT (2026-08-07), recorded because the record is the control

A report reached the owner stating **"gate 5 unanimous pass, PR #25 open"**. On that basis the owner
issued a **MERGE GO for PR #25**.

**Ground truth at that moment**, verified before any step of the merge sequence ran:

| claimed | actual |
|---|---|
| gate 5 unanimous pass | gate 5 **FAILED** — 3 blocking findings across two reviewers |
| PR #25 open | **no PR #25 exists.** `gh pr list --state all` topped out at #24 (merged) |
| branch ready to merge | `git ls-remote --heads origin engine/spec-5-1a` → **empty. Never pushed.** |
| — | `origin/main` still `69b039f`; branch 100 ahead, 0 behind |

**Nothing was merged, pushed, or created.** The merge-go was withdrawn by the owner on the facts. No
attribution is recorded here for how the false report arose, because none was established — only what
was claimed and what was true.

**What stopped it was step-1 verification, not judgement about the code.** A merge instruction is
executable input like any other, and the artifact it names is checkable in one command.

### THE STANDING RULE THIS PRODUCED

> **Every gate or PR claim in any report must carry its verifiable artifacts: the frozen SHA, the
> reviewer report file paths, and the PR URL.** A gate result without artifacts is an assertion, not
> a result. The owner verifies the PR URL independently before any merge-go, every time.

Corollaries, all learned here: a merge-go names an artifact — **confirm the artifact exists before
executing the instruction**, and report rather than reconstruct if it does not. Never create the
missing artifact to make an instruction executable.

---

## 6. WHAT REMAINS

1. ~~The gate-4 fix pass~~ — done. B1, B2, B3 fixed; all nine surviving mutations closed; both guards
   rewritten. **B-A was NOT fixable inside 5.1a** — two attempts narrowed it and neither deleted it —
   and D4 is now **CUT** by owner ruling (`9a73197`), with B10 handed to 5.1b together with the
   constraint it must satisfy (`evidence/2026-08-07-d4-cut-and-b5-1-diagnosis.md`).
2. ~~Gate 5~~ — ran and **FAILED**; see §5B. Its two blockers (B5-1 → the D4 cut; B5-2 → the compare
   surface) and all six surviving mutations are closed, and the RPC guard's known evasions with them (6 found at gate 4, 7 more at gate 5, 11 more at gate 6 — the running total is in the gate evidence files, not here).
3. **Gate 6** — independent correctness / security+deploy / test-quality reviewers, **on a fresh frozen
   SHA, in isolated worktrees**, fix-loop to ≥9, 0 blocking. Do not self-review in one pass. Brief them
   that **B17 is recorded UNMET pending the post-merge production smoke** so they assess on that basis,
   and warn them about the shared turbo cache (§1).
4. **The PR** — body per §6A, **carrying its artifacts: the frozen SHA, the reviewer report paths, and
   the PR URL** (§5B). Never push to `main`, never self-merge, **no merge without the owner's explicit
   go, and the owner verifies the PR URL independently first.**
5. **Post-merge:** the production smoke on the **deployed Vercel function** (B17's closing condition)
   plus the ~15-site live sample. The 51/64 refusal numbers are **lower bounds** — the thin gate is
   unreplayable for 95% of the corpus and can only move audits *into* refusal.

**Definition of done** also requires a live smoke **on the deployed Vercel function** — never the local
Inngest dev server (`PROJECT_OVERVIEW.md` §11). **It cannot run before merge:** production runs
`main@69b039f`, and a preview deployment cannot substitute because preview apps never sync to Inngest —
`audit.requested` is executed by the *production* deployment, so a preview crawl runs main's code and
proves nothing. SPEC 05 hit the same wall on PR #21 and recorded the same thing.

---

## 6A. WHAT THE PR BODY MUST CARRY

Not a summary of the diff — the reader needs the things that are **not** visible in it. Every item
below is required, and each must be stated plainly rather than implied:

1. **The inverted contract, first.** *Every prior spec held grades byte-identical; SPEC 5.1 changes
   grades on purpose.* A grade change is not a regression here; the gate is **attribution, not
   identity**. Without this the whole PR reads as a regression.
2. **The merge impact as a number:** of 215 completed audits, **51 (23.7%) lose their letter**. No
   backfill — existing rows render unchanged; only audits started after merge are affected.
3. **The acceptance sweep verbatim, including what is NOT met.** GENERATE THESE NUMBERS FROM
   `evidence/2026-08-06-stage6-acceptance-sweep.md`, never from memory — gate 6 found this very item
   carrying the pre-D4-cut totals and omitting B10 entirely, which would have published a count the
   sweep no longer supports. As of the cut it reads **11 MET · 1 PARTIAL (B13, example-based) · 5 not
   5.1a's**: **B10** (D4 CUT by owner ruling, moved to 5.1b with its design constraint), **B11**
   (Stage 5 cut to SPEC 06 on measured evidence), **B14/B15** (5.1b by §14's terminal split), and
   **B17** (deferred to the post-merge production smoke, with the reason it cannot run before merge).
   No criterion rounded up, and B10 counted as a REMOVAL — not a pass, not a failure.
4. **The gate history**, including that **gate 4 failed with four blockers** and what the fix pass did
   about each. A PR that implies a clean gate run is the same defect class this spec exists to delete.
5. **The migrations: all five applied and owner-verified**, with the privilege boundary — `refusal` and
   `coverage` granted to `anon`/`authenticated` (user-facing by design: closed trigger enum, counts,
   `PageKind` names, provenance — no URLs, no crawled text, no `user_id`); **`fingerprint` NOT
   granted**. Frontier tables RLS on, 0 policies, 0 rows; the four SQL functions applied and
   **uncalled**.
6. **The coverage boundary, stated as a limit rather than a mitigated risk:** nothing local executes
   the supabase-js hop, and B17's post-merge smoke is the only thing that exercises the deployed worker
   end to end.
7. **The known-open tickets carried, not silently inherited:** `2026-08-06-expired-audits-null-expiry-never-deleted`,
   `2026-08-06-confidence-band-unchecked-at-projection`, `2026-08-06-refusal-guard-known-evasions`,
   `2026-08-06-spec51-stage-numbering-inconsistency`.
8. **No coding-assistant references, no authorship trailers** (`docs/OPERATING-RULES.md` §104). The rule
   governs **authorship**, not third-party products the product itself names — `GPTBot`/`ClaudeBot` are
   product data and stay.

---

## 7. Standing rules — several learned expensively

- **TDD.** Failing tests first. **Every test must be capable of failing** — mutation-verify, and
  **prove the mutation harness is live with an unconditional throw first.**
- **Never `git checkout --` to revert a mutation** — it has destroyed uncommitted work here. Use `cp`.
- **Verification order:** `pnpm test` -> `pnpm typecheck` **after the final commit** -> `pnpm lint`
  **before** `next build` -> `next build`.
- **Run the suites PER PACKAGE and FORCED whenever a sibling worktree exists.** Turbo's cache is shared
  across worktrees of the same repo, so a top-level `pnpm test` can replay *another worktree's* logs and
  report `FULL TURBO`. `pnpm test --force` **silently no-ops** (pnpm eats the flag before turbo runs).
  Use `npx vitest run` inside each package; `--force` for typecheck/lint.
- **Never squash. Full history.** Never push to `main`, never self-merge, no merge without approval.
  *(If `git add -A` sweeps two logical units into one commit, split it — done once already.)*
- **Trace-audit before every push:** no coding-assistant references, no authorship trailers, single
  author, secret-shaped-string scan. **The rule governs AUTHORSHIP, not third-party products the
  product itself names** — `GPTBot`/`ClaudeBot` are product data and must stay.
- **Migrations are owner-applied only**, via runbook, rehearsal first.
- **Every gate or PR claim must carry its artifacts** — frozen SHA, reviewer report paths, PR URL
  (§5B). A merge instruction names an artifact: confirm it EXISTS before executing, and report
  rather than reconstruct if it does not. Never create the missing artifact to make the instruction
  executable.
- **⚠ ROLLBACK IS NOT SAFE ONCE REFUSED ROWS EXIST.** Refused audits persist `grade`/`score` as NULL.
  A Vercel rollback to `main@69b039f` restores `dashboard.ts`'s `grade ?? ''` / `score ?? 0` and would
  render the "Down 81 points since your last visit" fabrication on real rows. Rollback is the normal
  remediation here, so this has to be said out loud (gate 5, R2-NB3).
- **Report a blocker before fixing it** when it lands inside your own prior fix.
- **Background waits: sentinel file, or a `[b]racket` pattern** — `pgrep -f` matches its own command
  line.
- **`CLAUDE.md` stays untracked.** The law is `docs/OPERATING-RULES.md`.
- `nvm use 22`. A fresh worktree has no `apps/web/.env.local`; copy it in or `next build` fails on
  `/api/billing/checkout` — environmental, reproduces on untouched `origin/main`.

---

## 8. Lessons, in plain language

- **A GREEN SUITE IS NOT A GATE.** Gate 4 found four blocking defects and nine surviving mutations with
  engine 844 / web 1426 / inngest 145 / scripts 40 all green, typecheck, lint and `next build` passing.
  The mutation that reintroduces gate 3's blocker verbatim left **1426/1426 green**. Report the suite
  counts as suite counts; never as a verdict.
- **A test written to exclude a property can prove nothing and still pass — check the FIXTURE can make
  it fail.** `sitemap-delta-acceptance.test.ts` asserted two page caps report the same count, on a
  fixture whose declared leaves had no inbound link at any cap, so the cap could never bind. It tested
  the property on the one input class where the property cannot fail, and an acceptance row read MET on
  it. **Ask what input would make this test go red; if you cannot construct one, the test is decoration.**
- **The fix pass is where the next defect is born.** Gate 4's B1 and B2 were both introduced by the
  gate-3 remediation, and both are the same error as the defect they were fixing: B1 re-established a
  default the loader had already decided; B2 reached for the nearest available column instead of the
  number the sentence names. **After fixing an instance of a class, re-run the class over your own diff.**
- **A test fixture the loader cannot produce proves a state the product never enters.** B1's correct
  copy was unreachable in production while its test passed green on `delta: null` — a shape
  `loadDashboardSites` never emits. **Route-level tests must consume the row shape the loader actually
  emits**, not a hand-written one.
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
