-- Revert of infra/supabase/migrations/20261121000001_v2_gl_removed_site_purge.sql. It drops the three
-- functions; no table, column or row is changed. What a purge already deleted stays deleted. The
-- expiry's purge-removed step calls these functions, so with them gone that step fails each daily
-- run; it is the run's last step, so the two before it still run. Deploy an app without the step
-- before reverting.
drop function if exists public.delete_removed_site_checks(uuid, timestamptz, uuid[]);
drop function if exists public.removed_site_checks(uuid, uuid, integer);
drop function if exists public.removed_sites_past_keeping(timestamptz, uuid, integer);
