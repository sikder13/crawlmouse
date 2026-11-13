-- Reverts 20261115000001_v2_033_operations.sql. Re-runnable. Sections run in reverse order.

-- ═══ §K ═══════════════════════════════════════════════════════════════════════════════════════════

-- ═══ end §K ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §C ═══════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.signin_delivery_seen(text, timestamptz);
drop function if exists public.founder_signups_unannounced(timestamptz, integer);
drop function if exists public.founder_digest_counts(timestamptz, timestamptz);
drop function if exists public.take_founder_overflow(text, integer);
drop function if exists public.claim_founder_notice(text, text, uuid, boolean, timestamptz, jsonb,
                                                    timestamptz, integer, boolean);
drop table if exists public.founder_notices;
-- ═══ end §C ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §A ═══════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.operator_finish(bigint, text);
drop function if exists public.operator_request_check(uuid, uuid, text, jsonb, integer, jsonb);
drop function if exists public.operator_log(uuid, text, uuid, text, text, text);
drop table if exists public.operator_actions;
drop function if exists public.user_id_by_email(text);
drop function if exists public.operator_account_ids_by_email(text);
drop function if exists public.is_operator();
drop function if exists public.is_internal_subject(text, uuid);
alter table public.accounts drop column if exists internal;
drop table if exists public.operators;

-- ═══ end §A ══════════════════════════════════════════════════════════════════════════════════════
