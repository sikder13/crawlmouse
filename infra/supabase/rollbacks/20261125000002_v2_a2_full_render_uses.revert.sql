-- Revert of infra/supabase/migrations/20261125000002_v2_a2_full_render_uses.sql. It drops the three
-- functions and the table. Run only with full renders off: this month's counts are lost, so every
-- paid account would have its whole allowance again.
drop function if exists public.full_renders_used(uuid);
drop function if exists public.give_back_full_render(uuid, uuid);
drop function if exists public.take_full_render(uuid, uuid, integer);
drop table if exists public.full_render_uses;
