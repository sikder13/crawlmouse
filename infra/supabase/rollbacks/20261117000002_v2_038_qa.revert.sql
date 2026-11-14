-- Revert of infra/supabase/migrations/20261117000002_v2_038_qa.sql. The table's rows go with it: they
-- record which accounts qa:seed made. Re-applying the migration writes no row, so it hands qa_reset no
-- account by itself. A later qa:seed writes a row again for an account of a user it made, owned by
-- that user, whose live sites (staging copies and removed sites aside) are none, or, for an agency
-- account, its first QA site alone (scripts/qa/seed.ts isFresh); one with any other live site it
-- refuses. Removed sites and other people's seats are not looked at.
drop function if exists public.qa_reset(uuid);
drop table if exists public.qa_accounts;
