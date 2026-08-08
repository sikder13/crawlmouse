# B2 — the catalog guard's claim, corrected against measurement

**Date:** 2026-08-07 · **Branch:** `engine/spec-5-1a` · **Node:** v22.23.1

Gate 7 blocker B2. The owner ruled: **correct the CLAIM, do not chase completeness.** Four things were
asked for. All four are below, each measured rather than argued.

---

## 1. The coverage claim was false — the four uncovered shapes, measured

The header argued the discovery set was *complete*: "(1) and (2) partition the two ways Postgres
stores a body. That is the argument for completeness." Four function shapes reach `public.frontier`
and are invisible to it.

Applied together, on top of the real migrations, in the sandbox:

```
create view public.frontier_v as select * from public.frontier;
create function public.reap_via_view(...)  security definer ... as $$ delete from public.frontier_v $$;
create function public.reap_dynamic(...)   language plpgsql security definer ... execute 'delete from ' || 'front' || 'ier';
create schema util;
create function util.helper()              security definer ... as $$ delete from public.frontier $$;
create function public.wrapper_fn(...)     security definer ... as $$ select util.helper() $$;
create procedure public.reap_proc()        security definer ... as $$ delete from public.frontier $$;
```

**Result — discovered: `["claim_frontier","delete_orphan_frontier_rows","settle_frontier_batch","upsert_frontier_batch"]`.
Violations: `[]`.** None of the five hostile objects is seen.

> ### ⚠ CORRECTED 2026-08-08 (gate 8 / R2-B1) — "the four shapes" WAS ALSO A FALSE BOUND
>
> This section replaced a completeness claim with a narrower one: that the gap was *exactly* these
> four. **A fifth shape was then found** — a same-schema `security definer` wrapper calling the
> already-governed `delete_orphan_frontier_rows`, which deleted real rows as `anon` with the suite
> green. Its reference IS in the body; it escaped because underscore is a word character in Postgres
> ARE, so the word-bounded match never matched. Two bounded claims, two gates, both false.
>
> The guard no longer bounds what escapes at all. It states what it covers and says nothing more; the
> ticket is a running list of known-uncovered shapes, not a bound. The word boundary is gone, and the
> wrapper is a committed case.

The header now states its coverage and makes **no claim about what escapes**. The `prokind = 'f'`
filter, which silently dropped procedures, is commented in the query itself. Ticket:
`docs/tickets/2026-08-07-frontier-catalog-guard-uncovered-shapes.md`.

## 2. The `gate 5 R2-D` case was vacuous — measured, then rebuilt

R2-D ran two statements: an `ALTER DEFAULT PRIVILEGES` grant, then a new `security definer` function.

**Measured: the ADP statement ALONE produces `[]` — zero violations.** So the case passed entirely on
its second statement, which is `EV-A` under another name. It tested nothing that was not already
tested, while appearing to cover the ADP hazard.

It is now split:

- **The true negative, asserted explicitly** — ADP alone changes nothing about the four live functions,
  because default privileges are *prospective* and cannot alter an ACL that already exists. Asserting
  this is what stops the vacuous case being reintroduced as "coverage". Carries an anti-vacuity
  `toHaveLength(4)` so an empty governed set cannot pass it.
- **The substantive case** — ADP, then a function that is compliant in every other respect: `SECURITY
  INVOKER`, `search_path` pinned. The only thing wrong with it is that it never revoked. Measured
  violations: `["reap_e: PUBLIC holds (=X/postgres)", "reap_e: anon holds (anon=X/postgres)",
  "reap_e: authenticated holds (authenticated=X/postgres)"]`.

**Mutation proving it is no longer a duplicate.** Remove the ACL checks from `postureViolations`.

> ### ⚠ CORRECTED 2026-08-08 (gate 8 / R3-B8-2) — THIS TABLE WITHHELD FOUR REDS
>
> It originally showed two rows and concluded *"R2-D is now the only case in the file that fails when
> the ACL rule is removed."* **That is false.** The mutation produces `6 failed | 23 passed (29)`,
> under two independent spellings of it. A bounded report that does not state what it withheld is the
> §10 violation this very file was written to correct. The full result:

| case | result |
|---|---|
| `gate 6 EV-A` (SECURITY DEFINER) | **GREEN** — still caught, by the DEFINER rule |
| `gate 5 R2-A` schema-wide grant to a client role | **RED** |
| `gate 6 N6` the ROUTINE spelling | **RED** |
| `gate 5 R2-B` an unqualified grant | **RED** |
| `gate 6 N4` a revoke that is only a trailing `--` comment | **RED** |
| `gate 5 R2-D` (INVOKER, pinned) | **RED** |
| `gate 7 B3` the revokes narrowed to `from public` | **RED** |
| **total** | **6 failed \| 23 passed (29)** |

