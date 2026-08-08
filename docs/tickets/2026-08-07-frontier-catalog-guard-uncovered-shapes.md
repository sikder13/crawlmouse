# Frontier catalog guard — four function shapes it does not cover

**Filed:** 2026-08-07 · **Source:** SPEC 5.1a gate 7, blocker B2 · **Severity:** low (documented limit,
compensated by the post-apply control) · **Status:** open, not scheduled

## What this is

`apps/web/__tests__/spec51a-frontier-privilege-catalog.test.ts` asserts the privilege posture of every
function that can reach `public.frontier` / `public.frontier_politeness`, read from the Postgres
catalog after applying the real migrations. It replaced a source-text matcher that was evaded at three
consecutive gates.

Its coverage is **functions whose reachability to a governed table is visible in `pg_depend` or in
`prosrc`.** Gate 7 found that the file claimed more than that — it argued the discovery set was
*complete* — and produced four shapes that reach the table and are invisible to it. Each was proven
end to end by deleting real rows as `anon`.

**Measured, all four applied at once on top of the real migrations: 0 discovered, 0 violations.**

## The shapes found so far — 2 closed, 3 open

| # | Shape | Why it is invisible |
|---|---|---|
| ~~1~~ | ~~**View indirection** — a `security definer` function deleting from a VIEW over `frontier`~~ | **CLOSED 2026-08-08**, as a side effect of dropping the word boundary: `frontier_v` contains `frontier` as a substring. Measured before and after, and committed as a case. It was invisible before because the word-boundary match did not read `frontier_v` as `frontier`, and a non-atomic `language sql` body records no `pg_depend` edge. |
| 2 **OPEN** | **Dynamic SQL** — `plpgsql`, table name concatenated (`execute 'delete from ' \|\| 'front' \|\| 'ier'`) | There is no table name in `prosrc` to match, and nothing for the parser to record a dependency on. |
| 3 **OPEN** | **Cross-schema wrapper** — helper in `util`, wrapper in `public` calling it | The wrapper's body names neither the table nor the string `frontier`; the helper is outside the `public` schema scope the query restricts to. |
| 4 **OPEN** | **`prokind = 'p'` (procedures)** | Dropped by `where p.prokind = 'f'` in the discovery query. A procedure can empty the table exactly as well as a function can. |
| ~~5~~ | ~~**Same-schema wrapper** around a governed helper (`select public.delete_orphan_frontier_rows(p)`)~~ | **CLOSED 2026-08-08.** Underscore is a word character in Postgres ARE, so `delete_orphan_frontier_rows` never matched the word-bounded `frontier`. Found at gate 8 (R2-B1) after this ticket claimed the gap was the four above; it deleted 2 real rows as `anon` with the suite green. Fixed by matching `prosrc` as a **substring**, and committed as a case. |

## Why it is being documented rather than closed

Owner ruling, gate 7:

> "Your recommendation is right: document the limit rather than make a fourth completeness claim. My
> live post-apply verification stays the runbook standard and already catches what this cannot. A
> guard with an honest limit beats a guard with a false claim."

> ### ⚠ CORRECTED 2026-08-08 (gate 8 / R2-B2) — THE COMPENSATING CONTROL DID NOT COMPENSATE
>
> This paragraph claimed the post-apply runbook check was "shape-agnostic … so it catches all four".
> **That was never measured, and it was false.** The check filtered
> `p.proname in ('claim_frontier','delete_orphan_frontier_rows','settle_frontier_batch','upsert_frontier_batch')`
> — a hardcoded list of four names, i.e. the "carries its own list" defect the pre-apply source matcher
> was deleted for at gate 4. Run with five hostile anon-callable routines present, it returned the same
> four clean rows and saw none of them. **The accepted-risk argument for this ticket rested on it.**
>
> **Fixed** in `docs/deploy/spec51a-stage6-frontier-functions-runbook.md` §5: the query now names no
> function at all. It asks which routines in `public` (`prokind in ('f','p')`) any client role can
> EXECUTE, and expects **zero rows**. Executed against production 2026-08-08: **0 rows**. A companion
> table query covers `relacl` **and** `pg_attribute.attacl`, since a column grant is invisible to a
> `relacl` check.

The compensating control is the **post-apply verification in the migration runbook**: the posture is
read from PRODUCTION's catalog after the owner applies a migration. It is genuinely shape-agnostic now
— it names nothing and asks only what is executable by whom — so it covers shapes this pre-apply guard
does not, including ones not yet discovered. That is why the pre-apply guard is allowed to have gaps,
and why the runbook check is the thing to strengthen first when a new shape is found.

## If this is picked up later

Ordered by cost, cheapest first:

1. **`prokind`** — widening the filter to `in ('f','p')` is a one-token change and closes shape 4
   outright. It is the only one that is a filter rather than a discovery limit. **Do this one first if
   any of them is done.** (The runbook control already covers `prokind in ('f','p')`.)
2. **Cross-schema** — drop the `n.nspname = 'public'` restriction on discovery (keep it on the posture
   rule) and shape 3 closes. Cost: the governed set grows to every schema, which needs a look at what
   else it sweeps in.
3. **View indirection** — resolve views to their base tables via `pg_depend`/`pg_rewrite` and match on
   the resolved set. Real work, and correct in principle.
4. **Dynamic SQL** — not statically decidable in general. Any attempt here is heuristic, and a
   heuristic that is believed complete is precisely the failure mode this ticket exists to prevent.
   The post-apply control is the right home for this one, permanently.

## Related

- `evidence/2026-08-07-gate7-reports.md` — the gate that found it.
- `evidence/2026-08-07-b2-catalog-guard-claim.md` — the measurements behind this ticket.
- `docs/deploy/spec51a-stage6-frontier-functions-runbook.md` — the post-apply control.
