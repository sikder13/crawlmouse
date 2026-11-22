-- v2 V2R A2 (RC-04): two failure reasons for a check that read no page of the site.
--
-- A crawl that read no page used to end `partial` or `finished`, with a result screen about nothing.
-- It now fails: `site_unreachable` when robots.txt on the homepage's origin got no answer and no other
-- origin answered, and `nothing_read` for any other way to read no page (inngest/check-events.ts).
--
-- Until this is applied, fail_check refuses both words and failCheck
-- (apps/web/lib/v2/pipeline/steps/lifecycle.ts) stores `internal` instead.
--
-- check_failure_reasons() (migration 008, replaced by 042a) is the closed list fail_check and
-- reap_stalled_checks refuse to write outside. This replaces it with FAILURE_REASONS in
-- inngest/check-events.ts, in its order; __tests__/v2-008-pipeline.test.ts holds the two equal.
-- No table, column, row or other function changes. `create or replace` keeps the function's owner
-- and grants; they are stated again below all the same.

create or replace function public.check_failure_reasons()
returns text[]
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select array['paused', 'site_busy', 'canceled', 'stalled', 'not_started', 'worker_redeployed',
               'worker_unavailable', 'capacity_wait_exceeded', 'site_unreachable', 'nothing_read',
               'build_failed', 'persist_failed', 'internal']::text[]
$$;

alter function public.check_failure_reasons() owner to postgres;
revoke all on function public.check_failure_reasons() from public, anon, authenticated, service_role;
grant execute on function public.check_failure_reasons() to service_role;
