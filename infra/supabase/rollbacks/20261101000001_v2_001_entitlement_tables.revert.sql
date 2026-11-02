-- Revert of infra/supabase/migrations/20261101000001_v2_001_entitlement_tables.sql.
--
-- ⚠ Deletes every row in accounts, subscriptions, seats, agency_brands and trial_ledger, and the
-- two users columns. Take a dump first. Before CC-05's backfill those rows are only the accounts
-- created by sign-ups since 001 was applied; v1 reads none of them.
--
-- Every statement is re-runnable. handle_new_user is restored to the body of
-- 20260601000004_user_provisioning.sql, character for character.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

alter table public.users drop column if exists default_account_id;
alter table public.users drop column if exists email_normalized;

drop function if exists public.apply_entitlement_transition(
  uuid, integer, text, text, text, timestamptz, text, timestamptz, timestamptz, timestamptz,
  integer, integer, integer, timestamptz, text, timestamptz);
drop function if exists public.assert_entitlement_version(uuid, integer);

drop table if exists public.trial_ledger;
drop table if exists public.agency_brands;
drop table if exists public.subscriptions;
drop table if exists public.seats;
drop table if exists public.accounts;
drop function if exists public.accounts_keep_first_history_entry();

drop function if exists public.member_role(uuid);
drop function if exists public.is_member(uuid);
