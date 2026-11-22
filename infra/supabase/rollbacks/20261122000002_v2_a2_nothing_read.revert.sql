-- Revert of infra/supabase/migrations/20261122000002_v2_a2_nothing_read.sql. It restores 042a's list
-- of failure reasons, without `site_unreachable` and `nothing_read`. A check already failed with
-- either word keeps it. With the list reverted, fail_check raises on the words: the run's `fail` step
-- throws, and once its retries are spent the function's onFailure fails the check `internal` instead
-- (inngest/check.ts, failureReasonOf). Deploy an app without the reasons before reverting.
create or replace function public.check_failure_reasons()
returns text[]
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select array['paused', 'site_busy', 'canceled', 'stalled', 'not_started', 'worker_redeployed',
               'worker_unavailable', 'capacity_wait_exceeded', 'build_failed', 'persist_failed',
               'internal']::text[]
$$;

alter function public.check_failure_reasons() owner to postgres;
revoke all on function public.check_failure_reasons() from public, anon, authenticated, service_role;
grant execute on function public.check_failure_reasons() to service_role;
