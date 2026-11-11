-- Revert of infra/supabase/migrations/20261112000001_v2_026b_sites_fixes.sql.
--
-- ⚠ Turn V2_CHECKS_PUBLIC off in production first: the CC-26b routes call these functions.
--
-- The statements are re-runnable.

-- ═══ A: sites and re-checks ═══════════════════════════════════════════════════════════════════════
-- Drops the five functions section A adds; it changes no table, so no row is touched.

drop function if exists public.request_capped_check(jsonb, integer, jsonb);
drop function if exists public.add_site(jsonb, jsonb, integer, jsonb, jsonb);
drop function if exists public.edit_site(uuid, jsonb);
drop function if exists public.remove_site(uuid);
drop function if exists public.take_rate_slot(jsonb);

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: fixes and the persist watermark ═══════════════════════════════════════════════════════════

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════
