-- SPEC 5.1a §8 (Stage 6) — the two round-level frontier writes, each as ONE statement.
--
-- No table is created, altered or dropped. No policy is created, changed or widened. No backfill.
-- Two functions over the tables from 20260805000001, alongside the two in 20260806000001.
--
--   settle_frontier_batch  — record a whole round's outcomes atomically.
--   upsert_frontier_batch  — record a whole round's discoveries without disturbing their state.
--
-- Both exist for the same underlying reason the claim did: the operation is expressible in SQL and
-- NOT in PostgREST, so writing it through the client would either lose a guarantee or silently
-- depend on what a third party's query builder happens to emit.
--
-- ══ 1. settle_frontier_batch — WHY ATOMICITY IS LOAD-BEARING, MEASURED RATHER THAN ARGUED ═════════
--
-- Settling a round as N independent single-row writes admits a state ONE statement cannot produce: a
-- PARTIALLY-SETTLED ROUND — some rows `fetched`, the rest still `claimed` — because the worker died
-- partway through the batch.
--
-- That state MOVES THE SAMPLE. On resume the still-`claimed` rows are released back into the pool
-- (correctly: the worker died holding them, so they must not count as consumed). But they re-enter
-- selection in a LATER round, against a pool already grown by their siblings' children — the children
-- commit at the preceding step. The §6 stratified round-robin then balances quotas across a different
-- set, and when the page cap binds the SELECTED COMPOSITION diverges from a straight-through crawl.
--
-- MEASURED on an 85-page four-template fixture, sweeping every reachable death point:
--
--   page cap NOT binding (200)   every death point matched, digest 91f068d6d9a5
--   page cap BINDING     (40)    DIVERGED at two death points, both at settle:
--                                  settle#3 -> digest 11f5f602ca46, 36/40 pages in common
--                                  settle#4 -> digest 11f5f602ca46, 35/40 pages in common
--
-- Four to five pages of forty — a 10-12.5% swing in composition at a CONSTANT selected count, which
-- is the E1 failure mode in miniature: the page count holds while the sample moves. Only `settle` ever
-- produced it; `claim` and the child-upsert leave a whole batch claimed with nothing settled, and
-- those resume bit-for-bit. After this function, an exhaustive sweep of all 35 reachable death points
-- across three caps produced ZERO divergences.
--
-- The divergence was therefore never a property of the selection algorithm. It was an artifact of
-- choosing 25 independent writes over one statement.
--
-- SECONDARY, AND NOT THE JUSTIFICATION: ~25 database round trips per round removed from a 240 s crawl
-- budget. Worth having. Correctness is why it exists.
--
-- ══ 2. upsert_frontier_batch — WHY THE CLIENT'S UPSERT IS UNSAFE HERE ══════════════════════════════
--
-- PostgREST builds an upsert as `ON CONFLICT (target) DO UPDATE SET col = excluded.col`, with ONE
-- ASSIGNMENT PER KEY PRESENT IN THE PAYLOAD. The engine's frontier record carries `state:
-- 'discovered'`, so a re-staged row that had already reached `fetched` would be RESET to `discovered`
-- — re-fetched immediately, and on resume placed back in the pool instead of counted as consumed.
-- That is a composition move, i.e. precisely the defect this stage exists to prevent.
--
-- WHEN IS A ROW RE-STAGED? Only when a URL is re-discovered at a SHALLOWER depth; the crawler stages
-- on `new or shallower`. That is reachable because `batchDepth` is the MINIMUM depth in a batch and
-- every child of the batch is labelled `batchDepth + 1`: if the §6 quota defers a shallow URL to a
-- later round, `batchDepth` DECREASES, and children already known at a greater depth are re-staged
-- shallower.
--
-- POSSIBLE BUT UNOBSERVED, stated as such. Zero occurrences across two fixtures at both a binding and
-- a non-binding cap. Deferral of a shallow URL needs many strata and a binding cap, which describes a
-- real site better than an 85-page fixture. The implementation below makes REACHABILITY IRRELEVANT
-- rather than resting on a fixture hunt that would only ever prove the case it was built to prove.
--
-- The alternative — omitting `state` from the payload so PostgREST emits no assignment for it — works,
-- and was rejected: it would make correctness depend on a third party's SET-list construction, which
-- nothing in the local test suite can execute. Only the deployed live smoke touches the supabase-js
-- hop, so that choice would place a correctness rule entirely inside the one gap the tests cannot see.
--
-- ══ SECURITY POSTURE — identical to the two functions in 20260806000001, and for the same reasons ══
--
-- SECURITY INVOKER, not DEFINER: the only intended caller is `service_role`, which already holds full
-- DML on `frontier` plus BYPASSRLS, so DEFINER would add reachable privilege while removing none.
--
-- EXECUTE IS REVOKED FROM PUBLIC, AND THOSE LINES ARE LOAD-BEARING. Postgres grants EXECUTE on a new
-- function to PUBLIC by default, and `anon`/`authenticated` are members of PUBLIC. PostgREST publishes
-- every function in the exposed schema as an RPC endpoint at `/rest/v1/rpc/<name>`, so without the
-- revokes these would be row-mutating endpoints reachable from the open internet — in a way the
-- underlying tables (RLS on, zero policies, no client grant) deliberately are not.
--
-- `search_path` pinned on both (house convention, 20260526000002; Supabase linter 0011).
--
-- Both take PARALLEL ARRAYS rather than a jsonb blob so element types are checked by Postgres instead
-- of by us. `unnest` pads a short array with NULLs, so a length mismatch writes FEWER rows rather than
-- corrupting any — the safe failure direction.

-- ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.settle_frontier_batch(
  p_audit_id   uuid,
  p_url_hashes text[],
  p_states     text[]
)
returns integer
language sql
security invoker
set search_path = public, pg_catalog
as $$
  with outcome as (
    select u.url_hash, u.state
      from unnest(p_url_hashes, p_states) as u(url_hash, state)
     -- ONLY the three terminal states. A caller passing 'discovered' or 'claimed' would UN-SETTLE a
     -- row, which on the next resume would re-fetch a page already read — so the settle verbs are
     -- enumerated here rather than left to the table's broader CHECK constraint. Anything else is
     -- dropped, leaving the row `claimed`, which a resume handles safely by re-fetching it.
     where u.state in ('fetched', 'failed', 'skipped')
  ),
  updated as (
    update public.frontier f
       set state      = o.state,
           updated_at = now()
      from outcome o
     where f.audit_id = p_audit_id
       and f.url_hash = o.url_hash
    returning 1
  )
  select count(*)::integer from updated;
$$;

comment on function public.settle_frontier_batch(uuid, text[], text[]) is
  'SPEC 5.1a §8 — settle a whole crawl round in ONE statement. Atomicity is load-bearing: a '
  'partially-settled round releases its still-claimed rows into a later round against a larger pool, '
  'which moves the selected composition when the page cap binds (measured: 4-5 of 40). service_role only.';

-- ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.upsert_frontier_batch(
  p_audit_id     uuid,
  p_url_hashes   text[],
  p_urls         text[],
  p_template_keys text[],
  p_sample_keys  text[],
  p_depths       integer[],
  p_sources      text[]
)
returns integer
language sql
security invoker
set search_path = public, pg_catalog
as $$
  with incoming as (
    -- DISTINCT ON, keeping the SHALLOWEST depth per hash: `ON CONFLICT DO UPDATE` raises if one
    -- statement tries to affect the same row twice, and the caller's dedupe must not be the only
    -- thing standing between a duplicate and a failed crawl.
    select distinct on (u.url_hash)
           u.url_hash, u.url, u.template_key, u.sample_key, u.depth, u.source
      from unnest(p_url_hashes, p_urls, p_template_keys, p_sample_keys, p_depths, p_sources)
        as u(url_hash, url, template_key, sample_key, depth, source)
     where u.url_hash is not null
       and u.url is not null
       and u.depth is not null
       and u.source in ('homepage', 'sitemap', 'link')
     order by u.url_hash, u.depth
  ),
  written as (
    insert into public.frontier (audit_id, url_hash, url, template_key, sample_key, depth, source)
    select p_audit_id, i.url_hash, i.url, i.template_key, i.sample_key, i.depth, i.source
      from incoming i
    on conflict (audit_id, url_hash) do update
      -- `state` IS DELIBERATELY ABSENT FROM THIS SET LIST, and its absence is the whole point: a URL
      -- re-discovered at a shallower depth must lower its depth WITHOUT un-settling a row that has
      -- already been fetched. This is exactly what a client-side upsert cannot express.
      set depth      = least(frontier.depth, excluded.depth),
          updated_at = now()
    returning 1
  )
  select count(*)::integer from written;
$$;

comment on function public.upsert_frontier_batch(uuid, text[], text[], text[], text[], integer[], text[]) is
  'SPEC 5.1a §8 — record a round''s discoveries in ONE statement. Lowers depth via least() and NEVER '
  'names state, so re-discovering a fetched URL cannot reset it to discovered — which a PostgREST '
  'upsert would do, since it emits SET col = excluded.col per payload key. service_role only.';

-- ──────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function public.settle_frontier_batch(uuid, text[], text[]) from public, anon, authenticated;
revoke execute on function public.upsert_frontier_batch(uuid, text[], text[], text[], text[], integer[], text[]) from public, anon, authenticated;

grant execute on function public.settle_frontier_batch(uuid, text[], text[]) to service_role;
grant execute on function public.upsert_frontier_batch(uuid, text[], text[], text[], text[], integer[], text[]) to service_role;

notify pgrst, 'reload schema';
