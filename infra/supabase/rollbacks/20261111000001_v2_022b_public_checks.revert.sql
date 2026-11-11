-- Revert of infra/supabase/migrations/20261111000001_v2_022b_public_checks.sql. Addresses stored in
-- checks.notify_email are dropped with the column.

-- ─── Section D: keep and expiry ───────────────────────────────────────────────────────────────────

-- ─── Section C: notify ────────────────────────────────────────────────────────────────────────────

alter table public.checks drop column if exists notify_email;
