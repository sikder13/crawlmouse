# Gate-9 fix pass — the six ruled items, each measured

**Date:** 2026-08-08 · **Branch:** `engine/spec-5-1a` · **Node:** v22.23.1
**Baseline:** gate 8 frozen SHA `347e6e8` (preserved in `../cm-g8-{1,2,3}` as the reproduction baseline)

Owner ruling after gate 8. **Three habits end here**, and every section below is written to that bar:

1. asserting completeness without proving reachability,
2. fixtures that do not reflect the real runtime event stream,
3. runbooks and rollback remedies written from mental models rather than executed.

**No sentence in this file ships unless a command in this file verifies it.**

---

## 1. R2-B1 — the word boundary, and the wrapper it hid

`\m…\M` is gone from the `prosrc` predicate. Underscore is a word character in Postgres ARE, so
`delete_orphan_frontier_rows` never matched a word-bounded `frontier`, and a same-schema
`SECURITY DEFINER` wrapper around that governed helper escaped discovery entirely.

Substring matching over-discovers, which for a posture rule is the harmless direction — an extra
function simply gets its ACL checked.

**Committed as a case.** Mutation (restore the word boundary), **re-measured against the tree that
ships** (gate 9 / FC-2 — the figure here was previously quoted from a run taken before two cases were
added, at 32 tests, with the sentence "exactly that case, and only that case", which was false):

```
   × catches: gate 8 R2-B1 — a same-schema DEFINER wrapper around a governed helper
   × catches: view indirection VIA A VIEW WHOSE NAME CONTAINS THE TABLE NAME (frontier_v)
   × KNOWN GAP … a view NAMED after the table is discovered — the substring predicate is why
      Tests  3 failed | 32 passed (35)
```

Three cases, all of them the substring predicate's own coverage — the wrapper, the name-containing
view, and the pinned gap's positive direction. Baseline is **35 passed (35)**.

> ### ⚠ CORRECTED 2026-08-08 (gate 9 / FC-1) — "closed" WAS OVER-READ FROM ONE FIXTURE
>
> The paragraph below concluded that view indirection is **closed**. It is not. The fixture's view is
> named `frontier_v`, which *contains* the table name, so the substring predicate finds it. Re-measured
> with the view renamed, both directions:
>
> ```
> view named frontier_v : reaper discovered = true
> view named zone_v     : reaper discovered = false
> ```
>
> A reviewer drove the second end to end: **`anon` deleted 2 real rows with the suite green**, while a
> direct call to the governed helper was correctly denied. **Closure of a CLASS was asserted from one
> INSTANCE whose name happened to match what the matcher keys on** — which is now a standing rule in
> `docs/OPERATING-RULES.md` §10, with this as the canonical example. Both directions are pinned as
> assertions in the guard so the claim cannot be restated without a measurement.

**A second shape appeared closed and was over-read — see the correction above.** All four
previously-open shapes were re-run against the new predicate:

```
SHAPES-DISCOVERED>>> ["claim_frontier","delete_orphan_frontier_rows","reap_via_view",
                      "settle_frontier_batch","upsert_frontier_batch"]
  reap_via_view: DISCOVERED (closed)      ← `frontier_v` contains `frontier` as a substring
  reap_dynamic:  invisible (still open)
  wrapper_fn:    invisible (still open)
  reap_proc:     invisible (still open)
```

The `frontier_v` INSTANCE is caught and pinned as a committed case, but **the view-indirection SHAPE
is open** (see the correction above); dynamic SQL, the cross-schema wrapper and `prokind='p'` remain
open. The ticket records 1 closed / 4 open, as a **running list, not a bound**.