The narrower conclusion survives and is the one that matters: **EV-A stays GREEN while R2-D goes RED**,
so R2-D is not a duplicate of EV-A. What does not survive is the claim that it was the *only* red — six
cases depend on the ACL rule, which is unsurprising, because the ACL rule is most of the posture.

*(Superseded on 2026-08-08: the case was rebuilt again at gate 9. Its ADP statement was still inert —
`PLATFORM_SHIM` already grants what it granted — so it now grants to a role the shim does not
pre-grant and asserts that grantee by name, with a control. See
`evidence/2026-08-08-gate9-fix-pass.md`.)*

## 3. The table-posture rule had no negative control — it does now

The rule asserted the clean state and nothing else, so nothing showed it could fail for the right
reason. Extracted from its `it` into `tableViolations(db, table)` and driven against hostile inputs:

| control | asserted violation |
|---|---|
| `grant select on public.frontier to anon` | `anon holds privileges` |
| `grant select on public.frontier to public` | `PUBLIC holds privileges` |
| `alter table public.frontier disable row level security` | `RLS is disabled` |
| `create policy p_open … to anon using (true)` | `policy` — RLS **on** is not the same as **closed** |
| `grant select on public.audits to anon` | none — the rule is not simply always-red |

**Mutation:** force `tableViolations` to return `[]`.

```
× catches: a direct grant to a client role
× catches: a grant to PUBLIC, which names no role at all
× catches: RLS switched off
× catches: a permissive policy added — RLS on is not the same as closed
✓ does NOT fire on an unrelated table
✓ ALTER DEFAULT PRIVILEGES alone changes nothing
   Tests  4 failed | 25 passed (29)
```

Exactly the four hostile controls die; both true-negatives survive. The controls are live and specific.

## 4. The arithmetic in `15628ca`

That message claims "all six from gate 4, all seven from gate 5" are committed cases. The file's real
composition, counted: **13 committed evasion cases — 1 from gate 4, 5 from gate 5, 7 from gate 6.**

The separate and TRUE claim is that the *mechanism* catches the rest — a catalog read does not care
which filename or naming convention an evasion used. The two claims were conflated. History is not
rewritten (the commit is pushed), so the correction is recorded in the tracked file's header.

---

## 5. A finding inside a prior fix on this branch — reported, per §8

Not part of B2's four items; found while measuring them. **B3's shim, added by `54c9328` on this
branch, contains a line that does not do what its comment implies.**

```sql
alter default privileges in schema public revoke execute on functions from public;
```

**Measured under PGlite:** it records nothing in `pg_default_acl`, and a function created afterwards
still comes out holding `=X` (PUBLIC):

```
ADL rows:    [{"t":"f","acl":"{anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}]
new fn ACL:  {"acl":"{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}
```

Identical with the statement ordered before or after the grants.

**Production, read live (`ezspnfeyzwsisymytssm`):** `pg_default_acl` objtype `f` owned by `postgres` is
`{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` — no PUBLIC
entry, matching the shim's comment. All 8 `public` functions carry explicit ACLs
(`{postgres=X/postgres,service_role=X/postgres}`), 0 have a null ACL, and 0 ADP rows grant PUBLIC.

**What is NOT established.** Every production function has an explicit revoke, so production offers no
un-revoked function to compare against, and confirming whether a *new* production function would carry
`=X` needs a write to production. Not done.

**Direction of the error.** The sandbox is at worst MORE permissive on the PUBLIC axis than production.
For a guard that can only add violations, never mask one — the opposite of B3's failure, which was the
sandbox being *safer*. No assertion in the file is affected: the four real functions carry explicit
revokes, so the `reproduces production byte-for-byte` test is untouched and still matches.

**Why the line is kept rather than deleted.** It states the intent, and deleting it is a change to a
security control's shim that the owner has not ruled on. It is now commented with exactly what it does
and with the condition that matters: **if PGlite ever implements ADP revoke-from-PUBLIC, the sandbox
becomes SAFER than production on that axis — the exact direction B3 failed in — and the block must be
re-measured against production that day.**

Per OPERATING-RULES §8, this is reported rather than quietly patched, because it lands inside a fix
made earlier on this same branch.

---

## 6. Suite

`spec51a-frontier-privilege-catalog.test.ts`: **23 → 29 tests, all passing** (~38s; this file is the
local-gate cost noted in the handoff — the repo has no CI).
