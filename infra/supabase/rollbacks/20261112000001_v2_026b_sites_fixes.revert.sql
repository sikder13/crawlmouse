-- Revert of infra/supabase/migrations/20261112000001_v2_026b_sites_fixes.sql.
--
-- ⚠ Turn V2_CHECKS_PUBLIC off in production first: the CC-26b routes call these functions.
--
-- The statements are re-runnable.

-- ═══ A: sites and re-checks ═══════════════════════════════════════════════════════════════════════
-- Drops the four functions section A adds; it changes no table, so no row is touched.

drop function if exists public.request_capped_check(jsonb, integer);
drop function if exists public.add_site(jsonb, jsonb, integer);
drop function if exists public.edit_site(uuid, jsonb);
drop function if exists public.remove_site(uuid);

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: fixes and the persist watermark ═══════════════════════════════════════════════════════════

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════
