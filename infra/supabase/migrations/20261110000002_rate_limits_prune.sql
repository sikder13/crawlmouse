-- B-F1: delete rate_limits rows whose window has ended.
--
-- apps/web/lib/rate-limit.ts refuses a window longer than 24 hours (MAX_RATE_LIMIT_WINDOW_MS in
-- apps/web/lib/rate-limit-window.ts) and aligns each window to a multiple of its length, so a row's
-- window is [window_start, window_start + its length). A row whose window started more than 25 hours
-- ago is past the longest window by at least an hour. The cutoff is fixed here, not passed in, so no
-- caller can delete a row inside its window. Each call deletes at most p_limit rows, capped at 5000;
-- the daily job (inngest/rate-limit-retention.ts) calls it until a call returns fewer.
--
-- Security invoker: it deletes with the caller's rights, and only service_role may execute it.
-- search_path names pg_catalog first and pg_temp last; the body qualifies every relation.
-- Running this file twice changes nothing (create or replace keeps the grants; revoke and grant are
-- idempotent; apps/web/__tests__/rate-limits-prune.test.ts). Rollback: infra/supabase/rollbacks/20261110000002_rate_limits_prune.revert.sql.

create or replace function public.prune_rate_limits(p_limit integer)
returns integer
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  with doomed as (
    select bucket_key, window_start
    from public.rate_limits
    where window_start < now() - interval '25 hours'
    order by window_start
    limit greatest(least(p_limit, 5000), 0)
  ), gone as (
    delete from public.rate_limits r
    using doomed d
    where r.bucket_key = d.bucket_key and r.window_start = d.window_start
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.prune_rate_limits(integer) from public, anon, authenticated;
grant execute on function public.prune_rate_limits(integer) to service_role;
