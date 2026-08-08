# SPEC 5.1a Stage 6 — frontier SQL functions: migration runbook

> **⚠ SUPERSEDED IN PART — READ THIS FIRST.**
> **All four functions are APPLIED to production and verified.** Nothing below is pending.
>
> **Stage 5's wiring was CUT from 5.1a on measured evidence** (zero of 234 production audits would
> ever have resumed; the checkpoint deletes its recovery data immediately before the most common real
> failure point). The four functions are therefore **live but UNCALLED**, and `frontier` /
> `frontier_politeness` are **empty by design, not by oversight**.
>
> Consequently, in the sections below: the `FRONTIER_CHECKPOINT` flag **no longer exists** in the
> codebase, `inngest/frontier-store.ts` and `inngest/frontier-sql.integration.test.ts` are **deleted**,
> and the daily cron **no longer calls** `delete_orphan_frontier_rows`. Do not follow §4 or §7.
>
> The full record, the B-1 defect, its ruled fix and everything SPEC 06 inherits:
> **`evidence/2026-08-06-spec06-frontier-carry-forward.md`**.

Two migrations, four functions, no table or policy touched, no backfill.

| migration | functions | status |
|---|---|---|
| `20260806000001_spec51a_stage6_frontier_functions.sql` | `claim_frontier`, `delete_orphan_frontier_rows` | **APPLIED + verified 2026-08-06** |
| `20260806000002_spec51a_stage6_settle_frontier_batch.sql` | `settle_frontier_batch`, `upsert_frontier_batch` | **APPLIED + verified 2026-08-06** |

Both were rehearsed against a real PostgreSQL 17.10 (production is 17.6) with the Stage 5 migration
applied first, via `embedded-postgres`. The integration test
(`inngest/frontier-sql.integration.test.ts`) applies all three migration files to a real server on
every run, so these are executed rather than merely reviewed.

---

## 1. Why these functions exist at all

Each one is an operation the worker cannot express through supabase-js → PostgREST, or one whose
correctness cannot be tested if it is expressed there.

- **`claim_frontier`** — `FOR UPDATE SKIP LOCKED` has no PostgREST grammar. Verified against the
  installed `postgrest-js`: no `for update`, no `skip locked`, no `forUpdate`.
- **`settle_frontier_batch`** — must be ONE statement. Settling row by row lets a worker die mid-round
  leaving some rows `fetched` and the rest `claimed`, which moves the selected composition when the page
  cap binds (measured: 4–5 pages of 40, twice).
- **`upsert_frontier_batch`** — PostgREST emits `SET col = excluded.col` per payload key, so a re-staged
  row carrying `state:'discovered'` would reset a row already `fetched`. The SQL lowers depth via
  `least()` and never names `state`.
- **`delete_orphan_frontier_rows`** — expressible as a builder chain, but then the shipped predicate can
  only be tested against a stub. As SQL, a real server executes it in every test run, including the
  assertion that it uses `frontier_updated_at_idx` rather than full-scanning the largest table.

The precedent is already in the repo: `20260601000008_embed_view_increment.sql` exists for the identical
reason and says so.

## 2. Security posture — the same for all four

- **`SECURITY INVOKER`**, not DEFINER. The only intended caller is `service_role`, which already holds
  full DML on `frontier` plus BYPASSRLS, so DEFINER would add reachable privilege while removing none.
  (`increment_embed_view` is correctly DEFINER for the opposite reason — its caller, `anon`, *lacks* the
  privilege. The postures differ because the callers differ.)
- **`search_path` pinned** to `public, pg_catalog` (house convention `20260526000002`; Supabase linter
  0011).
- **`REVOKE EXECUTE ... FROM public, anon, authenticated` precedes the `GRANT`, and is load-bearing.**
  Postgres grants EXECUTE on a new function to PUBLIC by default, and `anon`/`authenticated` are members
  of PUBLIC. PostgREST publishes every public-schema function at `/rest/v1/rpc/<name>`, so without the
  revoke these would be row-claiming and row-deleting endpoints reachable from the open internet — in a
  way the underlying tables (RLS on, zero policies, no client grant) deliberately are not.

## 3. Rehearsal result (real PG 17.10, all three migrations applied in order)

```
claim_frontier:              definer=false path=pinned anon=false auth=false service_role=true
delete_orphan_frontier_rows: definer=false path=pinned anon=false auth=false service_role=true
settle_frontier_batch:       definer=false path=pinned anon=false auth=false service_role=true
upsert_frontier_batch:       definer=false path=pinned anon=false auth=false service_role=true
acl (all four) = {postgres=X/postgres,service_role=X/postgres}      <- no PUBLIC entry
```

Behavioural checks, all green:

- claim under **two real backends**: w1 holds locks on 3 rows uncommitted, w2 claims 3 disjoint rows in
  5 ms; without SKIP LOCKED the same statement is still blocked after 1000 ms.
- settle: 3 rows in one statement; an attempt to set a `fetched` row back to `discovered` changes 0 rows.
- upsert: re-discovery at depth 2 after being settled → `depth=2, state=fetched` (state preserved); a
  deeper re-discovery does not raise the depth; a duplicate hash in one batch does not raise; another
  audit's rows are unreachable; an invalid `source` writes 0 rows.