**The completeness sentence is gone.** The guard has now claimed to know the extent of its own gap
twice and been wrong both times (gate 7: "the set is complete"; gate 8: "the gap is exactly these
four"). There is no third claim. It states what it covers and says nothing about what escapes.

## 2. R3-B8-3 — the ADP case is load-bearing now

Its `ALTER DEFAULT PRIVILEGES` line granted `anon` something `PLATFORM_SHIM` already grants `anon`
(production has that grant), so deleting the line left the case passing with byte-identical violations
— vacuous for the second time, after gate 7 "fixed" it.

Rebuilt: it grants to `reporting_ro`, a role the shim does **not** pre-grant, and asserts **that
grantee by name**, with a control proving the same function produces no such violation without the
line. This required the posture rule to become an **allowlist** (`{postgres, service_role}`) rather
than an `anon`/`authenticated` denylist — which also closes gate 8's R2-N2 residue, a role nobody
predicted holding EXECUTE.

Mutations:

| mutation | result (re-measured against the shipped tree) |
|---|---|
| delete the ADP line | `1 failed \| 34 passed (35)` — the ADP case, and only it |
| revert the allowlist to the denylist | `1 failed \| 34 passed (35)` — same case |

Both were green under the previous version. Catalog file: **29 → 35 tests**. (These totals were also
quoted at 32 before gate 9; corrected here per the re-measure rule.)

## 3. R1-B1 — fixtures are captured from the producer

`AuditView.test.tsx` no longer writes payloads. Each scenario **runs the real `GET` route** against a
stubbed database, captures the raw SSE bytes, and replays that exact sequence — event names and
serialized payloads unchanged — into a mounted `AuditView`. Only DB rows are hand-written.

What the producer actually emits, asserted in the file itself rather than assumed:

```
REFUSED (completed at load):     ["snapshot","done"]
  snapshot: refusal={"refused":true,...} crawlHealth=set orphanCount=undefined findings=absent
  done:     refusal={"refused":true,...} crawlHealth=set orphanCount=1 avgDepth=0.5 findings=1
RESULTS READ THREW:              ["snapshot","error"]
LIVE CRAWL (poll loop):          ["snapshot","progress","done"]
```

The base `snapshot` carries the decision but **not** the results — which is exactly why a length-one
fixture could not see `setSnapshot` replacing a payload.

**Sweep — EVERY mutation run, nothing withheld** (gate 9 / FC-6: the previous table showed 9 rows and
called itself "every earlier evasion" while silently omitting two). Re-measured against the shipped
tree, so the totals are out of **18**, not 10:

| mutation | `AuditView.test.tsx` | the four pre-existing guards |
|---|---|---|
| **G9-S1** `crawlHealth` nulled only when `confidence === 'low'` | **RED 3/18** | GREEN 91/91 |
| **G9-S2** `snapshot={done ? snapshot : null}` | **RED 1/18** | GREEN 91/91 |
| **G9-S3** delete `onActivity` from the `wireAuditStream` call | **RED 1/18** | GREEN 91/91 |
| G8-EA `setSnapshot((prev) => prev ?? payload)` | RED 13/18 | GREEN 91/91 |
| G8-EB `useMemo(() => snapshot, [snapshot?.id])` | RED 13/18 | GREEN 91/91 |
| G7-1 `{ ...snapshot, refusal: null }` | RED 9/18 | GREEN 91/91 |
| G7-2 `{ ...snapshot, crawlHealth: null }` (unconditional) | RED 11/18 | GREEN 91/91 |
| **G6-a** additive failure card beside the real one | RED 9/18 | RED 3/91 |
| G6-b body swap in `case 'result'` | RED 11/18 | RED 5/91 |
| G6-c mutated fed state | RED 9/18 | RED 1/91 |
| G6-d nulled `v2` | RED 9/18 | RED 1/91 |
| `const hasResults = true` | RED 1/18 | GREEN 91/91 |
| `const hasResults = done` (the gate-7 B4 crash) | RED 1/18 | GREEN 91/91 |
| delete only `setSnapshot(null)` from the per-audit reset | RED 1/18 | GREEN 91/91 |

**G6-a** is one of the two the earlier table omitted; it is included now and still dies.
**G7-3** (a `Pick`-narrowing props object omitting `refusal`) is deliberately NOT in this table and
that is stated rather than left blank: it is no longer a runtime evasion at all, because
`AuditSnapshotLite.refusal` is required, so it fails to compile —
`AuditView.tsx(137,9): error TS2322 … Property 'refusal' is missing … but required in type
'AuditSnapshotLite'`. A mutation that cannot be typed cannot be run.

## 3b. THE ROW-SHAPE MATRIX — the class fix for the third consecutive fixture finding

Gate 9's NB-1 was that the *stream* was the producer's but the *row shape* was one hand-picked
singleton (`confidence:'high'`, `partial:false`, 2 pages, 1 finding, anonymous viewer). An edit
conditioned on anything outside that shape was invisible, and **reachability was not hypothetical: of
the 51 production audits that would refuse, 13 carry `confidence='low'` and 4 `'medium'`** — a third
of refusals sat outside the pinned shape.

The replay suite now runs over real row shapes rather than one:

- **`{high, medium, low} × {false, true}`** — six refused rows, each captured from the route and
  replayed, each asserting the payload really carried that shape (`done.crawlHealth.confidence` /
  `.partial`) before asserting the arc. A refusal is decided by the refusal payload, never by
  crawl-health, so all six must reach the Stage 4 arc.
- **a zero-page `nothing_read` row** — no pages, no links, no findings, no fixes, `estimateSource:'none'`.
  The opposite end of the shape space from the singleton.
- **a row carrying a real `crawl_activity` ring** — so the route emits `activity` events and
  `onActivity` becomes load-bearing.

The three gate-9 survivors die on exactly the shapes that make them visible: **S1 on 3 of 18** (the two
`low` rows plus the zero-page row, which is also `low`), **S2 on the flash-window case** — which needed
a *positive* assertion (`Computing your grade`), because negative assertions alone let a withheld
snapshot render the live-crawl UI, putting a "Cancel audit" button on a finished audit — and **S3 on
the activity case**. Measured order for that last one, asserted in the file:
`["snapshot","activity","progress","done"]`.

## 4. R2-B2 + R2-B3 — both runbooks EXECUTED, not reasoned about

### 4a. The post-apply posture check is name-free

It filtered `p.proname in (<four names>)` — the "carries its own list" defect gate 4 deleted the source
matcher for — and was measured missing five anon-callable routines. It now asks which routines in
`public` (`prokind in ('f','p')`) any client role can EXECUTE, and expects zero rows. A companion query
covers `relacl` **and** `pg_attribute.attacl`, because a column grant is invisible to a `relacl` check.

**Executed against production (`ezspnfeyzwsisymytssm`), 2026-08-08:**

```
client-executable routines in public : []                              ← 0 rows, as documented
frontier             : rls=true policies=0 acl={postgres=…,service_role=…} column_acls=null
frontier_politeness  : rls=true policies=0 acl={postgres=…,service_role=…} column_acls=null
```

### 4b. The rollback remedy — every candidate driven through `main@69b039f`

`main@69b039f` was checked out in a worktree and its **real** `loadDashboardSites` + `deltaSentence`
driven with a graded predecessor (B/81.39) and a refused re-audit:

```
ROLLBACK-EXEC A/hazard          :: {"scoreDelta":-81.39,"gradeFrom":"B","gradeTo":""}  :: "Down 81 points since your last visit — worth a look"
ROLLBACK-EXEC B/columns-dropped :: {"scoreDelta":-81.39,"gradeFrom":"B","gradeTo":""}  :: "Down 81 points since your last visit — worth a look"
ROLLBACK-EXEC C/expired         :: {"currentGrade":"B","currentScore":81.39,"scoreDelta":null} :: "Holding steady since your last visit"
ROLLBACK-EXEC D/prev-nulled     :: {"currentGrade":"","currentScore":0,"scoreDelta":null}      :: "Holding steady since your last visit"
ROLLBACK-EXEC E/deleted         :: {"currentGrade":"B","currentScore":81.39,"scoreDelta":null} :: "Holding steady since your last visit"
```

- **B was this runbook's recommended remedy and it does nothing.** `main@69b039f` never selects
  `refusal` (`git grep -c refusal 69b039f -- apps/web` → 1 unrelated hit), so the row it reads is
  byte-identical with or without the columns. Dropping them also destroys the identification query.
- **D is rejected**: it removes the `-81` and substitutes an empty grade, a score of 0, and "Holding
  steady" about a verdict never issued.
- **C is the remedy**: expire the refused rows so the pre-5.1a loader's own
  `expires_at.is.null,expires_at.gt.<now>` filter excludes them. Non-destructive and reversible —
  **but only until the TTL cron runs**: `deleteExpiredAudits` (`inngest/billing-helpers.ts:218`)
  selects `expires_at <= now()` and DELETES, so the cron must be paused for C to stay reversible.
  That caveat is in the runbook.

## 5. §5 basis, and reconciling `refusal.ts`

Two gate-8 reviewers derived different counts because neither document said which basis it used.
Re-measured, both bases, with **this query** (gate 9 / FC-8: `OPERATING-RULES` §5 cited this section as
"the query" when it contained only the output — the query itself is now here, so a reader can
reproduce it):

```sql
with pop as (
  select a.id, a.partial, a.page_count,
         count(p.id) filter (where p.status_code = 200
                               and coalesce(p.excluded_from_grade,false) = false) as gradeable
    from audits a left join pages p on p.audit_id = a.id
   where a.status = 'completed'
   group by a.id, a.partial, a.page_count
)
select count(*) filter (where gradeable  < 5)                        as below_floor_gradeable_proxy,
       count(*) filter (where page_count < 5)                        as below_floor_page_count,
       count(*) filter (where gradeable  < 5 and partial is false)   as proxy_small,
       count(*) filter (where gradeable  < 5 and partial is true)    as proxy_too_few_true,
       count(*) filter (where gradeable  < 5 and partial is null)    as proxy_too_few_null,
       count(*) filter (where page_count < 5 and partial is false)   as pc_small,
       count(*) filter (where page_count < 5 and partial is true)    as pc_too_few_true,
       count(*) filter (where page_count < 5 and partial is null)    as pc_too_few_null
  from pop;
```

Output:

```
below_floor_gradeable_proxy=40  proxy_small=27  proxy_too_few=13  proxy_too_few_null=0
below_floor_page_count=39       pc_small=27     pc_too_few=12     pc_too_few_null=0
```

Both are real. `decideRefusal` consumes `gradeablePageCount` — *"the graded population, not pages
crawled"* — and `evidence/2026-08-04-stage4-floor-calibration.md` withdrew the `page_count` basis for
exactly this reason, so **13 is correct** for the implemented trigger. §5 now names its basis;
`refusal.ts` now names its own (`page_count`) and points at the difference.

## 6. False claims removed elsewhere

Each was measured, not inferred:

| file | claim | correction |
|---|---|---|
| `audit-view-state.ts`, `AuditSurfaceView.tsx` (×2), `AuditSurfaceView.test.tsx` (×2), `audit-view-state.test.ts` | *"this suite has no jsdom, so it never mounts"* | now false — `AuditView.test.tsx` mounts it. Rewritten as the history that produced the design. |
| `refusal-gate-import-graph-guard.test.ts:34` | *"SEVEN idioms … All five had to be WRITTEN"* | seven are listed; "five" was stale |
| `grade-absence-of-evidence.test.ts:69` | *"holds for EVERY combination of component inputs"* | it sweeps 3 inputs on a 5-point axis (125 combinations); title and comment now say so |
| `spec51a-stage6-frontier-functions-runbook.md` §7 | `FRONTIER_CHECKPOINT` described as a live kill-switch that "defaults off" | zero occurrences in source; the module is unwired. The section contradicted this runbook's own banner. |
| `refusal.ts:21` | *"the fourth caps confidence"* | `confidenceCapped` has no consumer; `crawlHealth.confidence` comes from blockRate/coveragePct. §9.1 wires it in 5.1b. |
| `docs/tickets/…uncovered-shapes.md` | *"shape-agnostic … so it catches all four"* | never measured, and false — the check carried a four-name list. Fixed in the runbook and re-measured. |
| `evidence/2026-08-07-b2-catalog-guard-claim.md` | *"R2-D is the only case that fails"* | 6 fail, not 1; full table now printed |
| `evidence/2026-08-07-b2-catalog-guard-claim.md` §1 | *"the gap is exactly these four"* | a fifth was found; the bound is withdrawn |

## 7. Suites — re-measured against the tree that ships

| package | files | tests |
|---|---|---|
| `packages/engine` | 65 | **837** |
| `apps/web` | 208 | **1562** |
| `inngest` | 8 | **145** |
| `scripts` | 2 | **40** |

`apps/web` 1546 → 1552 (gate-9 fix pass) → **1562** (gate-10 pass: +6 confidence×partial matrix,
+1 zero-page `nothing_read`, +1 activity, +2 pinned view-indirection gap). Catalog 29 → 33 → **35**;
`AuditView.test.tsx` 8 → 10 → **18**.

⚠ Every figure in this file was re-measured against the final tree in the commit that ships it, per
`OPERATING-RULES` §10. That rule exists because this file previously quoted mutation totals from a
mid-pass run and shipped a sentence those totals falsified.
