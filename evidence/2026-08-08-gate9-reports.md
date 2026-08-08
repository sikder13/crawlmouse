# GATE 9 — FAILED on documentation truth. Shipped behaviour is CLEAN, unanimously.

**Frozen SHA** `b6e046ff4e0cade052b9450adf25d6a13eb313ab` — pushed, 129 commits ahead of `origin/main`.
**Worktrees** `../cm-g9-{1,2,3}`, isolated, detached, independently installed. **Node** v22.23.1.
**Gate-8 baseline preserved** at `347e6e8` in `../cm-g8-{1,2,3}`, per the owner's instruction.

## Scores against the recalibrated bar

| lens | R1 | R2 | R3 | worst |
|---|---|---|---|---|
| correctness | 8 | 8 | 9 | **8** |
| security | 9 | 8 | 9 | **8** |
| deploy-safety | 8 | 8 | 8 | **8** |
| test-quality | 8 | 8 | **7** | **7** |

| bar criterion | result |
|---|---|
| ZERO shipped-behaviour blockers | ✅ **PASS — all three say NONE, explicitly** |
| all lenses ≥8 | ❌ **FAIL** — R3 test-quality **7** |
| ZERO false claims in any committed docstring / evidence / ticket / runbook | ❌ **FAIL — 8 sustained** |

**RESULT: FAILED.** No PR opened.

---

## What is genuinely different this time

**Not one reviewer could find a defect a user can encounter in production.** All three searched for one and all three wrote NONE. R3 measured why: **every production-source change in `347e6e8..HEAD` is comment-only** —

```
git diff 347e6e8..HEAD -- apps/web/lib/audit-view-state.ts \
  'apps/web/app/audit/[id]/AuditSurfaceView.tsx' packages/engine/src/refusal.ts \
  | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-]\s*(\*|//|/\*)' | grep -vE '^[+-]\s*$'
→ (no output)
```

Production state was independently confirmed consistent with the docs: 206/228 rows are v2, `refusal`/`coverage` are written on **0** rows (no backfill), and `completed ∧ grade IS NULL` = **0**, so the rollback hazard is genuinely future-only.

**Two of the three habits are ended.** R1's assessment, measured:
- **#1 completeness-without-reachability — ENDED.** The catalog guard claims nothing about what escapes; the ticket is a running list.
- **#3 unexecuted runbooks — ENDED.** Both production checks re-executed by two reviewers and reproduce byte-for-byte (`[]` for client-executable routines; both tables clean). All five `ROLLBACK-EXEC` rows reproduce independently, including that remedy B does nothing.
- **#2 fixtures-vs-real-runtime — SURVIVES, one radius smaller.** See NB-1.

**The mutation evidence is the strongest on this branch.** R3: *"I re-derived every row from scratch… All nine reproduced to the exact count, in both columns. This is the strongest mutation evidence I have seen on this branch."* R1 additionally invented a mutation neither other reviewer tried — a plausible "skip an unchanged poll tick" memo (`prev.status === next.status && prev.grade === next.grade ? prev : next`, which retains the base payload for a refusal because both fields match) — and it **died 5/10**.

---

## THE FAILING CRITERION — 8 sustained false claims

All eight are in artefacts written in the last two passes. **All eight are one-line documentation fixes; none touches shipped code.** Deduplicated across reviewers, with the adjudication where they differed.

### FC-1 · "View indirection is CLOSED" — FALSE. The closure is NAME-DEPENDENT.
*R2-FC-1, R1-FC-2, R3-F4. R3 initially verified the narrower fact and did not catch this; adjudicated by direct measurement.*

`evidence/2026-08-08-gate9-fix-pass.md:46` — *"View indirection is therefore **closed** and pinned as a committed case"*; the ticket's row 1 marked **CLOSED**; the ticket's title still *"four function shapes it does not cover"*; and its bolded headline *"Measured, all four applied at once: 0 discovered, 0 violations"*.

Measured directly:

```
VIEWNAME frontier_v (the committed fixture): reaper discovered = true
VIEWNAME zone_v (a neutral name):            reaper discovered = false
```

R2 drove it end to end: `create view public.zone_v as select * from public.frontier;` + a `security definer` wrapper granted to `anon` → **suite green, 0 violations, `anon` deleted 2 real rows**, while the direct call to the governed helper was correctly denied.

**The shape is OPEN.** Only the instance whose view name happens to contain the substring is caught. Closure of a *class* was asserted from one *instance* — habit #1, in the commit that deleted the completeness sentences. The ticket's own pick-up list still ranks view indirection as work to do, contradicting the CLOSED row three lines above it.

### FC-2 · The mutation totals are stale, and "Exactly that case, and only that case" is false.
*R1-FC-1, R2-FC-2, R3-F1/F2.*

`evidence/2026-08-08-gate9-fix-pass.md` §1/§2 quote `Tests 1 failed | 31 passed (32)` for three mutations. The shipped file has **33** tests. Re-measured:

