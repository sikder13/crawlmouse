-- Revert of infra/supabase/migrations/20261123000001_v2_a2_render_budget.sql. It drops the two
-- functions and the two tables. Run only with rendering off: the counts of browser time are lost.
drop function if exists public.settle_render_ms(uuid, bigint);
drop function if exists public.reserve_render_ms(uuid, bigint, bigint);
drop table if exists public.render_reservations;
drop table if exists public.render_budget_days;
