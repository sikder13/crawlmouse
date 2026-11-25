-- V2R A2, row 17: the full renders an account has used this month (Pro 10, Agency 30).
--
-- A full render renders every page a check read, not the sample. An account's plan allows a number
-- a month (apps/web/lib/entitlement-v2.ts, fullRendersPerMonth); this table counts them, one row per
-- check that took one, under the UTC month it was taken in. The month is the key's own column, so a
-- new month starts at zero with nothing to reset.
--
-- Rendering stays off until the owner sets its caps, and row 17 is hidden until it is proven
-- (V2_HIDE_FEATURES=rendering). Until code calls these functions this migration changes nothing a
-- customer sees. There is no foreign key to checks: a check the 30-day sweep deletes must not hand
-- its month a use back. An account's erasure takes its uses with it. No client role holds anything on
-- the table.

create table if not exists public.full_render_uses (
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- The first day of the UTC month the use was taken in.
  month date not null check (month = date_trunc('month', month)::date),
  check_id uuid not null,
  taken_at timestamptz not null default now(),
  primary key (account_id, month, check_id)
);

alter table public.full_render_uses enable row level security;
revoke all on table public.full_render_uses from public, anon, authenticated, service_role;
grant select, insert, delete on table public.full_render_uses to service_role;

-- Takes one of this month's full renders for p_check, against p_limit. True when the check has one
-- after the call: this call took it, or an earlier call for the same check did (a retried step takes
-- the same use). False when the month's are used, or p_limit is not a positive number.
--
-- Concurrent calls for one account take turns on a transaction-scoped advisory lock keyed on the
-- account, so two checks cannot both take the last one.
create or replace function public.take_full_render(
  p_account uuid,
  p_check uuid,
  p_limit integer
)
returns boolean
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_used integer;
begin
  if p_account is null or p_check is null or p_limit is null or p_limit <= 0 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('full_render_uses:' || p_account::text, 0));
  if exists (
    select 1 from public.full_render_uses
    where account_id = p_account and month = v_month and check_id = p_check
  ) then
    return true;
  end if;
  select count(*) into v_used
  from public.full_render_uses
  where account_id = p_account and month = v_month;
  if v_used >= p_limit then
    return false;
  end if;
  insert into public.full_render_uses (account_id, month, check_id)
  values (p_account, v_month, p_check);
  return true;
end;
$$;

-- Gives back the use p_check took, in whatever month it took it: a full render that rendered no
-- page does not count against the account. A repeat, or a check that took none, changes nothing.
create or replace function public.give_back_full_render(
  p_account uuid,
  p_check uuid
)
returns void
language sql
set search_path = pg_catalog, public, pg_temp
as $$
  delete from public.full_render_uses where account_id = p_account and check_id = p_check;
$$;

-- This month's uses, for the account's "3 of 10" line.
create or replace function public.full_renders_used(p_account uuid)
returns integer
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select count(*)::integer from public.full_render_uses
  where account_id = p_account
    and month = date_trunc('month', now() at time zone 'utc')::date;
$$;

alter function public.take_full_render(uuid, uuid, integer) owner to postgres;
alter function public.give_back_full_render(uuid, uuid) owner to postgres;
alter function public.full_renders_used(uuid) owner to postgres;
revoke all on function public.take_full_render(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.give_back_full_render(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.full_renders_used(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.take_full_render(uuid, uuid, integer) to service_role;
grant execute on function public.give_back_full_render(uuid, uuid) to service_role;
grant execute on function public.full_renders_used(uuid) to service_role;
