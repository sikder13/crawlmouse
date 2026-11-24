-- V2R A2, PR 4: a daily budget of browser time that holds across concurrent checks.
--
-- Rendering stays off until the owner sets its two caps. With them unset the engine never calls
-- these functions, so this migration changes nothing a customer sees.
--
-- render_budget_days holds what each UTC day has committed. render_reservations holds one attempt
-- at one render phase of a check. Every attempt takes a reservation of its own: an Inngest retry of
-- the render step spends browser time again, so it must find new room under the cap, and what the
-- earlier attempt spent stays counted. An attempt that dies before settling is never settled, so its
-- whole reservation stays counted, which errs toward rendering less. There is no foreign key to
-- checks: a check deleted by the 30-day sweep must not change a day's total. No client role holds
-- anything on either table.

create table if not exists public.render_budget_days (
  day date primary key,
  committed_ms bigint not null default 0 check (committed_ms >= 0)
);

create table if not exists public.render_reservations (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null,
  day date not null,
  reserved_ms bigint not null check (reserved_ms > 0),
  -- Null until the attempt settles.
  used_ms bigint check (used_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists render_reservations_created_at
  on public.render_reservations (created_at);

alter table public.render_budget_days enable row level security;
alter table public.render_reservations enable row level security;
revoke all on table public.render_budget_days from public, anon, authenticated, service_role;
revoke all on table public.render_reservations from public, anon, authenticated, service_role;
grant select, insert, update on table public.render_budget_days to service_role;
grant select, insert, update, delete on table public.render_reservations to service_role;

-- Reserve p_ms of today's browser time for one attempt, against p_limit_ms. Answers the reservation,
-- or null when the day has no room for it.
--
-- The cap is tested inside one UPDATE, whose row lock makes concurrent callers take turns and
-- re-read the total, so two checks cannot both take the last of it.
create or replace function public.reserve_render_ms(
  p_check uuid,
  p_ms bigint,
  p_limit_ms bigint
)
returns uuid
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_id uuid;
begin
  if p_ms is null or p_limit_ms is null or p_ms <= 0 or p_limit_ms <= 0 then
    return null;
  end if;

  insert into public.render_budget_days (day) values (v_day) on conflict (day) do nothing;
  update public.render_budget_days
  set committed_ms = committed_ms + p_ms
  where day = v_day and committed_ms + p_ms <= p_limit_ms;
  if not found then
    return null;
  end if;

  insert into public.render_reservations (check_id, day, reserved_ms)
  values (p_check, v_day, p_ms)
  returning id into v_id;

  -- Bounded, so this table does not grow without a sweep of its own. A day's total is its own row.
  delete from public.render_reservations
  where id in (
    select id from public.render_reservations
    where created_at < now() - interval '7 days'
    order by created_at
    limit 100
  );
  return v_id;
end;
$$;

-- Close a reservation at what it used, on the day it reserved. A repeat changes nothing. A null or
-- negative time used is not a figure: the reservation is left open and its whole time stays counted.
--
-- What ran over its reservation is added, so a day can end above its cap by the overruns of the
-- phases that were rendering at once; the next reservation is then refused. Each render reserves its
-- request timeout (packages/engine/src/v2/render/run.ts, RESERVE_PER_RENDER_MS), so an overrun needs a
-- render to report more browser time than that.
create or replace function public.settle_render_ms(
  p_reservation uuid,
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
  if p_used_ms is null or p_used_ms < 0 then
    return;
  end if;
  update public.render_reservations
  set used_ms = p_used_ms
  where id = p_reservation and used_ms is null
  returning day, reserved_ms into v_day, v_reserved;
  if not found then
    return;
  end if;
  update public.render_budget_days
  set committed_ms = greatest(committed_ms + p_used_ms - v_reserved, 0)
  where day = v_day;
end;
$$;

alter function public.reserve_render_ms(uuid, bigint, bigint) owner to postgres;
alter function public.settle_render_ms(uuid, bigint) owner to postgres;
revoke all on function public.reserve_render_ms(uuid, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.settle_render_ms(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_render_ms(uuid, bigint, bigint) to service_role;
grant execute on function public.settle_render_ms(uuid, bigint) to service_role;
