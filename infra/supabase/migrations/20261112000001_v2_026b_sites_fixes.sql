-- v2 signed-in product (CC-26b D4, D5, D6): the SQL that holds the account's limits and the fix
-- lifecycle, so two concurrent requests cannot both pass a cap. Spec:
-- docs/specs/v2/26b-dashboard-wiring.md. Functions are owned by postgres, revoked from every client
-- role and granted to service_role only; each route checks the caller's membership through the
-- caller's own session before calling one.
--
-- The statements are re-runnable (the tests apply the file twice).
-- The revert is infra/supabase/rollbacks/20261112000001_v2_026b_sites_fixes.revert.sql.

-- ═══ A: sites and re-checks (D4, D6) ══════════════════════════════════════════════════════════════

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: fixes and the persist watermark (D5) ══════════════════════════════════════════════════════

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════
