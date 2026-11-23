-- Revert of infra/supabase/migrations/20261122000003_v2_a2_kept_site_no_expiry.sql. It removes the
-- trigger and its function. No row changes: a check it stored without an expiry keeps none.
drop trigger if exists checks_kept_site_has_no_expiry on public.checks;
drop function if exists public.checks_kept_site_has_no_expiry();
