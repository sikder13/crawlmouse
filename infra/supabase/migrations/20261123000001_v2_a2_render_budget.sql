-- V2R A2, PR 4: a daily budget of browser time that holds across concurrent checks.
--
-- Rendering stays off until the owner sets its two caps. With them unset the engine never calls
-- these functions, so this migration changes nothing a customer sees.
--
-- render_budget_days holds what each UTC day has committed. render_reservations holds what one
-- render phase of one check reserved, so that an Inngest retry of the render step finds its own
-- reservation instead of taking a second one. It has no foreign key to checks: a check deleted by
-- the 30-day sweep must not change a day's total. No client role holds anything on either table.

create table if not exists public.render_budget_days (
  day date primary key,
  committed_ms bigint not null default 0 check (committed_ms >= 0)
);

create table if not exists public.render_reservations (
  check_id uuid not null,
  phase_no integer not null check (phase_no between 1 and 8),
  day date not null,
  reserved_ms bigint not null check (reserved_ms > 0),
  -- Null until the phase settles.
  used_ms bigint check (used_ms >= 0),
  created_at timestamptz not null default now(),
  primary key (check_id, phase_no)
);

create index if not exists render_reservations_created_at
  on public.render_reservations (created_at);

alter table public.render_budget_days enable row level security;
alter table public.render_reservations enable row level security;
revoke all on table public.render_budget_days from public, anon, authenticated, service_role;
revoke all on table public.render_reservations from public, anon, authenticated, service_role;
grant select, insert, update on table public.render_budget_days to service_role;
grant select, insert, update, delete on table public.render_reservations to service_role;

-- Reserve p_ms of today's browser time for one phase of one check, against p_limit_ms.
--
-- The cap is tested inside one UPDATE, whose row lock makes concurrent callers take turns and
-- re-read the total, so two checks cannot both take the last of it. A phase that already holds a
-- reservation is a retried step: it is granted without counting again. One that has settled gets
-- its reservation back only if the day's cap still has room for it.
create or replace function public.reserve_render_ms(
  p_check uuid,
  p_phase integer,
  p_ms bigint,
  p_limit_ms bigint
)
returns boolean
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_held public.render_reservations%rowtype;
begin
  if p_ms is null or p_limit_ms is null or p_ms <= 0 or p_limit_ms <= 0 then
    return false;
  end if;

  select * into v_held
  from public.render_reservations
  where check_id = p_check and phase_no = p_phase
  for update;

  if found then
    if v_held.used_ms is null then
      return true;
    end if;
    update public.render_budget_days
    set committed_ms = committed_ms + (v_held.reserved_ms - v_held.used_ms)
    where day = v_held.day
      and committed_ms + (v_held.reserved_ms - v_held.used_ms) <= p_limit_ms;
    if not found then
      return false;
    end if;
    update public.render_reservations
    set used_ms = null
    where check_id = p_check and phase_no = p_phase;
    return true;
  end if;

  insert into public.render_budget_days (day) values (v_day) on conflict (day) do nothing;
  update public.render_budget_days
  set committed_ms = committed_ms + p_ms
  where day = v_day and committed_ms + p_ms <= p_limit_ms;
  if not found then
    return false;
  end if;

  insert into public.render_reservations (check_id, phase_no, day, reserved_ms)
  values (p_check, p_phase, v_day, p_ms);

  -- Bounded, so this table does not grow without a sweep of its own.
  delete from public.render_reservations
  where ctid in (
    select ctid from public.render_reservations
    where created_at < now() - interval '7 days'
    order by created_at
    limit 100
  );
  return true;
end;
$$;

-- Close a phase's reservation at what it used, on the day it reserved. A repeat changes nothing.
create or replace function public.settle_render_ms(
  p_check uuid,
  p_phase integer,
  p_used_ms bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_day date;
  v_reserved bigint;
begin
  update public.render_reservations
  set used_ms = greatest(p_used_ms, 0)
  where check_id = p_check and phase_no = p_phase and used_ms is null
  returning day, reserved_ms into v_day, v_reserved;
  if not found then
    return;
  end if;
  update public.render_budget_days
  set committed_ms = greatest(committed_ms + greatest(p_used_ms, 0) - v_reserved, 0)
  where day = v_day;
end;
$$;

alter function public.reserve_render_ms(uuid, integer, bigint, bigint) owner to postgres;
alter function public.settle_render_ms(uuid, integer, bigint) owner to postgres;
revoke all on function public.reserve_render_ms(uuid, integer, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.settle_render_ms(uuid, integer, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_render_ms(uuid, integer, bigint, bigint) to service_role;
grant execute on function public.settle_render_ms(uuid, integer, bigint) to service_role;
