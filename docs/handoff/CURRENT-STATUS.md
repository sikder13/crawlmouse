# SPEC 5.1a — CURRENT STATUS

**Rewritten 2026-08-08 after the gate-10 fix pass.** Pick-up point. Everything is measured or
owner-ruled.

| | |
|---|---|
| Branch | `engine/spec-5-1a` |
| Gate 9 froze at | `b6e046f` (FAILED — documentation truth) |
| Delta gate 10 | dispatched on the SHA this commit creates |
| PR | **NONE yet.** Opens only if the delta gate clears all four checks. |
| Suites | engine **837** · web **1562** · inngest **145** · scripts **40** |
| Baselines preserved | `../cm-g8-{1,2,3}` @ `347e6e8` · `../cm-g9-{1,2,3}` @ `b6e046f` |

**PUSH AFTER EVERY SESSION, RED OR GREEN.** Owner ruling 2026-08-07.

---

## DELTA GATE 10 — 3 of 4 hold. NO PR. Read `evidence/2026-08-08-delta-gate10.md`.

Frozen SHA `f6a54a5`. **(b) PASS** — all three gate-9 survivors die at exactly the claimed counts, and
the other 11 sweep rows reproduce. **(c) PASS** — zero production-source changes (2 tests, 7 docs).
**(d) PASS** — engine 837 · web 1562 · inngest 145 · scripts 40, typecheck/lint 0-cached, build exit 0.

**(a) FAIL — one line.** `docs/tickets/2026-08-07-frontier-catalog-guard-uncovered-shapes.md:18` still
reads *"Measured, all four applied at once: 0 discovered, 0 violations"*; measured at this SHA it is
**1 discovered, 4 violations**. Gate 9 filed FC-1 as three strings — the row, the title and this
headline — and the fix pass corrected two of them. The artifact contradicts its own evidence file.

**★ A FOURTH SURVIVOR, and it is the real decision.**
`snapshot={snapshot && (snapshot.page_count ?? 0) > 4 ? { ...snapshot, crawlHealth: null } : snapshot}`
leaves **1562/1562 green, tsc 0, eslint clean**. Verified independently. Reachability, re-measured:
**12 of the 51 refusals** render the failure card, and **167 of 206 v2 audits** lose the v2 arc. Not a
shipped-behaviour defect — the shipped code is correct — but the fourth consecutive gate whose
surviving finding is in the fixtures.

Every fixture row still has `page_count` of 2 or 0; so too `cms_detected`, `pageCap`, viewer identity,
`link_count`, `estimateSource` (never `'sitemap'`) and the trigger set (never `no_observed_links`,
which is 36 of the 51 real refusals). **Enumerating attributes is the same losing move enumerating SQL
spellings was at gates 4–6.** What ended that class was changing the medium. The analogous move is to
stop hand-authoring row shapes — derive them from real production rows, or property-generate over the
payload's declared type and assert "a refused audit never renders the failure card" across all of
them. That is a design call, not a mechanical fix. **Owner's ruling needed.**

---

## Where this stands

**Gate 9 passed shipped behaviour unanimously** — all three reviewers wrote NONE for
shipped-behaviour blockers, and every production-source change since `347e6e8` is comment-only. It
FAILED on documentation truth: eight false claims, plus R3 test-quality at 7.

**Owner ruling (2026-08-08):** that is a new class and gets a class fix, not a tenth full gate.
Shipped behaviour has now held at the full bar twice unanimously; a tenth full gate would measure its
own recursion. Two permanent rules were adopted into `OPERATING-RULES` §10:

1. **Re-measure every quoted number against the FINAL tree, in the commit that quotes it.**
2. **No matcher-class claim without varying what the matcher keys on** — canonical example
   `zone_v` vs `frontier_v`.

## What this pass did

**The eight false claims, corrected to measured values.** The sharpest was FC-1: "view indirection is
CLOSED" was over-read from one fixture whose view is named `frontier_v`. Measured both ways —
`frontier_v` → discovered, `zone_v` → not — and a reviewer drove the second end to end with `anon`
deleting 2 real rows. **The shape is OPEN**; the ticket now reads 1 closed / 4 open, and both
directions are pinned as assertions so the claim cannot be restated without a measurement.