- sweep: 25h and 40d rows deleted, a 23h row kept; plan is `Limit > Index Scan` on
  `frontier_updated_at_idx` at 20 000 rows, no `Seq Scan`.

## 4. Apply

Apply `20260806000002` via the Supabase MCP / Management API, as with the previous three.

**Order matters:** `20260805000001` → `20260806000001` → `20260806000002`. The later files reference
`public.frontier`, which the first creates.

## 5. Post-apply verification

> **⚠ THIS QUERY USED TO CARRY ITS OWN LIST OF FOUR FUNCTION NAMES** (`and p.proname in (…)`) — the
> exact "carries its own list" defect the pre-apply source matcher was deleted for at gate 4. Because
> of it, this check could not see a differently-named routine, and it was measured missing five
> anon-callable routines that were deleting `frontier` rows (gate 8 / R2-B2). That mattered more than
> a normal false claim: **this is the shape-agnostic control that the pre-apply guard's accepted
> limit depends on.** It is name-free now — it asks what is REACHABLE and who can EXECUTE it, not
> what anything is called.

```sql
-- POSTURE, SHAPE-AGNOSTIC. Every routine in `public` — functions AND procedures — that any client
-- role can execute. Nothing here names a function, so a new one is covered the day it is created.
select p.proname,
       p.prokind::text                                           as kind,
       p.prosecdef                                               as definer,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service,
       p.proacl::text                                            as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind in ('f', 'p')
   and (has_function_privilege('anon', p.oid, 'EXECUTE')
     or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
 order by p.proname;
```

**Expect ZERO ROWS.** Any row is a routine an unauthenticated or signed-in visitor can invoke through
PostgREST at `/rest/v1/rpc/<name>`. Read every row and justify it before proceeding — do not assume an
unfamiliar name is harmless, because the escalation shape that defeated the pre-apply guard was a
plausible-looking helper wrapping another helper.

```sql
-- And the four this migration set owns, by name, so their exact posture is on the record.
select p.proname, p.prosecdef as definer, p.proconfig, p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('claim_frontier','delete_orphan_frontier_rows',
                     'settle_frontier_batch','upsert_frontier_batch')
 order by p.proname;
```

Expect four rows: `definer=false`, `proconfig` containing `search_path=public, pg_catalog`, and
`acl = {postgres=X/postgres,service_role=X/postgres}` — **no PUBLIC entry and no client role**.

```sql
-- TABLE posture, also name-free for the two governed tables: RLS on, no policies, no client grants,
-- and no COLUMN-level grants either (relacl and attacl are different catalogs; a column grant is
-- invisible to a relacl check).
select c.relname,
       c.relrowsecurity                                            as rls,
       (select count(*) from pg_policy where polrelid = c.oid)     as policies,
       c.relacl::text                                              as table_acl,
       (select string_agg(a.attname || '=' || a.attacl::text, ', ')
          from pg_attribute a
         where a.attrelid = c.oid and a.attacl is not null)        as column_acls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('frontier','frontier_politeness');
```

Expect `rls=true`, `policies=0`, a `table_acl` naming only `postgres` and `service_role`, and
`column_acls` **null**.

```sql
-- the sweep on an empty frontier must be a no-op
select public.delete_orphan_frontier_rows(500);   -- expect 0
select count(*) from public.frontier;             -- expect 0
```

## 6. Rollback

`drop function if exists public.<name>(<signature>);` for any of the four. No table, column, policy or
row is touched by either migration, so dropping the functions returns the schema to its pre-Stage-6
state exactly. The worker tolerates this only with the checkpoint flag off (§7).

## 7. The code ships DARK — do not flip before this is applied

> ⚠ **CORRECTED (gate 8 / R2-N4). `FRONTIER_CHECKPOINT` DOES NOT EXIST.** This section described it as
> a live kill-switch that "defaults off". Measured: **zero occurrences in any `.ts`/`.tsx`/`.js`/`.json`
> in the repo**, and `packages/engine/src/index.ts` records the checkpoint module as *"DELIBERATELY NOT
> EXPORTED … unwired"*. The banner at the top of this runbook already said the flag no longer exists;
> this section contradicted it. A runbook promising an off-ramp that would not exist on the day it is
> needed is worse than one that says there is none.

**There is currently no flag, because there is nothing to gate: the worker never injects the store.**
The frontier checkpoint is unwired — the functions are applied and **uncalled**. That is the ENGINE_V2
pattern's intent (`PROJECT_OVERVIEW.md` §11: the core pipeline was once 100% broken in production while
every "proven live" test passed), reached by not shipping the call site rather than by shipping it
behind a flag.

**Before the worker is ever wired to these functions, a flag must be added back**, defaulting off, and
flipped only after the migration is applied and the live smoke on the **deployed** Vercel function
passes. A store fault surfaces as *every* audit failing, so there is no safe way to wire it un-gated.

Flipping before the migration is applied makes the first RPC 404 and fails every audit. Note also that
Vercel snapshots environment variables into a deployment: a dashboard flip only reaches the running
functions after a redeploy.

## 8. Known coverage boundary

Nothing in the local suite executes the **supabase-js hop**. Both store adapters are thin and share the
same SQL functions, and the local tests prove the SQL and the semantics against a real server — but the
PostgREST transport itself is exercised **only** by the live smoke on the deployed function. Stated as a
limit, not as a risk that has been mitigated.
