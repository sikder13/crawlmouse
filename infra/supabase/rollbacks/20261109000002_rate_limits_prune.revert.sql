-- Revert of infra/supabase/migrations/20261109000002_rate_limits_prune.sql. Rows the function
-- already deleted stay deleted; this removes the function only.

drop function if exists public.prune_rate_limits(integer);