Also: mutation totals re-measured (word boundary restored → **3 failed | 32 passed of 35**, not the
`1 | 31 of 32` quoted from a mid-pass run); the case arithmetic re-counted (**15**, not 13 — gate 5 is
4, and the gate-7 "correction" was itself wrong); the rollback undo corrected (it is **NOT** reversible
as written — `expires_at = null` would permanently exempt **190 of 212** production audits from TTL
cleanup, so a snapshot table is now mandatory or the remedy is one-way); the `sitemapUnreached`
residue removed from the runbook and the live column comment filed as an owner-applied migration
ticket; the sweep table now reports all 14 rows and states why G7-3 is absent; and §5 now carries the
query itself rather than a citation to prose.

**The row-shape matrix — the class fix for the third consecutive fixture finding.** The replay suite
runs over `{high, medium, low} × {false, true}` refused rows, a zero-page `nothing_read` row, and a row
carrying a real `crawl_activity` ring. All three gate-9 survivors now die: the confidence-conditional
`crawlHealth` null (**3/18**), the done-gated snapshot (**1/18**, via a new *positive* assertion), and
the `onActivity` delete (**1/18**).

**Constraint held: zero production-source changes.** `git diff b6e046f..HEAD` touches 2 test files and
7 docs, nothing else.

## Still open, logged not fixed

- View indirection with a neutral view name; dynamic SQL; cross-schema wrapper; `prokind='p'` — 4 open
  shapes, all caught by the name-free post-apply runbook control, all a running list not a bound.
- The post-apply control is a grantee **denylist** (`anon`/`authenticated`) while the pre-apply guard is
  now an allowlist — a role like `reporting_ro` returns zero rows there. Not exploitable (Supabase
  issues only those roles).
- `ensureCrawleeMemoryHint()` wiring unguarded — deleting the call leaves engine 837/837 green.
  Pre-existing, also true on `main`, flagged at three gates.
- `crawl-stall-retries.test.ts` load-sensitive: 836/837 under concurrent suites, 3/3 isolated.
- `evidence/2026-08-07-b1-auditview-executable.md` has no correction banner; its "None survived" was
  falsified by gate 8 and its counts no longer reproduce.
- `docs/tickets/2026-08-08-sitemap-unreached-column-comment.md` — needs a small owner-applied migration.

---

---

## Gate 7 — FAILED, five blockers, three treatments (owner ruling 2026-08-07)

Frozen SHA `f3a501bf5e62858f68888c014673bcad0bd688a2`. Scores: R1 5/8/8/5 · R2 8/7/9/7 · R3 8/7/9/6,
two blocking each. Full reports in `evidence/2026-08-07-gate7-reports.md`.

### ✅ DONE — the two MUST-FIX blockers (commit `54c9328`, pushed)

**B3 — the `pg_default_acl` gap.** The most serious finding of the gate, because it failed in the
UNSAFE direction. Production creates every new function with explicit `anon=X`/`authenticated=X` and
no PUBLIC entry (migrations run as `postgres`); stock Postgres does the opposite. The PGlite sandbox
was therefore STRICTLY SAFER than production, so narrowing a revoke to `from public` — the spelling
the migration's own header calls out as dangerous — passed GREEN while leaving `anon` holding EXECUTE
on the row-deleting RPC live. Fixed with three `alter default privileges` lines in `PLATFORM_SHIM`,
plus the mistake as a permanent test.

That needed a harness change worth knowing about: **appending SQL cannot model a migration being
WRONG**, because the correct statements have already run. `applyAllMigrations` now takes an edit hook,
so the narrowed revoke and the deleted table revoke are exercised as the migrations themselves being
wrong, with an unedited-migrations case beside them as the anti-vacuity control.

**B4 — a refusal could crash the primary page.** `graded` was gated on `hasResults`; `refused` was
not. On the `buildDone`-threw path the last snapshot is the BASE `ClientAudit` with no `findings`, and
`asClientAuditV2` casts on `crawlHealth != null`, so `ResultView` threw
`TypeError: Cannot read properties of undefined (reading 'filter')`. On `main` the same path degraded
to the "couldn't grade" card. `refused` now carries the same terminal-payload requirement as `graded`,
pinned by a property test asserting the two move together rather than by two examples.

---

## GATE 7's FIVE ITEMS — ALL DONE (kept for the rulings they record)

> **✅ All five are complete and pushed** — `e399984`, `413ba0e`, `266ac98` (B1) · `a9c6cec` (B2) ·
> `c24c67b` (B5) · `af7f9b5` (§5 amendment) · plus `42fba86`, `55a19e8`, `a387c92`, `938f435`, `347e6e8`
> closing six non-blocking gate-7 items. **Gate 8 then failed on the fixes themselves — see above.**
> This section is retained because it carries the owner's rulings, not because work is outstanding.

### The five, as they were ruled

