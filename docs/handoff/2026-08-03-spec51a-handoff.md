# Crawlmouse — SPEC 5.1a handoff

**Written 2026-08-03 for someone with zero context.** Read this top to bottom before touching
anything. It should be enough to resume without archaeology.

Orientation, if you have read nothing else: **`docs/OPERATING-RULES.md`** (the tracked operating law —
read it and follow it), **`PROJECT_OVERVIEW.md`** (what the product is, the architecture, infra IDs),
**`docs/specs/00-crawlmouse-master-build-plan.md`** (the phase plan), then
**`docs/specs/05_1-engine-honesty-spec.md`** (the active spec). All four are now tracked in-repo.

---

## 1. Where the work is

| | |
|---|---|
| Branch | `engine/spec-5-1a` |
| Worktree | `/home/udsik/nahl-clients-projects/crawlmouse-51a` |
| HEAD | `8703ef4` (before the handoff commit) |
| Base | `origin/main` = `69b039f` |
| Commits ahead | 33 |
| **Pushed?** | **NO. Nothing pushed, no PR, no merge.** |
| Working tree | clean except untracked `CLAUDE.md` (deliberate — see §6) |
| Helper worktree | `/home/udsik/nahl-clients-projects/crawlmouse-base` — detached at `69b039f`, used as the backtest's base engine. Keep it. |

**Environment:** `nvm use 22`. A fresh worktree has no `apps/web/.env.local` (gitignored), so
`next build` fails there on `/api/billing/checkout` — copy it in from an existing checkout. That
failure is environmental, not a branch regression; it reproduces identically on untouched `origin/main`.

**Verification order, every time:** `pnpm test` → `pnpm typecheck` **after the final commit** →
`pnpm lint` **before** `next build` → `next build`. All four were green at `8703ef4`
(engine 57 files / 759 tests, web 197, inngest 8, scripts 2).

---

## 2. THE INVERTED CONTRACT — read before judging any result

Every prior spec held grades byte-identical. **SPEC 5.1 deliberately changes grades. That is its
purpose.** Stages marked `[GRADE-CHANGING]` measure and report their delta; none merges without owner
sign-off against a before/after panel (§10, which lives in 5.1b). **A grade change is not a
regression.** Do not try to avoid one, and do not tune a constant to shrink a delta — a delta you
dislike is a finding, not a bug.

The gate is **attribution, not identity**: for each movement, name the stage and the mechanism.
`Δ = 0` is not a pass; an *unexplained* Δ is the only fail.

---

## 3. What shipped, stage by stage

### Stage 0 — verify and plan ✅
Every spec reference checked against the live repo; 17 spec/code mismatches recorded. Evidence
re-derived from production rather than trusted: E1 confirmed **larger** than filed (duskroute.com, ten
runs not nine, all at exactly 500 pages, 32.88 → 88.89).

### Stage 0.5 — re-axis the backtest ✅ (blocking, and it was)
The old harness crawled **once** and graded that output under v1 and v2, so its axis was the *grading*
half. Every crawl-half change cancels out of that diff. **Measured, not argued:** the same two engine
builds differ by 2.47 points and three pages, and the old axis reports **Δ0.00 for both**.

The harness is now **base engine vs head engine** (`--mode=ab`, needs `--base-engine=<path>`), plus
`--mode=repro` (same engine twice). It reports crawl **composition** and the §6.7 **strata delta**, and
distinguishes *grade moved on an identical sample* (engine change) from *grade moved with the sample*
(explained input change). `--urls=` bypasses the database entirely.

### Stage 1 — crawl integrity (§4) ✅
Robots is now **one gate** (`isUrlAllowed` in `robots.ts`) on all four entry paths — link, sitemap
seed, redirect target, `rel=canonical` target. Exact-hostname origin (the `a.com.evil.com` bypass fails
closed). Strip-list extended (session tokens + modern click IDs; **`sid` deliberately excluded** —
it is a content param on forum software). Trap caps in `crawl-traps.ts`.

