-- SPEC 5.1a §8 (Stage 6) — the two frontier operations that CANNOT be expressed through PostgREST.
--
-- No table is created, altered or dropped. No policy is created, changed or widened. No backfill.
-- This migration adds exactly two functions over the tables created by 20260805000001.
--
-- ── WHY THIS MIGRATION EXISTS AT ALL ──────────────────────────────────────────────────────────────
--
-- The worker reaches Postgres only through supabase-js -> PostgREST. Two of the five frontier
-- operations cannot be said in that language, and the project has been here before: the comment on
-- `increment_embed_view` (20260601000008) states the identical finding — "A SQL function is the only
-- way to express col = col + 1 atomically via PostgREST." Same limitation, same remedy.
--
--   1. CLAIM. §8 specifies `FOR UPDATE SKIP LOCKED`. PostgREST has NO row-locking grammar — verified
--      against the installed postgrest-js: no `for update`, no `skip locked`, no `forUpdate`.
--
--      A conditional UPDATE (`... where state = 'discovered' returning *`) was measured and IS
--      atomically disjoint under READ COMMITTED, so it was a real candidate. It was REJECTED, and on
--      the difference rather than on the similarity: SKIP LOCKED *skips* a locked row, a conditional
--      UPDATE *blocks* on it. That puts a lock wait into the claim path at
--      INNGEST_AUDIT_CONCURRENCY = 5 — latency-dependent behaviour in the one code path this spec has
--      spent its entire length removing latency from. Proven under two real backends (PG 18.4,
--      distinct pids): with SKIP LOCKED the second claimer returned a disjoint set in 3 ms; without
--      it, the same statement was still blocked after 1000 ms.
--
--   2. THE ORPHAN SWEEP. Not a PostgREST limitation — `deleteOrphanFrontierRows` already works as a
--      builder chain. It moves here so the deletion rule can be PROVEN against real Postgres in CI.
--      As a builder chain the shipped predicate can only be tested against a stub of the client, and
--      a stub proves nothing about the deployed path. As SQL it is executed by a real server in every
--      test run, including the assertion that it USES `frontier_updated_at_idx` rather than
--      full-scanning the largest table in the schema — an unindexed sweep returns exactly the same
--      rows, so a result-only assertion cannot tell the two apart.
--
-- ── SECURITY POSTURE — STATED, BECAUSE A FUNCTION IS A BIGGER SURFACE THAN THESE TABLES ────────────
--
-- `frontier` and `frontier_politeness` are unreachable by design: RLS on, zero policies, and no grant
-- to anon or authenticated (verified live 2026-08-06). A FUNCTION does not inherit that safety.
-- PostgREST publishes every function in the exposed schema as an RPC endpoint at
-- `/rest/v1/rpc/<name>`, so these two are addressable from the public internet in a way the tables
-- are not — and one of them CLAIMS rows while the other DELETES them.
--
-- SECURITY INVOKER (the default, stated explicitly here so it is a decision and not an omission).
-- NOT `security definer`. Definer would run the body as the function OWNER regardless of caller,
-- which is privilege we do not need: the only intended caller is `service_role`, which already holds
-- full DML on both tables plus BYPASSRLS. Definer would therefore ADD reachable privilege while
-- removing none. (`increment_embed_view` is correctly `security definer` for the opposite reason — it
-- is called by `anon`, which has no write privilege on `embed_badges`. The postures differ because
-- the callers differ.)
--
-- EXECUTE IS REVOKED FROM PUBLIC, AND THAT LINE IS LOAD-BEARING. Postgres grants EXECUTE on a new
-- function to PUBLIC by default, and `anon` and `authenticated` are members of PUBLIC. Without the
-- revoke below, creating these functions would silently publish a row-claiming and a row-deleting
-- endpoint to every unauthenticated caller on the internet — the single most dangerous line that
-- could be MISSING from this file. The grant that follows is then the narrowest that works:
-- service_role only.
--
-- `search_path` is pinned on both (house convention, 20260526000002 — Supabase linter
-- 0011_function_search_path_mutable). Pinned even under INVOKER: an unqualified name resolved through
-- a caller-controlled path is a hazard independent of whose privileges the body runs with.