### 1. B1 — make `AuditView.tsx` executable (jsdom + stubbed EventSource)

**Owner ruling:** *"R2's finding is the real one: an unconditional throw at module scope leaves
1517/1517 green, so the file is NOT IN THE TEST GRAPH. That is why five evasions survived — not a
design failure. Fix it with test infrastructure. Then re-run gate 6's and gate 7's evasions against
it. If any still survives with the file executable, STOP and report — that would be a genuine design
finding rather than a coverage gap."*

The diagnosis is settled: `AuditView.tsx` is imported by `page.tsx` alone and by **no test**. Three
edits to its props restore gate 3's blocker with the whole suite green and `tsc` clean — one of them
an ordinary `Pick`-narrowing refactor that the file's OWN comment names as the hazard.

**Do it PER FILE** (`// @vitest-environment jsdom` in a new `AuditView.test.tsx`), **not globally** —
200+ existing `.tsx` tests render through `renderToStaticMarkup` and a global jsdom switch risks them.

Evasions to re-run once the file executes (all currently survive):
- `snapshot={snapshot ? { ...snapshot, refusal: null } : null}`
- `snapshot={snapshot ? { ...snapshot, crawlHealth: null } : null}`
- a `Pick`-style narrowing props object omitting `refusal`
- gate 6's four: additive branch, body swap, mutated fed state, nulled `v2` (these die already inside
  the three new modules — confirm they still do from the top)

Consider also making `AuditSnapshotLite.refusal` **non-optional**, so the compiler objects to the
narrowing refactor rather than relying on a test to notice.

### 2. B2 — correct the catalog guard's claim; do NOT chase completeness

**Owner ruling:** *"Your recommendation is right: document the limit rather than make a fourth
completeness claim. My live post-apply verification stays the runbook standard and already catches
what this cannot. A guard with an honest limit beats a guard with a false claim."*

Rewrite the docstring in `apps/web/__tests__/spec51a-frontier-privilege-catalog.test.ts` and the
commit message to state exactly what is covered — **functions whose reachability is visible via
`pg_depend` or `prosrc`** — and name the four uncovered shapes:

- view indirection (a `security definer` fn deleting from a view over `frontier`)
- dynamic SQL (`plpgsql`, name concatenated)
- cross-schema wrapper (helper in `util`, wrapper in `public`)
- `prokind = 'p'` — procedures are dropped by an undocumented filter

File them as a ticket. Each was proven end to end by deleting real rows as `anon`.

**Two more gate-7 findings in the same file, still open:**
- the `gate 5 R2-D` case is **vacuous** — `alter default privileges` alone yields 0 violations; the
  case passes only on its second statement, which duplicates `EV-A`
- the table-posture rule has **no negative control**; it asserts the clean state only

Also correct the coverage arithmetic in commit `15628ca`'s message: it claims "all six from gate 4,
all seven from gate 5" as committed cases; the file has 13, of which 1 is gate 4 and 5 are gate 5.
(The mechanism does catch the others — that is a different and true claim.)

### 3. B5 — ORPHAN-UNDER-CAP: correct the evidence, file the ticket, do NOT block on it

**Owner ruling:** *"5.1a does not fix a pre-existing defect it did not create. The mechanism pre-dates
this branch and 5.1a makes it BETTER, not worse — stratification reaches hubs the old frontier never
did, and the refusal gate catches the worst cases. Blocking here would mean 5.1a never ships to fix a
defect main already has. BUT the false evidence claim is not acceptable."*

Two actions:
- **Correct `evidence/2026-08-07-gate6-reports.md`** where it states *"The D4 CLASS is gone from the
  surviving findings."* It must say the fixtures **could not reproduce** the class (their hubs fit
  inside the budget), not that the class is absent.
- **File ORPHAN-UNDER-CAP as the TOP 5.1b item**, with the measurement: WordPress shape — sitemap
  declares posts, `/page/N` archives undeclared, every post linked from its archive, **zero orphans by
  construction** — 5,501 pages, **cap 500 → 105 critical `orphan` findings, C/62.97; cap 2000 → 0,
  B/79.28.** Sixteen grade points from our own budget. Also `audit.ts:449-452` asserts the opposite in
  a comment and needs correcting.

*The object of the complaint was never the code — it was an evidence file claiming a class absent when
the fixtures could not reach it. Carry that distinction into 5.1b.*

### 4. §5 amendment — RULED. Amend the tracked file.

