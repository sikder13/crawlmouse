-- Revert of infra/supabase/migrations/20261116000002_v2_036_account_backfill.sql.
--
-- handle_new_user goes back to 001's body, character for character, with the search_path
-- 20261108000002 gave it: the schema fingerprint reads a function's text, so a body rebuilt in other
-- words would be a difference. Then provision_default_account is dropped.
--   pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-036-account-backfill.test.ts
--
-- What stays: the accounts, owner seats and default_account_id values the backfill wrote, and the
-- email_normalized values it filled. Once a backfilled user signs in, their account is the one they
-- use (sites, checks and billing hang off it), so deleting it would delete their v2 data; and a
-- backfilled account is the row a sign-up gets from 001's body, which this revert restores.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  perform 1 from public.users where id = new.id and default_account_id is null for update;
  if found then
    insert into public.accounts (kind, state, tier, seat_limit, site_limit, competitor_limit, state_history)
    values ('personal', 'free', 'free', 1, 1, 0,
            jsonb_build_array(jsonb_build_object(
              'state', 'free',
              'since', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
    returning id into v_account_id;

    insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
    values (v_account_id, new.id, new.email, 'owner', 'active', now());

    update public.users set default_account_id = v_account_id where id = new.id;
  end if;
  return new;
end;
$$;

drop function if exists public.provision_default_account(uuid, text);