**Measured effect: ZERO** — 0 of 40 927 page rows collapse, 0 excluded by trap caps. The instrument was
proven live first and confirmed independently in SQL. It is forward-looking insurance, not a fix for
anything observed, and is reported that way.

Also fixed: a robots-refused redirect was retried 5× for one deterministic verdict. Crawlee's
non-retryable class does **not** work from inside a got hook (got wraps it; class identity is lost) —
the working layer is `request.noRetry` from Crawlee's `errorHandler`, matched by walking `error.cause`.

### Stage 2 — page classification (§5) ✅ `[GRADE-CHANGING]`
URL rule table (segment equality, never substring; every rule has a positive **and** a negative
fixture), CMS overlay folded in through the same entry point, `noindex` from meta **and** the
`X-Robots-Tag` header, thin gate at `MIN_GRADEABLE_TEXT_CHARS = 80` (**chars, not bytes** — a byte gate
discriminates by script), SimHash k=3 dedup.

**M9 population split (owner-ruled):** excluded pages leave the gradeable **population** (numerator
*and* denominator) but **stay in the graph** as connectivity nodes. Both halves pinned, including the
counterfactual showing the article *would* be a false orphan if the archive left the graph.

**Measured delta on composition-stable sites: +0.00 to +3.22, no letter changed.** I predicted *down*
and got *up* — the numerator dominated (168 over-optimized-anchor findings about tag archives vanished).
**Do not read this as "classification raises grades":** the panel lacks the shape that should fall.

Parse-time signals are **ungated** and share one main-content extraction with the AI path — if
classification read AI-gated signals, the `AI_READINESS_EXTRACTION` kill-switch would silently change
every grade.

### Stage 3 — deterministic stratified frontier (§6) ✅ selector; ⚠ wiring blocked
Stratum keys (`template-key.ts`, context-free because I6 forbids the frequency rule), the selector
(`analysis/frontier.ts`), the §6.7 fingerprint, and the **B6 gate against a FIXED DISCOVERED SET** — no
crawl, no host, no clock. That location is forced: a budget-bounded crawl discovers as far as the remote
host's latency allows, so a live run can neither prove nor disprove determinism.

**M6 — an I1 violation independent of the frontier, and deeper than predicted.** I argued
`hubConcentration` was safe because "a sum is order-free". **False** — floating-point addition is not
associative, so PageRank iterated in a different node order returns different ranks (0.9727594706314373
vs 0.972759470631438), feeding 0.6 of the structure component. Fixed at the source: graph nodes insert
in canonical-URL order, plus explicit tie-breaks.

**Boundary-flip check (owner-ruled):** 212 audits, **0 organic scores within 0.005 of a letter
boundary, 0 within 1e-12**. The 42 rows at exactly 60.00 cannot move either — the letter derives from
the already-2dp-rounded score. **No flip is reachable.**

### Stage 3b — wiring, fixture, live delta, migration ⚠ BLOCKED
3b.1 (wiring) and 3b.2 (M5 fixture) landed; 3b.4 (migration) is written and awaiting the owner.
**3b.3 found a blocker in the 3b.1 wiring — see §4.**

The migration is `infra/supabase/migrations/20260803000001_spec51a_crawl_fingerprint.sql` with runbook
`docs/deploy/spec51a-fingerprint-migration-runbook.md`. **Owner-applied only. Not yet applied.**

---

## 4. THE OPEN BLOCKER — batch bounding (do this first in Block 2)

Full write-up: `evidence/2026-08-03-stage3b-frontier-throughput-blocker.md`.

**Symptom:** on the live panel, `info.cern.ch` went **123 → 24 pages**. Three other sites were healthy
(`racedays.run` *gained* 80 pages).

**The fingerprint found it:** `selected=161` against 24 actually fetched — a discrepancy invisible
without the §6.7 instrument.

**Mechanism, measured per round:**
```
ROUND batch=23   fetched=23   took=7.2s
ROUND batch=136  fetched=0    took=51.9s   hitBudget=true   ← 52s, ZERO banked
```
`runDeterministicLevels` hands up to the *entire remaining budget* to one `runWithWallClock` call, so a
wall-clock stop discards everything in flight. The incumbent's level-by-level structure was accidentally
protective — small commitments, progress banked between deadline checks. Replacing it removed that while
staying perfectly deterministic, so **no test noticed**.

