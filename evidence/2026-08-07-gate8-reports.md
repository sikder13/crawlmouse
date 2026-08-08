# GATE 8 — FAILED. Six blocking findings, and the class survived a sixth time.

**Frozen SHA** `347e6e8ed07b76c860de7b81ea53c71239d26ce3` — pushed to `origin/engine/spec-5-1a`,
125 commits ahead of `origin/main` (`69b039f`).
**Worktrees** `../cm-g8-1`, `../cm-g8-2`, `../cm-g8-3` — isolated, detached at the frozen SHA, each
with its own `pnpm install`. **Node** v22.23.1. Three independent reviewers, no self-review pass.

## Scores — gate requires ≥9 on every lens and 0 blocking

| lens | R1 (correctness) | R2 (security/deploy) | R3 (test-quality/truth) |
|---|---|---|---|
| correctness | **6** | 8 | 8 |
| security | 8 | **6** | 8 |
| deploy-safety | 8 | **7** | 9 |
| test-quality | **6** | 8 | **6** |
| blocking | 1 | 3 | 3 |

**RESULT: FAILED.** Seven blocking findings raised, **six sustained** (one is adjudicated below as not
a defect). Suites measured independently by all three: engine **837** · web **1546** · inngest **145** ·
scripts **40**; typecheck 5/5 and lint 4/4 forced/uncached; `next build` exit 0 (R1, R2).

---

## THE HEADLINE: the recurring class survived a sixth consecutive gate — inside the fix for it

`CURRENT-STATUS` names the pattern: *each fix pass introduced or left a defect of the same class it was
fixing, one radius smaller.* Gate 8 says it happened again, in three separate places, and **all six
sustained blockers land inside this session's own fix pass.** Nothing from before this session was
found blocking.

- The B1 fix put `AuditView.tsx` into the test graph — verified by all three — and then asserted it
  with **fixtures the product never produces**.
- The B2 fix replaced a false completeness claim with a **narrower claim that is also false**, and
  leaned on a compensating control **that was never measured**.
- The B2 evidence file reported a mutation result as a **two-row table that omitted four other reds**.

---

## BLOCKING — R1

### R1-B1 · gate 3's blocker is still restorable from `AuditView.tsx`, via the state transition the new test never drives

`apps/web/app/audit/[id]/AuditView.test.tsx` (the gap) · `AuditView.tsx:79`, `:131` (the edits) ·
`evidence/2026-08-07-b1-auditview-executable.md:10` (the false claim).

**Every test in the new file drives a stream of length one** — `mount()` then a single `emit('done', …)`,
or a single `progress` + `error`. The one thing `setSnapshot` does — *replace the previous payload* — is
never asserted, because no test ever sends a second payload for the same audit id. Two edits survive:

- **E-A** `onSnapshot: (payload) => setSnapshot((prev) => prev ?? (payload as Snapshot))`
- **E-B** `const viewSnapshot = useMemo(() => snapshot, [snapshot?.id]);` + `snapshot={viewSnapshot}` —
  an ordinary memoization refactor with an incomplete dependency array. `react-hooks/exhaustive-deps`
  cannot catch it: `next lint` prints *"The Next.js plugin was not detected in your ESLint configuration."*

Both measured at `208 passed / 1546 passed`, `tsc` 0, `eslint` 0.

**Production reachability, proven not argued.** `stream/route.ts:263` sends `snapshot` **unconditionally
on every connection** before any `done`; `:289` sends `progress` on every poll tick before `:292` emits
`done`; even the already-completed short-circuit at `:266-270` sends `snapshot` *then* `done`.
**The single-`done` stream the new test asserts is a shape the product never produces.** Under the real
order, a refused audit renders gate 3's blocker verbatim — the invented cause, "contact support",
`text-warning`.

This is the defect `refused-route.test.tsx`'s own gate-4 header names — *"a fixture that outruns its
loader proves a state the product never enters"* — reappearing inside the file written to close it.

**Fix is small and the medium is right:** drive the real event order (`snapshot` → `progress` → `done`)
in the refused and graded cases. R1 confirmed in a scratch replay that both mutants die once it exists.

---

## BLOCKING — R2

### R2-B1 · a FIFTH uncovered shape, and its reference IS in the body

`spec51a-frontier-privilege-catalog.test.ts:88-90`, `:179`, `:185`.

