-- Revert of infra/supabase/migrations/20261102000002_v2_005_sharing_columns.sql.
--
-- ⚠ Deletes the values in the columns 005 added. Before the backfill that fills them they hold only
-- what the v2 app has written since 005 was applied; v1 reads none of them. Take a dump first.
--
-- Every statement is re-runnable (v2-005-sharing-columns.test.ts runs it twice).

drop trigger if exists embed_badges_account_guard on public.embed_badges;
drop function if exists public.embed_badges_account_guard();

alter table public.email_events drop column if exists kind;
alter table public.email_events drop column if exists account_id;

alter table public.stripe_events drop column if exists payload_hash;
alter table public.stripe_events drop column if exists livemode;
alter table public.stripe_events drop column if exists account_id;

alter table public.embed_badges drop column if exists account_id;

alter table public.domain_verifications drop column if exists account_id;

alter table public.public_reports drop column if exists account_id;
alter table public.public_reports drop column if exists site_id;
alter table public.public_reports drop column if exists check_id;
