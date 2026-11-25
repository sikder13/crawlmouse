-- D-18 (QA's production dashboard walk, 24 Nov): a site added at 03:38 UTC with a weekly schedule had
-- its first scheduled check at 06:32 the same day, three hours after its first audit. Both triggers that
-- set sites.next_check_at from a schedule now start from a day after the site was added, or from now
-- when that is later: sites_schedule_next on insert and on a schedule change, and
-- accounts_timezone_reschedule on a zone change. claim_due_sites, which moves a site on after a run, is
-- not changed. Sites already scheduled keep their next_check_at: nothing is backfilled.
-- Rollback: infra/supabase/rollbacks/20261125000001_v2_a1_first_check_after_a_day.revert.sql.
-- Both functions keep 028's signature, owner and grants (create or replace keeps them).

create or replace function public.sites_schedule_next()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.schedule_cadence is not distinct from old.schedule_cadence
     and new.schedule_iso_weekday is not distinct from old.schedule_iso_weekday
     and new.schedule_hour_local is not distinct from old.schedule_hour_local
     and new.schedule_offset_min is not distinct from old.schedule_offset_min
     and new.account_id is not distinct from old.account_id
     and new.removed_at is not distinct from old.removed_at then
    return new;
  end if;
  if new.account_id is null or new.removed_at is not null or new.schedule_cadence is null
     or new.schedule_cadence = 'on_deploy' then
    new.next_check_at := null;
    return new;
  end if;
  if new.schedule_offset_min is null then
    new.schedule_offset_min := (('x' || substr(md5(new.id::text), 1, 8))::bit(32)::bigint % 60)::smallint;
  end if;
  -- Free runs monthly whatever the saved cadence (questions Q4), as claim_due_sites does.
  new.next_check_at := public.next_check_after(
    case when public.account_effective_tier(new.account_id, pg_catalog.now()) in ('pro', 'agency')
         then new.schedule_cadence else 'monthly' end,
    new.schedule_iso_weekday, new.schedule_hour_local, new.schedule_offset_min,
    (select a.timezone from public.accounts a where a.id = new.account_id),
    -- Not before a day after the site was added (D-18): its first audit ran then, and a weekly
    -- check the same day would read the site again within hours.
    greatest(pg_catalog.now(), new.created_at + interval '1 day'));
  return new;
end;
$$;

create or replace function public.accounts_timezone_reschedule()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_paid boolean := public.account_effective_tier(new.id, pg_catalog.now()) in ('pro', 'agency');
begin
  update public.sites s
     set next_check_at = public.next_check_after(
           case when v_paid then s.schedule_cadence else 'monthly' end, s.schedule_iso_weekday,
           s.schedule_hour_local, s.schedule_offset_min, new.timezone,
           greatest(pg_catalog.now(), s.created_at + interval '1 day'))
   where s.account_id = new.id and s.next_check_at > pg_catalog.now();
  return null;
end;
$$;
