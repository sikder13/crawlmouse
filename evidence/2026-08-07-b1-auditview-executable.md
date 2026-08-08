# B1 — `AuditView.tsx` made executable, and the evasion sweep re-run against it

**Date:** 2026-08-07 · **Branch:** `engine/spec-5-1a` · **Node:** v22.23.1 · **Runner:** `npx vitest run`
inside `apps/web` (turbo's cache is shared across sibling worktrees and `pnpm test --force` silently
no-ops, so the package runner is used directly).

Gate 7 blocker B1. The owner's ruling was that R2 had found the real cause — the file is not in the
test graph, so this is a coverage gap to be closed with test infrastructure, not a design failure to
be redesigned around — and that **if any evasion still survived once the file executed, that would be
a design finding and work must stop and report it.** None survived. The sweep is below.

---

## 1. The diagnosis, reproduced

`AuditView.tsx` was imported by `app/audit/[id]/page.tsx` and by no test. Every claim any gate made
about its contents was therefore a claim about source text.

**M0 — harness liveness (`OPERATING-RULES` §10: prove the harness with an unconditional throw first).**
A `throw new Error(...)` inserted at `AuditView.tsx` module scope:

| Suite | Result |
|---|---|
| `AuditView.test.tsx` (new) | **RED** — module-scope throw, no tests collected |
| the four pre-existing guards¹ | **GREEN — 91/91** |

¹ `AuditSurfaceView.test.tsx`, `lib/audit-view-state.test.ts`, `refused-route.test.tsx`,
`__tests__/refusal-gate-import-graph-guard.test.ts`.

That second row IS the defect: the four suites that were supposed to be policing this behaviour
cannot observe the file at all. It reproduces R2's measurement exactly.

## 2. What was added

- **`apps/web/app/audit/[id]/AuditView.test.tsx`** — mounts the component with `createRoot` + `act`
  under `// @vitest-environment jsdom`, **declared per file**. Not global: 200+ existing `.tsx` tests
  render through `renderToStaticMarkup` in the node environment, and moving all of them onto a
  different renderer to reach one file would be a far larger change than the one being tested.
- A `FakeEventSource` implementing the slice `wireAuditStream` uses. jsdom ships **no** `EventSource`,
  so this is a stand-in, not an override — nothing real is masked by it. `Element.prototype.scrollIntoView`
  is likewise absent from jsdom (no layout engine) and is stubbed for `ActivityFeed`.
- **`AuditSnapshotLite.refusal` and `AuditView`'s `Snapshot.refusal` are now REQUIRED** (still nullable).
  `projectAuditForClient` emits `refusal: row.refusal ?? null` on every payload — base, progress and
  done — so requiring it is a true claim about the wire.

## 3. The sweep — every evasion, applied one at a time to a pristine tree

Restores are `cp` from backups; `git checkout --` is never used (§10 — it has destroyed uncommitted
work in this repo). Baseline: `AuditView.test.tsx` 8/8, pre-existing guards 91/91.

| # | Evasion | `AuditView.test.tsx` | pre-existing guards |
|---|---|---|---|
| G7-1 | props: `{ ...snapshot, refusal: null }` | **RED** 1 failed / 8 | GREEN 91/91 |
| G7-2 | props: `{ ...snapshot, crawlHealth: null }` | **RED** 3 failed / 8 | GREEN 91/91 |
| G7-3 | props: a `Pick`-style narrowing object omitting `refusal` | **RED** 3 failed / 8 | GREEN 91/91 |
| G6-a | additive branch beside the real one in `case 'result'` | **RED** 1 failed / 8 | RED 3 failed / 91 |
| G6-b | body swap: `case 'result'` returns the failure card | **RED** 3 failed / 8 | RED 5 failed / 91 |
| G6-c | mutated fed state: `refused` rewritten to `gradeFailed` | **RED** 1 failed / 8 | RED 1 failed / 91 |
| G6-d | nulled `v2` on the refused branch | **RED** 1 failed / 8 | RED 1 failed / 91 |
| — | `const hasResults = true` in `AuditSurfaceView` | **RED** 1 failed / 8 | GREEN 91/91 |

**Read the third column.** All three gate-7 evasions, and the open `hasResults` item, are *invisible*
to the four suites that already existed — which is precisely why they survived. Gate 6's four were
already dead in the modules the decision was moved into; they now also die driven from the top.

The last row closes a gate-7 smaller item recorded as still open: `const hasResults = true` survived
the whole suite and restored the permanent 0-orphans / 0.0-depth card. It is caught now.

## 4. The compiler half — G7-3 does not merely fail a test, it fails to build

Declaring `refusal` on the component's `Snapshot` was not enough while the field stayed **optional**:
an absent optional key is a valid `AuditSnapshotLite`, so the narrowing refactor typechecked, derived
`refused: false`, and put gate 3's blocker back on the primary screen with `tsc` clean. Required now:

```
app/audit/[id]/AuditView.tsx(137,9): error TS2322: … is not assignable to type 'AuditSnapshotForView | null'.
  Property 'refusal' is missing in type '{ status: string; … }' but required in type 'AuditSnapshotLite'.
```

Restored → `tsc --noEmit` clean. So the omission class is a build error and the value-mutation class
(G7-1, G7-2) is an execution failure. Neither depends on anyone reading source text.

## 5. `jsdom` is a DECLARED dependency, not a lucky transitive

Before this change `jsdom` resolved **only** because `crawlee` → `@crawlee/jsdom` → `jsdom@26.1.0` put
it in the store. `PROJECT_OVERVIEW` §11's first hard-won lesson is that exact shape (a transitive-only
`crawlee` broke the production pipeline), and §12 lists crawlee's caret pin as an open ops watch-item.
It is now `apps/web` `devDependencies: { "jsdom": "26.1.0" }` — **exact-pinned**, because a silent
minor bump to a test *environment* changes rendering semantics underneath every test that uses it.

Lockfile impact: **3 lines, one importer entry, 0 packages downloaded** (already in the store).

## 6. Suite totals

| | before | after |
|---|---|---|
| `apps/web` test files | 206 | **207** |
| `apps/web` tests | 1523 | **1531** |
| `tsc --noEmit` (apps/web) | clean | **clean** |