-- ──────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. CLAIM — atomically take up to p_limit of the given URLs, skipping rows another worker holds.
-- ──────────────────────────────────────────────────────────────────────────────────────────────────
--
-- `state = 'discovered'` in the CTE is what makes a claim exclusive: a row already claimed, fetched,
-- failed or skipped cannot be taken again. SKIP LOCKED then means a second worker walks past a row
-- this one is mid-claim instead of queueing behind it.
--
-- ORDER BY url_hash is NOT cosmetic and is NOT a selection input. It fixes the order in which locks
-- are ACQUIRED, so two workers claiming overlapping sets cannot deadlock by taking the same two rows
-- in opposite orders. Which rows are SELECTED was decided before this function is ever called
-- (§6.6: selection is a pure function of the discovered set); this only decides who fetches them, and
-- the caller re-orders the result back into selection order so claim order cannot leak into the crawl.
create or replace function public.claim_frontier(
  p_audit_id   uuid,
  p_url_hashes text[],
  p_limit      integer
)
returns setof public.frontier
language sql
security invoker
set search_path = public, pg_catalog
as $$
  with candidate as (
    select f.audit_id, f.url_hash
      from public.frontier f
     where f.audit_id = p_audit_id
       and f.url_hash = any(p_url_hashes)
       and f.state = 'discovered'
     order by f.url_hash
     limit greatest(p_limit, 0)
     for update skip locked
  )
  update public.frontier f
     set state      = 'claimed',
         claimed_at = now(),
         updated_at = now()
    from candidate c
   where f.audit_id = c.audit_id
     and f.url_hash = c.url_hash
  returning f.*;
$$;

comment on function public.claim_frontier(uuid, text[], integer) is
  'SPEC 5.1a §8 — atomic frontier claim via FOR UPDATE SKIP LOCKED, which PostgREST cannot express. '
  'Decides WHO FETCHES, never WHAT IS SELECTED (§6.6). service_role only.';

-- ──────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. ORPHAN SWEEP — delete frontier rows untouched for longer than the TTL.
-- ──────────────────────────────────────────────────────────────────────────────────────────────────
--
-- THE FUNCTION OWNS THE PREDICATE, AND THAT IS THE POINT. Neither the cutoff nor the clock is a
-- parameter. A `p_ttl_hours` argument would put the constant back in TypeScript and leave two copies
-- to be kept in agreement — the hand-synchronised derivation class that has already cost this project
-- three separate defects (gradeInputsFrom, reachPercent, estimateSiteTotal). A `p_now` argument would
-- be worse than duplication: it would let any caller widen the predicate to "everything" without
-- touching this file, and a sweep that deletes live crawl state is indistinguishable from data loss.
-- With both owned here, widening the rule means editing this migration, which is exactly what the
-- test asserts against.
--
-- 24 HOURS is ~360x the 240 s crawl wall-clock budget, so it cannot truncate a live crawl even with
-- Inngest retries and queueing. The rule deliberately says NOTHING about the audit's status or TTL: a
-- crawl cannot meaningfully outlive its own budget, so "untouched for 24 h" is dead by construction
-- whatever killed it — one predicate covering failed, cancelled, null-expiry and worker-died, instead
-- of one branch per way a crawl can end.
--
-- BOUNDED, and the caller loops until it drains. This deletes EXACTLY the batch it selected and
-- returns the true number of rows removed. (The builder-chain version it replaces deleted by
-- `audit_id in (...)`, so it could remove more rows than it counted — the count is now honest.)
--
-- `order by f.updated_at` is what lets the planner use `frontier_updated_at_idx`. That index is
-- load-bearing: without it this becomes a full scan of the largest table in the schema, executed
-- daily, at precisely the moment that table is largest. The test asserts the PLAN, not just the rows.
create or replace function public.delete_orphan_frontier_rows(
  p_batch_size integer default 500
)
returns integer
language sql
security invoker
set search_path = public, pg_catalog
as $$
  with doomed as (
    select f.audit_id, f.url_hash
      from public.frontier f
     where f.updated_at < now() - interval '24 hours'
     order by f.updated_at
     limit greatest(p_batch_size, 0)
  ),
  removed as (
    delete from public.frontier f
     using doomed d
     where f.audit_id = d.audit_id
       and f.url_hash = d.url_hash
    returning 1
  )
  select count(*)::integer from removed;
$$;

comment on function public.delete_orphan_frontier_rows(integer) is
  'SPEC 5.1a §8 — orphan frontier sweep. Owns its own cutoff (24h) and clock so neither can be '
  'widened by a caller. Rides the existing daily cleanup cron as its own step. service_role only.';

-- ──────────────────────────────────────────────────────────────────────────────────────────────────
-- PRIVILEGES. The revoke MUST precede the grant, and must not be removed: without it both functions
-- are callable by anon and authenticated over HTTP (see the header).
-- ──────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function public.claim_frontier(uuid, text[], integer) from public, anon, authenticated;
revoke execute on function public.delete_orphan_frontier_rows(integer) from public, anon, authenticated;

grant execute on function public.claim_frontier(uuid, text[], integer) to service_role;
grant execute on function public.delete_orphan_frontier_rows(integer) to service_role;

-- PostgREST caches the schema; Supabase's ddl event trigger normally reloads it, and this makes the
-- reload explicit so a fresh RPC endpoint cannot 404 on the first call after apply.
notify pgrst, 'reload schema';
