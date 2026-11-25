-- Revert of infra/supabase/migrations/20261124000001_v2_a1_deploy_check.sql: request_capped_check as
-- migration 20261112000001 defined it, refusing any trigger but manual and fix_recheck. A deploy
-- check it queued stays as it is.

create or replace function public.request_capped_check(p_row jsonb, p_cap integer, p_global jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_keys constant text[] := array['id', 'site_id', 'trigger', 'grade_version', 'queued_at',
                                  'heartbeat_at', 'expires_at'];
  v_given text[];
  v_check uuid;
  v_site uuid;
  v_removed timestamptz;
  v_paused text;
  v_status text;
  v_status_site uuid;
  v_count integer;
  v_next timestamptz;
begin
  if pg_catalog.jsonb_typeof(p_row) is distinct from 'object' then
    raise exception 'request_capped_check: p_row is not an object' using errcode = '22023';
  end if;
  v_given := array(select pg_catalog.jsonb_object_keys(p_row));
  if not (v_given @> v_keys and v_given <@ v_keys)
     or coalesce(p_row ->> 'trigger', '') not in ('manual', 'fix_recheck')
     or p_cap is null or p_cap < 1 then
    raise exception 'request_capped_check: p_row is not a re-check row, or p_cap is below 1'
      using errcode = '22023';
  end if;
  v_check := (p_row ->> 'id')::uuid;
  v_site := (p_row ->> 'site_id')::uuid;

  select s.removed_at, s.paused_reason
    into v_removed, v_paused
    from public.sites s
   where s.id = v_site and s.account_id is not null
     for update;
  if not found then
    raise exception 'request_capped_check: no kept site %', v_site using errcode = 'P0002';
  end if;

  select c.status, c.site_id into v_status, v_status_site from public.checks c where c.id = v_check;
  if found then
    if v_status_site <> v_site then
      raise exception 'request_capped_check: check % belongs to another site', v_check
        using errcode = '22023';
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'exists', 'status', v_status);
  end if;

  if v_removed is not null then
    return pg_catalog.jsonb_build_object('outcome', 'removed');
  end if;
  if v_paused is not null then
    return pg_catalog.jsonb_build_object('outcome', 'paused', 'paused_reason', v_paused);
  end if;

  select pg_catalog.count(*)::integer
    into v_count
    from public.checks c
   where c.site_id = v_site
     and c.trigger in ('manual', 'fix_recheck')
     and c.queued_at > pg_catalog.now() - interval '24 hours';
  if v_count >= p_cap then
    select c.queued_at + interval '24 hours'
      into v_next
      from public.checks c
     where c.site_id = v_site
       and c.trigger in ('manual', 'fix_recheck')
       and c.queued_at > pg_catalog.now() - interval '24 hours'
     order by c.queued_at
    offset v_count - p_cap
     limit 1;
    return pg_catalog.jsonb_build_object(
      'outcome', 'capped',
      'next_allowed_at',
      pg_catalog.to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;

  begin
    if not public.take_rate_slot(p_global) then
      raise exception 'request_capped_check: the daily ceiling is reached' using errcode = 'CMCAP';
    end if;
    insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, heartbeat_at,
                               expires_at)
    select r.id, r.site_id, 'queued', r.trigger, r.grade_version, r.queued_at, r.heartbeat_at,
           r.expires_at
      from pg_catalog.jsonb_populate_record(null::public.checks, p_row) r;
  exception when sqlstate 'CMCAP' then
    return pg_catalog.jsonb_build_object('outcome', 'capacity');
  end;
  return pg_catalog.jsonb_build_object('outcome', 'created');
end;
$$;

alter function public.request_capped_check(jsonb, integer, jsonb) owner to postgres;
