# GATE 7 — the three reviewer reports (FAILED)

**Frozen SHA:** `f3a501bf5e62858f68888c014673bcad0bd688a2` (pushed; `origin/engine/spec-5-1a`)
**Worktrees:** `../cm-g7-1` correctness · `../cm-g7-2` security/deploy · `../cm-g7-3` test quality.
**Date:** 2026-08-07. Suites per package (`npx vitest run`), never the top-level script.

| lens | R1 | R2 | R3 |
|---|---|---|---|
| correctness | **5** | **8** | **8** |
| security | **8** | **7** | **7** |
| deploy-safety | **8** | 9 | 9 |
| test-quality | **5** | **7** | **6** |
| blocking | **2** | **2** | **2** |

Baselines agreed by all three: engine **837** · web **1517** · inngest **145** · scripts **40**;
typecheck 5/5, lint 4/4, build green; lockfile/`turbo.json`/every `package.json` byte-identical to
`origin/main`.

---

## BLOCKER 1 — gate 3's blocker is still restorable, now from `AuditView`'s props. Found by all three.

`apps/web/app/audit/[id]/AuditView.tsx:131`. Three edits, each leaving **1517/1517 green, `tsc` 0,
`eslint` 0**, each rendering *"usually a site that blocks crawlers…" + "contact support" +
`text-warning`* on **every** refused audit:

- `snapshot={snapshot ? { ...snapshot, refusal: null } : null}`
- `snapshot={snapshot ? { ...snapshot, crawlHealth: null } : null}`  (routes refused → `v2 === null` → `error`)
- a **`Pick`-style narrowing props object** omitting `refusal`

R2 proved the mechanism harder than a survived mutation: **an unconditional `throw` at module scope
of `AuditView.tsx` also leaves 1517/1517 green — the module is not in the test graph at all.**

The third edit is why this is blocking rather than the disclosed residual. `15628ca` framed the
remaining seam as *"fabricating data, not re-deciding a render — a visibly different act."* A props
narrowing is not a visibly different act, and `AuditView.tsx:29-36`'s **own comment** names exactly
that refactor as the live hazard: *"a `Pick`/mapping refactor of the SSE payload could drop it and
re-break gate 3's blocker with `tsc` green."* `AuditSnapshotLite.refusal` is still optional, so the
compiler does not object. **Fifth consecutive gate.** The docstring claim *"a fifth evasion has
nothing left to evade"* is false as written.

Cheap cures both reviewers named: mount `AuditView` under jsdom with a stubbed `EventSource`, or
assert `AuditSurfaceView` receives `snapshot` unmodified.

## BLOCKER 2 — the catalog guard's "the set is complete" is false. Fourth consecutive gate.

`prosrc` is the body **as text**, not what the function **touches**. Proven end to end in PGlite on
the real migration set, with real rows and an actual `set role anon`:

| probe | discovered | rows |
|---|---|---|
| `security definer` fn deleting from a **view** over `frontier` | no | **2 → 0** |
| `plpgsql` **dynamic SQL**, name concatenated | no | **2 → 0** |
| **cross-schema wrapper** (`util.h()` called from a `public` wrapper) | no | **2 → 0** |
| `security definer` wrapper calling a governed function | no | — |
| a **view granted straight to `anon`** — no function at all | n/a | — |
| `create procedure` — dropped by the undocumented `prokind = 'f'` filter | no | — |

Each of the first three is an ordinary migration, `security definer`, **no revoke** → an
unauthenticated `/rest/v1/rpc/…` endpoint that empties the table. The guard has stopped carrying its
filenames (gate 4), its naming convention (gate 5), its body syntax (gate 6), and now carries
**"the table's literal name appears in the body text."** One radius smaller, four times running.

Also: the **`gate 5 R2-D` case is vacuous** — `alter default privileges` alone yields 0 violations;
the case passes only on its second statement, which duplicates `EV-A`. The **table-posture rule has
no negative control at all**. And the commit's coverage arithmetic does not reconcile: it claims
"all six from gate 4, all seven from gate 5" as committed cases; the file has 13, of which **1** is
gate 4 and **5** are gate 5. (The mechanism does catch the others — that is a different claim.)

## BLOCKER 3 — the PGlite shim omits production's `pg_default_acl`, failing in the UNSAFE direction

Read live from production: `objtype=f → {postgres=X, anon=X, authenticated=X, service_role=X}` and
`objtype=r → {…anon=arwdDxtm, authenticated=arwdDxtm…}` — **no PUBLIC entry at all**. Migrations run
as `postgres`, so every new function is created with explicit client EXECUTE. Stock Postgres has the
opposite defaults, so **the sandbox is strictly safer than production**.

Measured: narrowing both revokes to `from public` — the spelling the migration's own header
emphasises — passes **GREEN** in the test and leaves `anon=X` on the row-claiming and row-deleting
RPCs in production. Deleting the table revoke likewise passes green. The assertion comment
*"reproduces production byte-for-byte, so this oracle is the same one the runbook reads"* is false.
Remediation is three `alter default privileges` lines in `PLATFORM_SHIM`.

## BLOCKER 4 — a refused audit can render `ResultView` with a non-`ClientAuditV2` payload, and throws

`audit-view-state.ts:79`. `graded` is gated on `hasResults`; **`refused` is not.** When `buildDone`
throws, the route emits a named `error`, `done` flips true, and the last snapshot is the **base**
`ClientAudit` — no `findings`. Measured through the real projection:

