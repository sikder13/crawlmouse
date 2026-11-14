-- v2 migration 036 (CC-36): a v2 account for every user from before migration 001.
-- Spec: docs/specs/v2/36-cutover.md. Ruling: the owner's ruling 1 of 2026-11-13 on CC-36.
--
-- Migration 001 gave each new sign-up a personal account, its owner seat and users.default_account_id,
-- inside handle_new_user. Users who signed up before 001 have none of the three, and the v2 dashboard
-- shows them "No account to show". This file:
--   1. moves handle_new_user's account part, unchanged, into provision_default_account, which
--      handle_new_user now calls: one path for a sign-up and for the backfill;
--   2. calls it for every public.users row whose default_account_id is null;
--   3. fills users.email_normalized with public.normalize_email(email) where it is null.
--
-- What it does not do: start a trial, write trial_ledger, queue mail (email_sends), or touch auth.*,
-- users.pro_until, audits or public_reports. A backfilled account starts 'free' with the one-entry
-- history a sign-up gets. No foreign key or cascade is added.
--
-- Every statement is re-runnable: a second run finds no user without a default account and no null
-- email_normalized it can fill, and changes nothing. The tests apply the file twice:
--   pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-036-account-backfill.test.ts
-- The race with a sign-up is scripts/db/account-backfill-race.test.ts.
-- The revert is infra/supabase/rollbacks/20261116000002_v2_036_account_backfill.revert.sql.

-- ─── provision_default_account: account → owner seat → default account ───────────────────────────
-- 001's statements, with new.id and new.email as parameters. The `for update` on the users row is
-- the lock a sign-up and the backfill share: whichever runs second waits for the first to commit,
-- then reads a default_account_id and does nothing. Answers the new account's id, or null when the
-- user already had a default account or has no users row.
create or replace function public.provision_default_account(p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  perform 1 from public.users where id = p_user_id and default_account_id is null for update;
  if not found then
    return null;
  end if;

  insert into public.accounts (kind, state, tier, seat_limit, site_limit, competitor_limit, state_history)
  values ('personal', 'free', 'free', 1, 1, 0,
          jsonb_build_array(jsonb_build_object(
            'state', 'free',
            'since', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
  returning id into v_account_id;

  insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
  values (v_account_id, p_user_id, p_email, 'owner', 'active', now());

  update public.users set default_account_id = v_account_id where id = p_user_id;
  return v_account_id;
end;
$$;

-- Called by handle_new_user and by this file, both as the owner. No role is given EXECUTE, including
-- service_role, which the default privileges would otherwise grant it.
revoke all on function public.provision_default_account(uuid, text)
  from public, anon, authenticated, service_role;

-- ─── handle_new_user: the users insert, then the account part ─────────────────────────────────────
-- What it did before, in the same order and the same transaction as the auth.users insert. Its grants
-- are kept: create or replace leaves a function's ACL as it was.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  perform public.provision_default_account(new.id, new.email);
  return new;
end;
$$;

-- ─── The backfill ─────────────────────────────────────────────────────────────────────────────────
-- The owner seat's invited_email is users.email, as a sign-up's is the address it signed up with.
-- Measured on production 2026-11-13: 11 users without a default account, none holding a seat.
select public.provision_default_account(u.id, u.email)
  from public.users u
 where u.default_account_id is null
 order by u.id;

-- users.email is not null (v1's table). normalize_email raises on a value with no `@`, and the apply
-- then fails whole rather than leave a row out.
update public.users
   set email_normalized = public.normalize_email(email)
 where email_normalized is null;
