-- v2 CC-42A: a failure reason of its own for a check that never won a crawler.
--
-- A check waits on the worker's `busy` answers for at most QUEUE_WAIT_MAX_S in all (inngest/check.ts).
-- One still without its first crawl batch once that budget is spent now fails
-- `capacity_wait_exceeded`, where it used to fail `worker_unavailable`, which keeps its meaning: the
-- worker did not answer.
--
-- check_failure_reasons() (migration 008) is the closed list fail_check and reap_stalled_checks
-- refuse to write outside. This replaces it with FAILURE_REASONS in inngest/check-events.ts, in its
-- order, the new word after worker_unavailable; __tests__/v2-008-pipeline.test.ts holds the two
-- equal. Nothing else changes: no table, column, row or other function. `create or replace` keeps
-- the function's owner and grants; they are stated again below all the same.

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