The header rewritten at gate 7 says: *"What escapes is a reference that is not in the body at all — the
four shapes above. **That is the whole of the gap, and it is measured rather than asserted.**"* False.

A **same-schema `SECURITY DEFINER` wrapper in `public` calling the already-governed
`public.delete_orphan_frontier_rows`** escapes. It is none of the four — no view, static SQL, same
schema, `prokind='f'` — and its reference *is* in the body, the one case the sentence says cannot
escape. Cause: `prosrc ~* '\m(frontier|frontier_politeness)\M'`, and `_` is a word character in
Postgres ARE, so `delete_orphan_frontier_rows` never matches `\mfrontier\M`. Predicate (3) reads only
the new function's own name.

```
discovered: claim_frontier, delete_orphan_frontier_rows, settle_frontier_batch, upsert_frontier_batch
VIOLATIONS: (none)   <<<< GUARD GREEN
E2E as anon: returned 2 | frontier rows before=2 after=0
control — anon calling delete_orphan_frontier_rows directly: DENIED: permission denied
```

The control proves the wrapper is the entire escalation. The hostile migration is four lines.
**Fix:** drop `\m…\M` from predicate (2), or delete the completeness sentence and add the shape.

### R2-B2 · the compensating control the owner's ruling rests on does not compensate

`docs/tickets/2026-08-07-frontier-catalog-guard-uncovered-shapes.md` + the test header claim the
post-apply runbook check is *"shape-agnostic … so it catches all four."* Measured false. The only
`pg_proc` query in `docs/deploy/` (`spec51a-stage6-frontier-functions-runbook.md:97-107`) filters
`p.proname in ('claim_frontier','delete_orphan_frontier_rows','settle_frontier_batch','upsert_frontier_batch')`
— a **hardcoded list of four names**, which is the "carries its own list" defect the source matcher was
killed for at gate 4.

Run with five hostile anon-callable routines present, it returns the same four clean rows and sees none
of `reap_dyn`, `reap_proc`, `reap_view`, `reap_wrap`, `reap_xschema`.

**This is the load-bearing half of the gate-7 ruling** — the limit was accepted *because* the live
post-apply check covered it. It does not. **Fix:** drop the `proname in (…)` clause; posture-check every
`public` routine with `prokind in ('f','p')`.

### R2-B3 · the rollback remedy added this session is wrong, and destroys the diagnostic

`docs/deploy/spec51a-stage4-migration-runbook.md` §5.

The **hazard statement is correct** — R2 verified it by driving `main@69b039f`'s real
`loadDashboardSites` + `deltaSentence`:

```
{"currentGrade":"","currentScore":0,"scoreDelta":-81.39,"gradeFrom":"B","gradeTo":""}
RENDERED: Down 81 points since your last visit — worth a look
```

The **remedy is wrong.** §5 offers "roll the SQL back too … pre-5.1a code treats a grade-less completed
audit as ungradable". But `main@69b039f:apps/web/lib/dashboard.ts:140` never selects `refusal`
(`git grep -c refusal 69b039f -- apps/web` → one unrelated hit), so dropping the columns changes the
dashboard **not at all** — the coercion is unconditional in `toDeltaAudit`. The "couldn't grade" card is
the `/audit/[id]` surface, not the dashboard the block names. Worse, dropping `refusal` makes §5's own
identification query unrunnable, so an operator following remedy 1 both fails to stop the fabrication
and loses the only way to enumerate affected rows. Only remedy 2 works; remedy 1 is stated first.

---

## BLOCKING — R3

### R3-B8-2 · the B2 evidence file's mutation table omits four other reds

`evidence/2026-08-07-b2-catalog-guard-claim.md:62` claims *"R2-D is now the only case in the file that
fails when the ACL rule is removed."* Measured under two independent spellings of that mutation:
**`6 failed | 23 passed (29)`** — R2-A, N6, R2-B, N4, R2-D **and** the B3 migration-content case.

The narrower *conclusion* survives (EV-A green, R2-D red ⇒ not a duplicate). The **stated proof** does
not, and a bounded report that does not state what it withheld is an §10 violation in the evidence file
written to correct exactly that kind of claim.

### R3-B8-3 · the rebuilt `gate 5 R2-D` case STILL passes on its second statement