| mutation | claimed | measured |
|---|---|---|
| restore the word boundary | `1 failed \| 31 passed (32)` + "only that case" | **`2 failed \| 31 passed (33)`** — R2-B1 **and** view indirection |
| delete the ADP line | `1 failed \| 31 passed (32)` | `1 failed \| 32 passed (33)` — substance holds |
| revert allowlist → denylist | `1 failed \| 31 passed (32)` | `1 failed \| 32 passed (33)` — substance holds |

Measured before the last two cases landed and never re-run against the tree that shipped. §7 of the same file correctly says "29 → 33", so **the file contradicts itself**. This falsifies its own header: *"No sentence in this file ships unless a command in this file verifies it."*

### FC-3 · The arithmetic correction is itself miscounted.
*R2-FC-3, R3-F3. Verified independently.*

`spec51a-frontier-privilege-catalog.test.ts:28` — *"13 committed evasion cases — 1 from gate 4, 5 from gate 5, 7 from gate 6."* Counted at HEAD: **14 `CASES` entries + 1 standalone (`gate 6 N5`) = 15**, of which gate 4 = 1, gate 5 = **4** (R2-A, R2-B, R2-C, R2-G — R2-D lost its gate-5 label when rebuilt), gate 6 = 7, gate 8 = 1, unlabelled = 2. A correction of a miscount, itself miscounted, one radius smaller.

### FC-4 · The rollback remedy's "non-destructive and reversible" is false.
*R2-FC-4, R1-NB-6. Verified against production.*

`spec51a-stage4-migration-runbook.md` §5 recommends remedy C with the undo `update public.audits set expires_at = null`. But `audits/start/route.ts:97` writes `expiresAt = proUser ? null : now + AUDIT_TTL_DAYS`, so **every free/anon audit carries a 30-day TTL**.

Measured live: **190 of 212 completed audits have `expires_at` set**; 22 do not, 12 of those anonymous — the exact state filed as `docs/tickets/2026-08-06-expired-audits-null-expiry-never-deleted.md`. The documented undo would push 190 rows into it, voiding the 30-day retention promise and the ≤18%-MRR TTL control. Non-destructive of *rows*, destructive of the *column*; the undo is not a restore.

### FC-5 · `CURRENT-STATUS.md` — the designated pick-up document — is false at HEAD in five ways.
*R3-F5, R1-NB-10.*

It still says **"Do not start patching until the owner rules on approach"** and presents all six gate-8 blockers as outstanding. Also: *"deleting only `setSnapshot(null)` survives 8/8"* → measured **RED 1/10**; *"§5's sign-off table does not state its basis"* → it does; *"`stream/route.ts:134-135` **still** passes `?? 0` / `?? ''`"* → measured, those lines now read *"NO COERCION — gate 7"*; *"the rollback hazard is not in the runbook §5"* → it is. Plus `web 1546` (now 1552) and 125 commits (now 129).

### FC-6 · The gate-9 sweep table is bounded and does not say so.
*R3-F6.* *"Sweep — gate 8's two survivors and **every earlier evasion**"* over 9 rows. **G7-3** and **G6-a** are absent. G7-3 has a legitimate reason (it is now a `tsc` error, reproduced verbatim at `AuditView.tsx(137,9)`) but the reason is unstated; **G6-a has no reason** — R3 ran it: still caught, RED 2/10, guards RED 3/91. §10: *"If output is bounded, state what was withheld."*

### FC-7 · `sitemapUnreached` is documented in a comment that is LIVE IN PRODUCTION.
*R2 bonus finding.* D4 cut the field (`packages/types/src/audit.ts:162` — *"USED TO LIVE HERE AND IS DELIBERATELY GONE"*), yet `20260804000001_….sql:111` documents the coverage shape as including it and that `comment on column` is live (read back via `col_description`), and runbook §4c selects `coverage->>'sitemapUnreached'`, which will be NULL on every audit forever. Habit #3 in the one section not yet runnable.

### FC-8 · §5 of the operating law cites a query that is not there.
*R1-NB-8.* `docs/OPERATING-RULES.md:113` — *"The query is in `evidence/2026-08-08-gate9-fix-pass.md` §5."* That §5 contains **output only**; `grep -n "select"` returns two prose hits. The tracked law cites a reproduction artefact a reader cannot reproduce from. Related: §5's denominator says 215; live today is **212** (TTL churn — every numerator still reproduces exactly, so the substance stands).

---

## THE HEADLINE NON-BLOCKING FINDING — habit #2, one radius smaller

**NB-1 (R1) — a third survivor exists, and it is reachable in the data.** Not a shipped-behaviour blocker: the shipped code is correct and no user can hit it today. But it is the surviving remnant.

```tsx
// apps/web/app/audit/[id]/AuditView.tsx:136
snapshot={snapshot ? { ...snapshot, crawlHealth: snapshot.crawlHealth?.confidence === 'low' ? null : snapshot.crawlHealth } : null}
```

