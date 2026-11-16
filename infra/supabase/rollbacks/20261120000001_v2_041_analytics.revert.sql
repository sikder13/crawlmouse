-- Revert of infra/supabase/migrations/20261120000001_v2_041_analytics.sql. The attribution rows and
-- the ledger drafts go with their tables. Ledger rows the writer recorded stay: research is
-- append-only, and they hold nothing of the account. The role goes once nothing grants to it: its
-- only grants are on `analytics` and its views, which the cascade removes, and it owns nothing. (Not
-- `drop owned by`: since PG16 that needs the role's own privileges, which Supabase's non-superuser
-- `postgres` does not hold on a role it created, so the revert would abort there.)
--
-- First, PUBLIC gets back what the migration's section 5 revoked from it, as recorded in the comment
-- on schema `analytics`: each privilege on each object that still exists, and nothing else. With no
-- `analytics` schema there is no record and nothing to give back.
do $$
declare
  e jsonb;
begin
  if to_regnamespace('analytics') is null then
    return;
  end if;
  for e in
    select jsonb_array_elements(coalesce(
      obj_description('analytics'::regnamespace, 'pg_namespace')::jsonb, '[]'::jsonb))
  loop
    if e->>'privilege' not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
                               'TRIGGER', 'MAINTAIN', 'USAGE', 'CREATE') then
      raise exception 'the record on schema analytics names an unknown privilege: %', e;
    end if;
    if e->>'kind' = 'schema' and to_regnamespace(e->>'object') is not null then
      execute format('grant %s on schema %s to public', e->>'privilege', e->>'object');
    elsif e->>'kind' = 'table' and to_regclass(e->>'object') is not null then
      execute format('grant %s on table %s to public', e->>'privilege', e->>'object');
    end if;
  end loop;
end;
$$;

drop schema if exists analytics cascade;
drop role if exists analytics_reader;

drop function if exists public.record_check_ledger(uuid, jsonb, jsonb);
drop table if exists public.check_ledger_drafts;
drop table if exists public.account_attribution;
