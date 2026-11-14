-- v2 launch QA (CC-38 D1, D2): the record of the accounts `pnpm qa:seed` made, and the reset that
-- returns one of them to its starting sites, checks, fixes and seats.
--
-- qa_accounts is written by the seed (scripts/qa/store.ts) with the service role, one row per account
-- it made: an agency user's personal account and their agency account carry the same key. No client
-- role holds anything on it. It has no foreign key: an account erased later leaves its row, and
-- qa_reset refuses that row because the account is gone.
--
-- qa_reset(p_account) refuses unless the account has a qa_accounts row AND accounts.internal is true
-- (CC-33's marker); both are read here, under the account row's lock, so no caller can reach an
-- account that is not ours by passing its id. It then deletes the account's sites (their checks,
-- fixes, alert rules and the rest go with them through the foreign keys migration 003 declares, as
-- for delete_expired_unkept_sites in 022b) and every seat but the active owner's. Left behind: the
-- checks' evidence objects in storage, and usage_events rows (docs/specs/v2/38-launch-qa.md, gaps).
-- It never writes accounts, subscriptions or any stripe_* table; the plan is the webhook's alone.
--
-- Rollback: infra/supabase/rollbacks/20261117000002_v2_038_qa.revert.sql

create table if not exists public.qa_accounts (
  account_id uuid primary key,
  qa_key text not null check (qa_key ~ '^[a-z][a-z-]{1,23}$'),
  created_at timestamptz not null default now()
);

alter table public.qa_accounts enable row level security;
-- Supabase's default privileges give service_role every privilege on a new table; it keeps select and
-- insert only (the seed's two calls).
revoke all on table public.qa_accounts from public, anon, authenticated, service_role;
grant select, insert on table public.qa_accounts to service_role;

create or replace function public.qa_reset(p_account uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_sites integer;
  v_seats integer;
begin
  if p_account is null then
    raise exception 'qa_reset: p_account is required' using errcode = '22023';
  end if;

  perform 1
    from public.accounts a
    join public.qa_accounts q on q.account_id = a.id
   where a.id = p_account and a.internal and a.deleted_at is null
     for update of a;
  if not found then
    raise exception 'qa_reset: % is not an account qa:seed made and marked internal', p_account
      using errcode = '42501';
  end if;

  -- An account-wide rule's last firing names a check, with no action on delete (migration 003); a
  -- rule that has fired would refuse the sites' delete. The reset returns it to never having fired.
  update public.alert_rules r set last_fired_at = null, last_fired_check_id = null
   where r.account_id = p_account and r.site_id is null and r.last_fired_check_id is not null;

  with gone as (delete from public.sites s where s.account_id = p_account returning 1)
  select pg_catalog.count(*) into v_sites from gone;

  with gone as (
    delete from public.seats s
     where s.account_id = p_account and not (s.role = 'owner' and s.status = 'active')
    returning 1)
  select pg_catalog.count(*) into v_seats from gone;

  return pg_catalog.jsonb_build_object('sites', v_sites, 'seats', v_seats);
end;
$$;

alter function public.qa_reset(uuid) owner to postgres;
revoke all on function public.qa_reset(uuid) from public, anon, authenticated, service_role;
grant execute on function public.qa_reset(uuid) to service_role;
