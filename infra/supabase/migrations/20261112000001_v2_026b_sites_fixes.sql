-- v2 signed-in product (CC-26b D4, D5, D6): the SQL that holds the account's limits and the fix
-- lifecycle, so two concurrent requests cannot both pass a cap. Spec:
-- docs/specs/v2/26b-dashboard-wiring.md. Functions are owned by postgres and revoked from every
-- client role; each section's header names the role each one is granted to. A route checks the
-- caller's membership through the caller's own session before it calls a service_role function.
--
-- The statements are re-runnable (the tests apply the file twice).
-- The revert is infra/supabase/rollbacks/20261112000001_v2_026b_sites_fixes.revert.sql.

-- ═══ A: sites and re-checks (D4, D6) ══════════════════════════════════════════════════════════════

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: fixes and the persist watermark (D5) ══════════════════════════════════════════════════════

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════