### Owner ruling — the fix
- **CONSTANT batch size.** A throughput-derived batch puts timing into *when the budget stops*,
  reintroducing exactly the nondeterminism Stage 3 exists to remove.
- Constant lives in `constants.ts` **with a comment stating why it is constant.**
- **Bank progress between rounds**; re-select from the remaining frontier each round.

### Mandatory in the same pass — close my own fixture gap
`crawl-frontier-budget.test.ts` cannot catch this: its loopback server is fast. The new fixture needs
**a slow host and a wall clock expiring MID-BATCH**, and must go **RED on the current 3b.1 wiring** by
showing pages *selected but not banked*. **Mutation-verify** by restoring the unbounded batch. Also pin
that banked progress is **deterministic**: same corpus, same seed, same budget ⇒ same banked set.

---

## 5. Stage 4 — RE-SCOPED (owner-approved 2026-08-03)

**Read `docs/tickets/2026-08-03-production-honesty-defect-inventory.md` first.** A systematic sweep of
the live corpus found **64 of 212 completed audits (30.2 %) would change verdict**, and seven classes
SPEC 5.1 does not cover.

**Stage 4 is now "Coverage accounting AND REFUSAL", not just coverage accounting.** D5 and D6 are not
coverage problems — no count makes a letter honest when we read nothing or saw no edges.

### One refusal gate, four categorical triggers
| trigger | condition | rows |
|---|---|---|
| too few pages | `gradeable < MIN_GRADEABLE_PAGES` | 39 |
| nothing read | `fetchedOk == 0` | 4 |
| **nothing observed to grade** | **zero edges among gradeable pages** | **34** |
| coverage unknowable | `estimateSource='none'` ⇒ `coverageRatio` null ⇒ confidence cannot be high | 22 |

All four are facts about the *evidence*, not judgements about the site — so none needs the 5.1b panel.
The calibrated coverage-**ratio** threshold stays in 5.1b.

### The class-level rule (owner ruling)
> **ABSENCE OF EVIDENCE MUST NEVER READ AS EVIDENCE OF QUALITY.**

`40 + 20 + 20 + 8 = 88.00` happens because every ratio component defaults to **perfect** on an empty
input set. **Pin it as a property test: no component may score at or near maximum when its input set is
empty or its denominator is zero.** That stops the next ratio-based component inheriting it.

**A4's JS-suppression STAYS** — correct for its purpose. It must be **paired with refusal, not
removed**. `provion.io` B+/82 vs `rewardguru.in` D−/42.53 (both ~77 pages, both 0 links) is a 45-point
swing on whether a heuristic fired: suppression acting as *enhancement*.

