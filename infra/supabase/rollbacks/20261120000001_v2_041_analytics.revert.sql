-- Revert of infra/supabase/migrations/20261120000001_v2_041_analytics.sql. The attribution rows and
-- the ledger drafts go with their tables. Ledger rows the writer recorded stay: research is
-- append-only, and they hold nothing of the account. The role goes once nothing grants to it.
drop schema if exists analytics cascade;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'analytics_reader') then
    execute 'drop owned by analytics_reader';
    execute 'drop role analytics_reader';
  end if;
end;
$$;

drop function if exists public.record_check_ledger(uuid, jsonb, jsonb);
drop table if exists public.check_ledger_drafts;
drop table if exists public.account_attribution;