`apps/web` **208 files / 1552 tests all passed**, typecheck 5/5 0-cached, lint clean. Flipping the fixture's one hard-coded field (`confidence: 'high'` → `'low'`) turns it 4 red and renders gate 3's blocker verbatim.

**Reachability, measured on production: of the 51 audits that would refuse, 13 carry `confidence='low'` and 4 `'medium'` — 33% of refusals sit outside the single row shape the fixture pins.** The fixture also fixes `coverage_pct=1`, `block_rate=0`, `partial=false`, `page_count=2`, one orphan, one finding, one fix, and an anonymous viewer.

**The diagnosis to carry forward:** the *stream* is now the producer's, but the *row shape* is still hand-picked and singular. The remedy is a small matrix of real row shapes — at minimum `{confidence: high|medium|low} × {partial: false|true}` plus a zero-page `nothing_read` row — **not** another case per evasion.

Two related survivors, same cause: **NB-2** `snapshot={done ? snapshot : null}` survives 10/10 because the flash-window test has only negative assertions (it would put a "Cancel audit" button on a finished audit); **NB-4** no stub row carries `crawl_activity`, so deleting `onActivity` from the `wireAuditStream` call is invisible — the live activity feed and the `activity_feed_first_event` funnel signal are unprotected at their only wiring site.

**NB-3** — the stubbed DB returns the whole row regardless of `select(cols)`, so dropping `refusal` from `AUDIT_COLS` leaves *this* file green (it is caught by `refused-route.test.tsx`, 2 red — the seam is covered, just not by the file claiming to be producer-driven).

---

## Other non-blocking, logged not fixed

- **The post-apply control is a denylist while the pre-apply guard is now an allowlist** (R3-2). The runbook query tests only `has_function_privilege('anon'|'authenticated', …)`; a routine executable by some other role — the `reporting_ro` hazard the allowlist was introduced for — returns zero rows. Not exploitable (Supabase issues only those roles) but it is a completeness-flavoured gap in the document whose theme is claiming none.
- **The membership rule carries its own list of role names** (R2-1). `grant postgres to anon` → 0 function violations, 0 table violations, suite green, while handing `anon` everything the owner holds. Caught loudly by the post-apply control (which then returns 8 routines).
- **`ensureCrawleeMemoryHint()` wiring is still unguarded** (all three). Deleting the call leaves engine 837/837 green. Pre-existing, also true on `main`, third gate running.
- **`PLATFORM_SHIM` is safer than production on sequences** (R2-4): production `pg_default_acl` has an `objtype='S'` row the shim does not model. Zero reachable consequence — no migration creates a sequence — but it is B3's direction.
- **Column-level grants evade the pre-apply table rule** (R2-3); the runbook's third query does read `attacl`, verified.
- **`crawl-stall-retries.test.ts` load-sensitive** (R3-5): 836/837 under concurrent load, 3/3 isolated. A real CI would flake.
- **`evidence/2026-08-07-b1-auditview-executable.md` has no correction banner** (R3-3) while its sibling got two; its "None survived" and its counts no longer reproduce.
- **`AuditView.test.tsx:26-27` says `snapshot` is sent "UNCONDITIONALLY"** (R1-NB-5); line 262 is guarded by `if (initial)`. The load-bearing claim still holds. Also cites `:263`; measured `:262`.
- **`SiteCard.tsx:26-31`** claims the card and the result page "can never tell the owner different stories", then the next sentence discloses the gap (R1-NB-11). Generic copy is honest — precision, not fabrication.
- Ticket status metadata stale (R3-6).

---

## Suites — identical across all three reviewers

| package | files | tests |
|---|---|---|
| `packages/engine` | 65 | **837** |
| `apps/web` | 208 | **1552** |
| `inngest` | 8 | **145** |
| `scripts` | 2 | **40** |

`turbo typecheck --force` 5/5 **0 cached** · `turbo lint --force` 4/4 **0 cached**, no warnings · `next build` exit 0, 71/71 static pages. `safe-fetch.ts`, `ssrf-guard.ts`, `middleware.ts` byte-untouched vs `origin/main`. Lockfile diff 6 lines, both devDependencies. Trace-audit clean, single author, no secret-shaped strings.

---

## The class to name, because it is new

Gates 4–8 failed on **guards weaker than their docstrings**. Gate 9 fails on something else: **claims measured at an intermediate state and never re-measured against the tree that shipped.** FC-2 and FC-3 are exactly that — mutation totals taken at 32 tests, an arithmetic correction taken before two cases were added. FC-1 is its sibling: a measurement that was true of the fixture in front of me and false of the class I generalised it to.

The remedy is procedural, not another guard: **re-run every quoted measurement against the final tree immediately before committing the artefact that quotes it**, and never generalise a fixture result to a class without varying the thing the matcher keys on.
