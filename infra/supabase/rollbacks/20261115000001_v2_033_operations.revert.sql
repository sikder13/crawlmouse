-- Reverts 20261115000001_v2_033_operations.sql. Re-runnable. Sections run in reverse order.

-- ═══ §K ═══════════════════════════════════════════════════════════════════════════════════════════

-- ═══ end §K ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §C ═══════════════════════════════════════════════════════════════════════════════════════════

-- ═══ end §C ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §A ═══════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.operator_finish(bigint, text);
drop function if exists public.operator_request_check(uuid, uuid, text, jsonb, integer, jsonb);
drop function if exists public.operator_log(uuid, text, uuid, text, text, text);
drop table if exists public.operator_actions;
drop function if exists public.is_operator();
alter table public.accounts drop column if exists internal;
drop table if exists public.operators;

-- ═══ end §A ══════════════════════════════════════════════════════════════════════════════════════
