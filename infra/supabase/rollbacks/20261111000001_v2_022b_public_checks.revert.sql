-- Revert of infra/supabase/migrations/20261111000001_v2_022b_public_checks.sql. Addresses stored in
-- checks.notify_email are dropped with the column. Section D's six functions and its index go; the
-- rows and stored paths they wrote stay as they are (a kept site stays kept). Re-runnable.

-- ─── Section D: keep and expiry ───────────────────────────────────────────────────────────────────

drop function if exists public.unsettled_kept_checks(timestamptz, uuid, integer);
drop function if exists public.delete_expired_unkept_sites(uuid[], timestamptz, timestamptz);
drop function if exists public.expired_unkept_sites(timestamptz, timestamptz, uuid, integer);
drop function if exists public.unkept_site_expired(uuid, timestamptz, timestamptz);
drop function if exists public.keep_check(uuid, uuid, uuid, text, integer, integer, jsonb);
drop function if exists public.move_check_paths(uuid, uuid, jsonb);
drop index if exists public.sites_unkept_idx;

-- ─── Section C: notify ────────────────────────────────────────────────────────────────────────────

alter table public.checks drop column if exists notify_email;