`spec51a-frontier-privilege-catalog.test.ts:448-450`. Gate 7's B2 was that R2-D was vacuous. It was
split — and **deleting the `ALTER DEFAULT PRIVILEGES` line still leaves the case passing with
byte-identical violations**:

```
R2D-VIOLATIONS>>> ["reap_e: PUBLIC holds privileges (=X/postgres)",
                   "reap_e: anon holds privileges (anon=X/postgres)",
                   "reap_e: authenticated holds privileges (authenticated=X/postgres)"]
Tests  1 passed | 28 skipped (29)
```

Structural cause: `PLATFORM_SHIM:155-157` already runs
`alter default privileges in schema public grant execute on functions to anon, authenticated, service_role`,
so the case's own ADP statement grants what the sandbox already grants. The case is not useless — it is
the only one exercising "compliant function that never revoked" — but its label, docstring and evidence
attribute the catch to an inert statement. **Same defect, one radius smaller, inside the fix for it.**

**Fix:** relabel to what it tests, or make the ADP statement load-bearing (grant to a role the shim does
*not* pre-grant, and assert that grantee specifically).

---

## NOT SUSTAINED — R3-B8-1, adjudicated against the code

R3 raised as blocking that `docs/OPERATING-RULES.md` §5's `too_few_gradeable_pages = 13` is false and
should be 12, measured via `audits.page_count < 5 group by partial`.

**Re-measured directly, both bases, on production:**

| basis | below floor | `site_too_small` | `too_few_gradeable` |
|---|---|---|---|
| gradeable proxy — `status_code = 200 ∧ NOT excluded_from_grade` | 40 | 27 | **13** |
| `audits.page_count` | 39 | 27 | **12** |

Both numbers are real; they are different bases, and they differ by exactly one audit. The trigger
consumes `gradeablePageCount` — *"Size of the graded population (§5 M9), **not pages crawled**"*
(`refusal.ts:35`) — and `evidence/2026-08-04-stage4-floor-calibration.md` **explicitly withdrew the
`page_count` basis** for that reason. On the basis the code implements, **13 is correct** and R3's claim
of "every basis gives 12" does not hold: the endorsed basis gives 13.

**But the finding is not worthless, and it is retained as NON-BLOCKING.** Two careful reviewers reached
different numbers because **§5 does not state its basis**, and `refusal.ts:16`'s "39" is on the
withdrawn basis with nothing reconciling the two. The sign-off table must name its basis and cite a
committed measurement artefact — §5B's "every claim carries its artifacts" applied to the one claim that
authorises the merge. That is the fix, not changing 13 to 12.

---

## NON-BLOCKING — the ones that matter for the next pass

- **`hasResults` is a proxy, and its type disagrees with the wire** (R1-1). `AuditSurfaceView.tsx:130`
  infers "findings present" from stats presence, and `audit-view-state.ts:39` declares `avgDepth?: number`
  while `audit-stream-projection.ts:153` declares `avgDepth: number | null`. `payload as Snapshot` hides
  the disagreement from `tsc`. The day anything emits an honest `avgDepth: null`, **every** refused audit
  routes to the failure card. Unreachable today only because `audit-stats.ts:21` returns `0` — one guard,
  in another file, which is precisely what `conversion-from-fixes.ts:20-27` was just changed to stop doing.
- **`ensureCrawleeMemoryHint()` wiring is unprotected** (R2-N3). Deleting the call at `crawler.ts:427`
  leaves engine **837/837 green**; the test covers the function, never that `runCrawl` calls it.
  Pre-existing on `main` — but this branch rewrote 419 lines of `crawler.ts`, and overview §11 records
  that losing this call broke production once. OPERATING-RULES §5 non-regression item.
- **Column-level grants evade the table rule** (R2-N1). `grant select (audit_id) on public.frontier to anon`
  → `attacl={anon=r/postgres}`, `relacl` unchanged, **0 violations**. Neutralised by RLS-on/0-policies, so
  not exploitable; the stated claim is broader than what is checked.
- **`FRONTIER_CHECKPOINT` does not exist** (R2-N4). The stage-6 runbook §7 documents it as a kill-switch
  that "defaults off"; zero occurrences in any source file. Safe today (nothing wired), but the runbook
  promises an off-ramp that would not exist on the day it is needed.
