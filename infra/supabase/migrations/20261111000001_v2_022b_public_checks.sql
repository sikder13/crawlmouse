-- v2 migration 022b (CC-22b): what the public check flow stores beside a check.
--
-- Additive. No existing column, policy or grant is dropped or renamed. v1 reads none of it.
--
-- Section C (notify): checks.notify_email, the address a visitor leaves on the crawl screen to be
-- told when the check ends (POST /api/checks/[id]/notify). It is not granted to any client role:
-- 003 grants authenticated SELECT on checks column by column, so a column added later stays hidden.
-- It goes when the check's row goes.
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261111000001_v2_022b_public_checks.revert.sql.

-- ─── Section C: notify ────────────────────────────────────────────────────────────────────────────

alter table public.checks add column if not exists notify_email text;

-- ─── Section D: keep and expiry ───────────────────────────────────────────────────────────────────
