-- Revert of infra/supabase/migrations/20261117000002_v2_038_qa.sql. The table's rows go with it: they
-- record which accounts qa:seed made. Re-applying the migration writes no row, so it hands qa_reset no
-- account by itself. A later qa:seed writes a row again for an account of a user it made that holds
-- nothing it did not add: a personal account with no site, or an agency account whose one live site
-- is its first QA site (scripts/qa/seed.ts isFresh); an account of that user holding anything else
-- it refuses.
drop function if exists public.qa_reset(uuid);
drop table if exists public.qa_accounts;