```
STATE: {"refused":true,...}  DESCRIPTOR: result/refused
RENDER: THREW TypeError: Cannot read properties of undefined (reading 'filter')
```

On `main@69b039f` the same path degraded to the "couldn't grade" card. The branch converts a graceful
degradation into a client render crash on the primary result page, for refused audits only.
Related survivor: `const hasResults = true` in `AuditSurfaceView` leaves **1517/1517 green** and
restores the permanent 0-orphans/0.0-depth card the design exists to prevent.

## BLOCKER 5 — the D4 class is alive in `orphan`, at critical severity, and moves the grade 16 points

Same mechanism as D4, one severity higher, and **grade-bearing**. WordPress shape the D4 evidence
itself names (sitemap declares posts, `/page/N` archives undeclared, every post linked from its
archive — **zero orphans by construction**), through the real crawler:

| pages | cap | `orphan` (critical) | grade |
|---|---|---|---|
| 5 501 | **500** (`FREE_PAGE_CAP`) | **105** | **C / 62.97** |
| 5 501 | 2000 (Pro) | **0** | **B / 79.28** |
| 1 101 | 110 / 150 / 200 / 300+ | 50 / 41 / 21 / 0 | D/49.67 → B/79.15 |

`audit.ts:449-452` asserts the opposite in a comment. The mechanism **predates the branch**; it is
blocking here because this is the branch publishing the ruling *"a claim about the site derived from
our own page cap does not ship — at any severity, in any position, under any wording"*, and because
`evidence/2026-08-07-gate6-reports.md` **certifies the class absent** on fixtures whose hubs fit
inside the budget and therefore cannot reproduce it.

---

## An unsurfaced RULE CONFLICT (R1-NB9) — owner ruling required

`docs/OPERATING-RULES.md` §5 (SPEC 5.1 amendment): grade-changing stages *"require explicit sign-off
against a before/after panel (SPEC 5.1 §10)"* and *"none merges without that sign-off."* That panel is
**B15**, deferred to 5.1b by §14's terminal split. The deferral is disclosed; **the conflict with the
tracked operating law is not**, and §2/§11 require surfacing rather than resolving it. The 51/215
merge-impact figure is a partial substitute, not the panel.

## Unpinned, unclaimed, or stale

- **`hasPredecessor` has no loader→card test.** `hasPredecessor = false` → 1517/1517 green and every
  card says "First audit"; inverting it → also green. The field the whole B6-1 fix rests on.
- **Handoff §1 still says "Gate 6 pending"** at a SHA where gate 6 failed; there is no §5C. §1 still
  reads **web 1492** (measured 1517). §6A item 7 still omits the `attempted-count` ticket. §6A item 8
  cites `OPERATING-RULES §104`; the file has §1–§11 and the rule is §7.
- `AuditSurfaceView.test.tsx:22` claims a duplicate `case` is *"a compile error"* — measured `tsc` 0,
  `eslint` 0; it is caught by **execution** (5 red). Protection real, stated reason false.
- Two counts in `15628ca` do not reproduce: "10 red" measured **11**; "1 red" measured **3–5**
  depending on spelling.
- `stream/route.ts:134-135` still passes `?? 0` / `?? ''` into `reconstructConversion`, unreachable
  only because `projected_score` is NULL for a refusal — a single guard, not source-level withholding.
- The rollback hazard is recorded in the handoff and gate-5 evidence but **not in
  `docs/deploy/spec51a-stage4-migration-runbook.md` §5 "Rollback"** — the document an operator opens
  at the moment it matters — nor in §6A.
- `crawl-stall-retries.test.ts` is load-sensitive: 836/837 under concurrent suites, 3/3 in isolation.
- **This repo has no CI** (`.github/workflows` absent). The catalog test costs **44s**, not the ~25s
  I reported, and it is a local-gate cost.

## What held

The descriptor refactor is genuinely strong: **every** gate-6 evasion, in every spelling constructible
*inside* `decideAuditSurface`, `AuditSurfaceView` or `AuditSurfaceMap`, dies — including the two
subtlest. R3's kill battery: 20 red / 12 red harness controls, then K1 1, K2 1, K3 3, K4 11, K5 3,
K6 12, K8 1, K9 5, K11 4, K12 5.

**The D4 cut checks out by test.** Removed tests reconcile exactly: 5 (deleted acceptance file) + 13
(`coverage.test.ts` 23→10) = 18; 855 − 18 = **837**. No assertion softened; the replacement asserts on
serialized bytes with anti-vacuity controls; the pre-cut-row pin is sensitive (1 red).

**SiteCard's two gates held under full 36-combination enumeration** — the only `No grade → C ■` in the
matrix is the loaded-but-refused predecessor, which is the case the label exists for.

Live posture verified independently by all three from the catalog; a byte-level serialization probe
across four unentitled viewers plus refused-row shapes found no leak, with anti-vacuity controls; SSRF
byte-unchanged and the robots gate strictly tightened (closing the HIGH ticket); a failing migration
cannot pass silently; acceptance-sweep arithmetic reconciles (11 + 1 + 5 = 17); and **all disclosures
— B10, B11, B13, B14, B15, B17 — were judged honest by all three**, with gate 6's §6A defect fixed.
