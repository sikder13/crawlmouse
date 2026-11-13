-- v2 operations (CC-33): operators and the accounts marked internal, the support console's record of
-- what staff looked at and did, founder notices, and the founder mail kinds.
-- Spec: docs/specs/v2/33-operations.md.
--
-- Nothing in auth is touched and no cascade is added.
--
-- The statements are re-runnable (the tests apply the file twice).
-- The revert is infra/supabase/rollbacks/20261115000001_v2_033_operations.revert.sql.

-- ═══ §A: operators, accounts.internal, operator_actions (workstream A) ═══════════════════════════

-- ═══ end §A ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §C: founder notices (workstream C) ══════════════════════════════════════════════════════════

-- ═══ end §C ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §K: email_sends.kind, the founder kinds (written by the lead once CC-31 is on main) ══════════

-- ═══ end §K ══════════════════════════════════════════════════════════════════════════════════════
