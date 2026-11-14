-- Revert of infra/supabase/migrations/20261117000002_v2_038_qa.sql. The table's rows go with it: they
-- record which accounts qa:seed made, and a later qa:seed refuses an account whose user it made but
-- whose row is missing, so re-applying the migration does not hand qa_reset an account by itself.
drop function if exists public.qa_reset(uuid);
drop table if exists public.qa_accounts;
