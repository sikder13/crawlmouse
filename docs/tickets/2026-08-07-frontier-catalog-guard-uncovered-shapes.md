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

## The four shapes

| # | Shape | Why it is invisible |
|---|---|---|
| 1 | **View indirection** — a `security definer` function deleting from a VIEW over `frontier` | `prosrc` reads `frontier_v`; the word-boundary match (`\m…\M`) does not see that as `frontier`. A non-atomic `language sql` body records no `pg_depend` edge, so predicate (1) is empty too. |
| 2 | **Dynamic SQL** — `plpgsql`, table name concatenated (`execute 'delete from ' \|\| 'front' \|\| 'ier'`) | There is no table name in `prosrc` to match, and nothing for the parser to record a dependency on. |
| 3 | **Cross-schema wrapper** — helper in `util`, wrapper in `public` calling it | The wrapper's body names neither the table nor the string `frontier`; the helper is outside the `public` schema scope the query restricts to. |
| 4 | **`prokind = 'p'` (procedures)** | Dropped by `where p.prokind = 'f'` in the discovery query. A procedure can empty the table exactly as well as a function can. |

## Why it is being documented rather than closed

Owner ruling, gate 7:

> "Your recommendation is right: document the limit rather than make a fourth completeness claim. My
> live post-apply verification stays the runbook standard and already catches what this cannot. A
> guard with an honest limit beats a guard with a false claim."

The compensating control is the **post-apply verification in the migration runbook**: the same posture
is read from PRODUCTION's `pg_proc` after the owner applies a migration. That check is shape-agnostic —
it reads the ACL of whatever actually exists — so it catches all four. The catalog test is the
*pre-apply* control, and it now states its own boundary in its header.

## If this is picked up later

Ordered by cost, cheapest first:

1. **`prokind`** — widening the filter to `in ('f','p')` is a one-token change and closes shape 4
   outright. It is the only one of the four that is a filter rather than a discovery limit. **Do this
   one first if any of them is done.**
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
