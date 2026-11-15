-- Revert of infra/supabase/migrations/20261120000001_v2_041_analytics.sql. The attribution rows and
-- the ledger drafts go with their tables. Ledger rows the writer recorded stay: research is
-- append-only, and they hold nothing of the account. The role goes once nothing grants to it: its
-- only grants are on `analytics` and its views, which the cascade removes, and it owns nothing. (Not
-- `drop owned by`: since PG16 that needs the role's own privileges, which Supabase's non-superuser
-- `postgres` does not hold on a role it created, so the revert would abort there.)
drop schema if exists analytics cascade;
drop role if exists analytics_reader;

drop function if exists public.record_check_ledger(uuid, jsonb, jsonb);
drop table if exists public.check_ledger_drafts;
drop table if exists public.account_attribution;
