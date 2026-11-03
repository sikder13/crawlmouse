-- Revert of infra/supabase/migrations/20261103000001_v2_006b_ledger_usage.sql.
--
-- ⚠ Drops public.usage_events, public.check_ledger_links and the `research` schema with every ledger
-- row, and the research_retention role. Take a dump first: the ledger is kept indefinitely, so a
-- revert after it holds rows loses data nothing else has.
--
-- Every statement is re-runnable (v2-006b-data-foundations.test.ts runs it twice).

drop table if exists public.usage_events;
drop function if exists public.usage_events_append_only();
drop function if exists public.usage_events_references();

drop table if exists public.check_ledger_links;

-- Their partitions, in `partitions`, go with them.
drop table if exists research.crawler_observations;
drop table if exists research.check_runs;
drop function if exists research.check_runs_supersedes_same_site();
drop function if exists research.ledger_append_only();
drop schema if exists research;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'research_retention') then
    drop role research_retention;
  end if;
end;
$$;
