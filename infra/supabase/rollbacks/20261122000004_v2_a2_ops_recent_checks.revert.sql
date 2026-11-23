-- Revert of infra/supabase/migrations/20261122000004_v2_a2_ops_recent_checks.sql. It drops the view.
-- Nothing depends on it, and no row changes.
drop view if exists public.ops_recent_checks;