**Also in Stage 4:** D4 — the sitemap-delta must surface as a **leading finding**, not just a count
(§7.2's exact case; we printed a letter instead).

**Report** how many of the 209/212 historical audits change verdict under D1–D3.

### Two things Stage 4 must carry (owner-ruled 2026-08-03, full reasoning in `evidence/2026-08-03-stage3b-stall-economics.md` §6)

**A higher page count is NOT better coverage.** The incumbent's 123 pages on `info.cern.ch` were not 123
*representative* pages — they were 123 **fast** pages. Level-sorted truncation never selected the site's
slow corners; the stratified frontier selects them on purpose. So "123 vs 24" compares two different
things. **Coverage accounting must never treat a higher page count as better coverage** — that is the E1
non-monotonicity in another costume (E1 held the count constant at 500 while the grade swung 56 points,
because composition decides what a crawl means, not count). A count-based coverage metric would score
the honest crawl worse than the flattering one.

**Known residual — latency is a systematic sampling bias.** Slow sections cost more budget per page, so
under a fixed wall clock a page's chance of being banked falls with its server's response time. The
sample is biased *against* slow sections even after stratification makes selection unbiased:
stratification fixes which URLs are *offered*, not which the clock lets *finish*. **Not corrected in
5.1a, by instruction** — recorded so it is not rediscovered as a surprise, and so no coverage-quality
claim is made without it.

### Deferred to 5.1b, do not build now
- §9.8 widens from "null improvement" to **"immaterial or negative"** (D7: 4 negative projections,
  `eyondo.com` A−/88.29 → B+/80.33; D8: a third of all projections promise the same band or < 1 point).
- The Opportunity card must not render as an opportunity when the projected band equals the current one.
- `genericAnchorFraction` population change is on the calibration list — its measured delta was **zero**,
  which is *weak* evidence, not validation (the metric sits behind a 0.2 threshold no panel site crosses).

---

## 6. Standing rules (not preferences — several were learned expensively)

- **TDD.** Failing tests first, encoding the acceptance criteria.
- **Every test must be capable of failing.** Mutation-verify: revert the fix, prove a *named* test goes
  red. **Prove the harness is live with an unconditional throw first** — I once reported three mutations
  as "survived" when my grep filter was broken by ANSI colour codes.
- **Never `git checkout --` to revert a mutation** — it has destroyed uncommitted work here. Use `cp`.
- **Agreement is not correctness.** Pin at least one assertion against independently computed truth.
- **Never squash.** Full history. Squash-merge is now **disabled** on the repo (owner-confirmed).
- **Trace-audit before every push:** no coding-assistant references anywhere, no authorship trailers,
  single author, plus a secret-shaped-string scan.
- **Migrations are owner-applied only**, via runbook, dry-run first.
- **Never push to `main`, never self-merge, no merge without explicit owner approval.** After any merge,
  confirm the Vercel production deployment reaches READY and verify on production.
- **Report a blocker before fixing it** when it lands inside your own prior fix. That pattern cost
  SPEC 05 four extra rounds; the remedy is to change approach, not to patch again.
- **`pnpm smoke` is NOT a deployed-function smoke** — it runs in-process and defaults to v1.
- **Background waits: use a sentinel file, or a bracket pattern (`[b]acktest`).** `pgrep -f` matches its
  own command line, so a waiter greping for its own pattern never exits. Three accumulated before this
  was caught.
- **`CLAUDE.md` stays untracked** — deliberate across the whole project history. It is a thin pointer;
  the law lives in `docs/OPERATING-RULES.md`.

## 7. Lessons from this branch, in plain language

- **Measure, don't reason, when a number is cheap to get.** I argued "a sum is order-free" and the test
  proved floating-point addition isn't associative. I predicted classification would lower grades; it
  raised them. I assumed `NonRetryableError` would stop retries; the test showed 5 requests.
- **A zero result needs its instrument proven first.** Stage 1's canonicalisation effect was zero — I
  proved the comparison could detect a difference *before* believing it, then confirmed in SQL.
- **A surviving mutation may mean a weak mutation.** M14 survived because it filtered a *result* rather
  than the *walk*. The sharper mutation killed two tests immediately.
- **Determinism is not representativeness.** The M5 fixture's "same page set twice" assertion **passes**
  on the incumbent while "reaches the small strata" fails. Reusing the old determinism tests would have
  certified the bug.
- **Boundary tests find real defects.** `'a'.repeat(11)` is all hex characters — which exposed that
  `facade`, `decade` and `deadbeef` were being keyed as opaque ids.
- **Fix the class, not the instance.** Three raw NUL bytes were found in one session, two of them in the
  ticket *about* raw NUL bytes. That is the argument for the repo-wide guard the ticket proposes.

## 8. Pointers

- Defect inventory: `docs/tickets/2026-08-03-production-honesty-defect-inventory.md`
- Open blocker: `evidence/2026-08-03-stage3b-frontier-throughput-blocker.md`
- Stage evidence: `evidence/2026-08-03-stage{1,2,3}-*.md`, `evidence/2026-08-03-stage3-carry-forward.md`
- Migration + runbook: `infra/supabase/migrations/20260803000001_*.sql`, `docs/deploy/spec51a-*.md`
- Open tickets: `docs/tickets/2026-08-03-raw-nul-byte-in-anchor-source.md` and the pre-existing set
- Reproduce any measurement: each evidence file ends with its exact command.