- **A surviving single-line mutant in the reset** (R3-N5). Deleting only `setSnapshot(null)` from the
  per-audit reset leaves 8/8 green; deleting the whole block is caught. Same root cause as R1-B1.
- **`confidenceCapped` has no consumers** (R3-N1); `refusal.ts:21`'s "the fourth caps confidence" is false
  today — §9.1 is 5.1b.
- **`refusal.ts:29-31` describes an unreachable branch** (R1-3): `decideRefusal` is called under the same
  `v2` gate that sets `crawlHealth`, so `fetchedOkCount: null` / `crawlTruncated: null` are unit-test-only.
- **`CURRENT-STATUS.md` is stale in four measurable places** (R1-2, R3-N10) — corrected in the same
  commit as this file.
- Also: `capDiscovered`/`discoveryCapInfo` shipped with no production caller (R3-N8); `selectFrontier`
  recomputes SHA-256 inside the sort comparator, ~2·n·log n hashes per stratum (R1-6); import-graph guard
  docstring says "SEVEN idioms … All five" (R2-N5, R3-N3); `mint` tells a refused audit it is "not
  gradeable" (R2-N6); no CI, both catalog blockers sit in a ~44 s local-only guard (R2-N8).

---

## WHAT HELD — measured, and worth keeping

The **decision layer is strong**: every mutation any reviewer could construct inside
`deriveAuditViewState`, `decideAuditSurface`, `AuditSurfaceView` or `refusal.ts` died with a **named**
test. The surviving correctness class is confined to one place — the state transition in `AuditView`.

- **Gate 7's core diagnosis is fixed.** An unconditional throw at `AuditView.tsx` module scope now fails
  the new suite (all three reviewers verified), and the four pre-existing guards stay 91/91 — confirming
  they never could see the file.
- **All three gate-7 evasions die**, and G7-3 dies **both** ways — `tsc` reproduces verbatim at the same
  line:col (`AuditView.tsx(137,9) TS2322 … Property 'refusal' is missing … but required in type
  'AuditSnapshotLite'`) *and* 3 tests red.
- **Two gate-7 open items are closed:** `const hasResults = true` now dies (1 red); `hasPredecessor` is
  pinned in **both** directions (3 red / 2 red / 4 red).
- **B5.1 is pinned by tests, not only by types** — restoring the coercion turns 5 named tests **plus the
  import-graph guard** red.
- **The B3 shim is load-bearing, not decorative.** Removing production's default-privilege lines turns the
  B3 case red *for the right reason*. Production `pg_default_acl` matches the shim's comment exactly, read
  live by two reviewers independently.
- **"Reproduces production byte-for-byte" is TRUE**, verified against independently-read production
  `pg_proc` / `pg_class` for all four RPCs and both frontier tables.
- **The entitlement boundary holds at the serialized bytes**: removing both owner+Pro gates → 5 named
  tests red, including two SSE integration tests asserting the `done` payload.
- **`safe-fetch.ts` / `ssrf-guard.ts` are byte-identical to `origin/main`.** `crawlee` remains a direct
  `apps/web` dependency. Lockfile diff is **6 lines, 0 packages downloaded**, both devDependencies.
- **Per-file jsdom does not disturb the other 200+ `.tsx` tests** — `vitest.config.ts:29` pins
  `isolate: true`, no global environment is set, 208/1546 green with `environment 426ms`.
- **`51 of 215` is robust** — reproduces at exactly 51 under both definitions of "zero observed edges".
- **Trace-audit clean** across all 125 commits, verified independently by all three: single author, no
  authorship trailer, no secret-shaped strings; every Claude/ChatGPT/GPTBot hit is a crawler token,
  product `copyLabel`, or the §7 rule text itself.

---

## Verdict

**Gate 8 FAILED — do not open the PR.** Six sustained blockers, all inside this session's fix pass.

Per `CURRENT-STATUS` item 5 and the owner's standing instruction — *"if gate 8 finds a blocker in a file
that is now executable and catalog-asserted, report it and stop"* — this is reported and work stops
here. Every one of the six is in exactly those two files. Per OPERATING-RULES §8, a blocker landing
inside one's own prior fix is reported before it is fixed, and **the remedy is to change approach, not
to patch again** — which is the decision now owed to the owner, because this is the sixth consecutive
gate the class has survived.