**Owner ruling, verbatim in substance:** `docs/OPERATING-RULES.md` §5 currently says grade-changing
stages *"require explicit sign-off against a before/after panel (SPEC 5.1 §10)"* and *"none merges
without that sign-off."* B15 (the panel) is deferred to 5.1b, which is a conflict with the tracked
law that was disclosed nowhere.

**The amendment:** a full before/after panel is required for **RE-CURVING** — changing where band
boundaries fall, which is 5.1b's work and where expert judgement is the only evidence. It is **NOT**
required for **CATEGORICAL WITHHOLDING**, where the change is *"we decline to assert a letter when the
evidence cannot support one"* and the sign-off evidence is the measured trigger counts. **5.1a is
entirely the second kind.**

**The owner's sign-off is given, against the measured merge impact: 51 of 215 audits lose their
letter, by trigger** — already produced. Amend §5 in the tracked file with that distinction and this
ruling as its justification.

*(Surfacing this rather than resolving it was correct per §2/§11. It was in the tracked law the whole
time and should have been found before gate 7.)*

### 5. Then: verification → trace-audit → push → GATE 8 → PR

Verification **in order**: `pnpm test` per package (⚠ turbo's cache is shared across sibling
worktrees and `pnpm test --force` silently no-ops — use `npx vitest run` inside each package) →
`typecheck` **after the final commit** → `lint` **before** `next build` → `next build`.

Then trace-audit, push, **gate 8** on a fresh frozen SHA in isolated worktrees, ≥9 all lenses, 0
blocking, artifacts committed **and pushed** per the §5B standing rule.

**If gate 8 clears, open the PR and give the owner the URL. The owner verifies it on the remote before
any merge-go.** If gate 8 finds a blocker in a file that is now executable and catalog-asserted,
**report it and stop** — that is new information rather than another radius.

---

## Smaller items still open (from gate 7, none blocking)

- `hasPredecessor` has **no loader→card test**. Setting it `false` leaves 1517/1517 green and makes
  every card say "First audit"; inverting it is also green. The field the whole B6-1 fix rests on.
- `const hasResults = true` in `AuditSurfaceView` survives the suite and restores the permanent
  0-orphans/0.0-depth card. *(May be closed by item 1's jsdom work — re-check.)*
- Handoff §1 says **"Gate 6 pending"** at a SHA where gate 6 failed, and there is no §5C or §5D for
  gates 6 and 7. §1 still reads **web 1492** (measured 1523). §6A item 7 omits
  `docs/tickets/2026-08-07-attempted-count-not-persisted.md`. §6A item 8 cites `OPERATING-RULES §104`;
  the file has §1–§11 and the rule is **§7**.
- `AuditSurfaceView.test.tsx` docstring claims a duplicate `case` is *"a compile error"* — measured
  `tsc` 0 / `eslint` 0; it is caught by **execution** (5 red). Protection real, stated reason false.
- Two counts in `15628ca` do not reproduce: "10 red" measured **11**; "1 red" measured **3–5**.
- `stream/route.ts:134-135` still passes `?? 0` / `?? ''` into `reconstructConversion`, unreachable
  only because `projected_score` is NULL for a refusal — one guard, not source-level withholding.
- The **rollback hazard** (once refused rows exist, a rollback to `main@69b039f` re-renders the
  "Down 81 points" fabrication) is recorded in the handoff and gate-5 evidence but **not** in
  `docs/deploy/spec51a-stage4-migration-runbook.md` §5 "Rollback" — the document an operator actually
  opens — nor in §6A.
- `crawl-stall-retries.test.ts` is load-sensitive: 836/837 under concurrent suites, 3/3 in isolation.
- **This repo has no CI** (`.github/workflows` absent). The catalog test costs ~44s, a local-gate cost.
- `@electric-sql/pglite` is used from `apps/web` but declared only in the ROOT `package.json`
  devDependencies (pre-existing practice; lockfile byte-identical to `main`).

---

## The pattern to carry forward

Gates 4, 5, 6 and 7 each failed, and **each fix pass introduced or left a defect of the same class it
was fixing**, one radius smaller: the RPC guard carried its filenames → its naming convention → its
body syntax → its "the table's literal name appears in the body"; the refusal render decision moved
from JSX → the branch body → the decision's inputs → the props of the one file no test loads.

Two things ended classes outright rather than shrinking them, and both were **medium changes, not
better matchers**: replacing the SQL source matcher with a catalog assertion, and moving the render
decision out of JSX into a pure function plus an executable map. Item 1 is the third of these.

**And the standing rule from the merge-go incident:** every gate or PR claim must carry its
artifacts — frozen SHA, reviewer report paths, PR URL. A gate result without them is an assertion.
