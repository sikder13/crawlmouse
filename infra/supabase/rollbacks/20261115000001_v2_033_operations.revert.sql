-- Reverts 20261115000001_v2_033_operations.sql. Re-runnable. Sections run in reverse order.

-- ═══ §K ═══════════════════════════════════════════════════════════════════════════════════════════

-- ═══ end §K ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §C ═══════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.signin_delivery_seen(text, timestamptz);
drop function if exists public.founder_digest_counts(timestamptz, timestamptz);
drop function if exists public.take_founder_overflow(text, integer);
drop function if exists public.claim_founder_notice(text, text, uuid, boolean, timestamptz, jsonb,
                                                    timestamptz, integer, boolean);
drop table if exists public.founder_notices;
-- ═══ end §C ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §A ═══════════════════════════════════════════════════════════════════════════════════════════

-- ═══ end §A ══════════════════════════════════════════════════════════════════════════════════════
