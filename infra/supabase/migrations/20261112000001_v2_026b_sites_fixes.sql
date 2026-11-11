-- v2 signed-in product (CC-26b D4, D5, D6): the SQL that holds the account's limits and the fix
-- lifecycle, so two concurrent requests cannot both pass a cap. Spec:
-- docs/specs/v2/26b-dashboard-wiring.md. Functions are owned by postgres and revoked from every
-- client role; each section's header names the role each one is granted to. A route checks the
-- caller's membership through the caller's own session before it calls a service_role function.
--
-- The statements are re-runnable (the tests apply the file twice).
-- The revert is infra/supabase/rollbacks/20261112000001_v2_026b_sites_fixes.revert.sql.

-- ═══ A: sites and re-checks (D4, D6) ══════════════════════════════════════════════════════════════
-- Four functions, each security definer and granted to service_role only. Each locks its row in a
-- statement of its own and reads what it decides on in later statements: under READ COMMITTED a
-- later statement takes a fresh snapshot, so a call that waited on the lock sees what the holder
-- committed. The races are tested on a real Postgres by scripts/db/sites-race.test.ts; the rest by
-- apps/web/__tests__/v2-026b-sites.test.ts.

-- ─── request_capped_check ─────────────────────────────────────────────────────────────────────────
-- A member's re-check of a kept site (trigger manual or fix_recheck), written only while the site's
-- re-checks in the last 24 hours are fewer than p_cap. In order: lock the site row; answer exists,
-- with the check's status, when p_row's id is already a check (a repeat inside its 2-minute bucket,
-- or a retry after a send that failed), counting nothing; refuse a removed site, then a paused one;
-- count the site's manual and fix_recheck checks queued in the last 24 hours; insert p_row as a
-- queued check, or answer capped with the time enough counted checks will have left the window for
-- one more to fit.
-- p_row: exactly the row requestCheck passes to insertQueued (apps/web/lib/v2/pipeline/request.ts):
-- the keys id, site_id, trigger, grade_version, queued_at, heartbeat_at and expires_at, with trigger
-- manual or fix_recheck. Any other shape, or a p_cap below 1, raises 22023 before the lock.
-- Returns {"outcome": "created"} | {"outcome": "exists", "status"} | {"outcome": "capped",
-- "next_allowed_at"} | {"outcome": "removed"} | {"outcome": "paused", "paused_reason"}.

create or replace function public.request_capped_check(p_row jsonb, p_cap integer)
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

  insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, heartbeat_at,
                             expires_at)
  select r.id, r.site_id, 'queued', r.trigger, r.grade_version, r.queued_at, r.heartbeat_at,
         r.expires_at
    from pg_catalog.jsonb_populate_record(null::public.checks, p_row) r;
  return pg_catalog.jsonb_build_object('outcome', 'created');
end;
$$;

-- ─── add_site ─────────────────────────────────────────────────────────────────────────────────────
-- A primary site for an account, with its queued first_audit check, in one transaction. In order:
-- lock the account row; answer exists when the account keeps the host live already; answer full when
-- its live primary sites (staging_of_site_id null, removed_at null) number p_limit or more; answer
-- adds_capped when first_audit checks of its sites, removed ones included, queued in the last 24
-- hours number p_limit or more (questions.md Q14: adding, removing and adding again is not an
-- unbounded crawl), with the time one more fits; otherwise insert the site, then the check.
-- p_site: exactly the keys id, account_id, host, owner_seat_id, schedule_cadence,
-- schedule_iso_weekday and schedule_hour_local. p_check: the row requestCheck passes to insertQueued
-- (as for request_capped_check) with trigger first_audit and site_id p_site's id. Any other shape,
-- or a p_limit below 0, raises 22023 before the lock.
-- Returns {"outcome": "created", "site_id", "check_id", "n"} (n: live primary sites after the add)
-- | {"outcome": "exists", "site_id"} | {"outcome": "full"} | {"outcome": "adds_capped",
-- "next_allowed_at"}.

create or replace function public.add_site(p_site jsonb, p_check jsonb, p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_site_keys constant text[] := array['id', 'account_id', 'host', 'owner_seat_id',
                                       'schedule_cadence', 'schedule_iso_weekday',
                                       'schedule_hour_local'];
  v_check_keys constant text[] := array['id', 'site_id', 'trigger', 'grade_version', 'queued_at',
                                        'heartbeat_at', 'expires_at'];
  v_site_given text[];
  v_check_given text[];
  v_account uuid;
  v_existing uuid;
  v_live integer;
  v_adds integer;
  v_next timestamptz;
begin
  if pg_catalog.jsonb_typeof(p_site) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_check) is distinct from 'object' then
    raise exception 'add_site: p_site and p_check must be objects' using errcode = '22023';
  end if;
  v_site_given := array(select pg_catalog.jsonb_object_keys(p_site));
  v_check_given := array(select pg_catalog.jsonb_object_keys(p_check));
  if not (v_site_given @> v_site_keys and v_site_given <@ v_site_keys)
     or not (v_check_given @> v_check_keys and v_check_given <@ v_check_keys)
     or coalesce(p_check ->> 'trigger', '') <> 'first_audit'
     or (p_check ->> 'site_id') is distinct from (p_site ->> 'id')
     or (p_site ->> 'account_id') is null
     or p_limit is null or p_limit < 0 then
    raise exception 'add_site: p_site or p_check is not the row the route writes, or p_limit is below 0'
      using errcode = '22023';
  end if;
  v_account := (p_site ->> 'account_id')::uuid;

  perform 1 from public.accounts a where a.id = v_account and a.deleted_at is null for update;
  if not found then
    raise exception 'add_site: no live account %', v_account using errcode = 'P0002';
  end if;

  select s.id into v_existing
    from public.sites s
   where s.account_id = v_account and s.host = p_site ->> 'host' and s.removed_at is null;
  if found then
    return pg_catalog.jsonb_build_object('outcome', 'exists', 'site_id', v_existing);
  end if;

  select pg_catalog.count(*)::integer
    into v_live
    from public.sites s
   where s.account_id = v_account and s.staging_of_site_id is null and s.removed_at is null;
  if v_live >= p_limit then
    return pg_catalog.jsonb_build_object('outcome', 'full');
  end if;

  select pg_catalog.count(*)::integer
    into v_adds
    from public.checks c
    join public.sites s on s.id = c.site_id
   where s.account_id = v_account
     and c.trigger = 'first_audit'
     and c.queued_at > pg_catalog.now() - interval '24 hours';
  if v_adds >= p_limit then
    select c.queued_at + interval '24 hours'
      into v_next
      from public.checks c
      join public.sites s on s.id = c.site_id
     where s.account_id = v_account
       and c.trigger = 'first_audit'
       and c.queued_at > pg_catalog.now() - interval '24 hours'
     order by c.queued_at
    offset v_adds - p_limit
     limit 1;
    return pg_catalog.jsonb_build_object(
      'outcome', 'adds_capped',
      'next_allowed_at',
      pg_catalog.to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;

  insert into public.sites (id, account_id, host, owner_seat_id, schedule_cadence,
                            schedule_iso_weekday, schedule_hour_local)
  select r.id, r.account_id, r.host, r.owner_seat_id, r.schedule_cadence, r.schedule_iso_weekday,
         r.schedule_hour_local
    from pg_catalog.jsonb_populate_record(null::public.sites, p_site) r;
  insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, heartbeat_at,
                             expires_at)
  select r.id, r.site_id, 'queued', r.trigger, r.grade_version, r.queued_at, r.heartbeat_at,
         r.expires_at
    from pg_catalog.jsonb_populate_record(null::public.checks, p_check) r;
  return pg_catalog.jsonb_build_object('outcome', 'created', 'site_id', p_site ->> 'id',
                                       'check_id', p_check ->> 'id', 'n', v_live + 1);
end;
$$;

-- ─── edit_site ────────────────────────────────────────────────────────────────────────────────────
-- Sets what a member may change on a kept site, in one transaction. p_patch holds any of:
--   schedule:         {cadence, iso_weekday, hour_local}, or null for none;
--   competitor_hosts: an array of hosts;
--   staging_host:     a host, or null for no staging site.
-- A key that is absent leaves its value as it is; any other key raises 22023. In order: lock the site
-- row; answer removed for a removed site; answer is_staging when a staging site is given competitors
-- or a staging site of its own; answer exists when the staging host is a live site of the account
-- (other than the current staging site); then write. A new staging host removes the current staging
-- site (removed_at, its queued checks canceled) and inserts a child site with the parent's owner seat;
-- the same host again changes nothing. The sites' CHECKs refuse a schedule that is not whole (raise).
-- Returns {"outcome": "updated", "staging_site_id"} (the live staging site afterwards, or null) |
-- {"outcome": "removed"} | {"outcome": "is_staging"} | {"outcome": "exists"}.

create or replace function public.edit_site(p_site uuid, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_keys constant text[] := array['schedule', 'competitor_hosts', 'staging_host'];
  v_account uuid;
  v_staging_of uuid;
  v_removed timestamptz;
  v_owner uuid;
  v_host text;
  v_child uuid;
  v_child_host text;
begin
  if pg_catalog.jsonb_typeof(p_patch) is distinct from 'object'
     or not (array(select pg_catalog.jsonb_object_keys(p_patch)) <@ v_keys) then
    raise exception 'edit_site: p_patch holds a key edit_site does not set' using errcode = '22023';
  end if;

  select s.account_id, s.staging_of_site_id, s.removed_at, s.owner_seat_id
    into v_account, v_staging_of, v_removed, v_owner
    from public.sites s
   where s.id = p_site and s.account_id is not null
     for update;
  if not found then
    raise exception 'edit_site: no kept site %', p_site using errcode = 'P0002';
  end if;
  if v_removed is not null then
    return pg_catalog.jsonb_build_object('outcome', 'removed');
  end if;
  if v_staging_of is not null and (p_patch ? 'competitor_hosts' or p_patch ? 'staging_host') then
    return pg_catalog.jsonb_build_object('outcome', 'is_staging');
  end if;

  select s.id, s.host into v_child, v_child_host
    from public.sites s
   where s.staging_of_site_id = p_site and s.removed_at is null
   order by s.created_at desc
   limit 1;
  v_host := p_patch ->> 'staging_host';
  if p_patch ? 'staging_host' and v_host is not null and v_host is distinct from v_child_host
     and exists (select 1 from public.sites s
                  where s.account_id = v_account and s.host = v_host and s.removed_at is null) then
    return pg_catalog.jsonb_build_object('outcome', 'exists');
  end if;

  if p_patch ? 'schedule' or p_patch ? 'competitor_hosts' then
    update public.sites s
       set schedule_cadence = case when p_patch ? 'schedule'
                                   then p_patch -> 'schedule' ->> 'cadence'
                                   else s.schedule_cadence end,
           schedule_iso_weekday = case when p_patch ? 'schedule'
                                       then (p_patch -> 'schedule' ->> 'iso_weekday')::smallint
                                       else s.schedule_iso_weekday end,
           schedule_hour_local = case when p_patch ? 'schedule'
                                      then (p_patch -> 'schedule' ->> 'hour_local')::smallint
                                      else s.schedule_hour_local end,
           competitor_hosts = case when p_patch ? 'competitor_hosts'
                                   then array(select pg_catalog.jsonb_array_elements_text(
                                                       p_patch -> 'competitor_hosts'))
                                   else s.competitor_hosts end,
           updated_at = pg_catalog.now()
     where s.id = p_site;
  end if;

  if p_patch ? 'staging_host' and v_host is distinct from v_child_host then
    perform public.fail_check(c.id, 'canceled')
       from public.checks c
       join public.sites s on s.id = c.site_id
      where s.staging_of_site_id = p_site and s.removed_at is null and c.status = 'queued';
    update public.sites s
       set removed_at = pg_catalog.now(), updated_at = pg_catalog.now()
     where s.staging_of_site_id = p_site and s.removed_at is null;
    v_child := null;
    if v_host is not null then
      insert into public.sites (account_id, host, staging_of_site_id, owner_seat_id)
      values (v_account, v_host, p_site, v_owner)
      returning id into v_child;
    end if;
  end if;
  return pg_catalog.jsonb_build_object('outcome', 'updated', 'staging_site_id', v_child);
end;
$$;

-- ─── remove_site ──────────────────────────────────────────────────────────────────────────────────
-- Removes a kept site and its staging sites, in one transaction: lock the site row; answer
-- already_removed when it is removed; otherwise cancel the queued checks of the site and its live
-- staging sites (fail_check, reason canceled, so a run that has not claimed one finds it gone) and set
-- their removed_at. Nothing is deleted: the checks, fixes and changes stay with the removed rows.
-- Returns {"outcome": "removed", "sites": n} (the rows it removed) | {"outcome": "already_removed"}.

create or replace function public.remove_site(p_site uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_removed timestamptz;
  v_count integer;
begin
  select s.removed_at into v_removed
    from public.sites s
   where s.id = p_site and s.account_id is not null
     for update;
  if not found then
    raise exception 'remove_site: no kept site %', p_site using errcode = 'P0002';
  end if;
  if v_removed is not null then
    return pg_catalog.jsonb_build_object('outcome', 'already_removed');
  end if;

  perform public.fail_check(c.id, 'canceled')
     from public.checks c
     join public.sites s on s.id = c.site_id
    where (s.id = p_site or s.staging_of_site_id = p_site)
      and s.removed_at is null
      and c.status = 'queued';
  update public.sites s
     set removed_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where (s.id = p_site or s.staging_of_site_id = p_site) and s.removed_at is null;
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('outcome', 'removed', 'sites', v_count);
end;
$$;

alter function public.request_capped_check(jsonb, integer) owner to postgres;
alter function public.add_site(jsonb, jsonb, integer) owner to postgres;
alter function public.edit_site(uuid, jsonb) owner to postgres;
alter function public.remove_site(uuid) owner to postgres;
revoke all on function public.request_capped_check(jsonb, integer), public.add_site(jsonb, jsonb, integer),
  public.edit_site(uuid, jsonb), public.remove_site(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.request_capped_check(jsonb, integer),
  public.add_site(jsonb, jsonb, integer), public.edit_site(uuid, jsonb), public.remove_site(uuid)
  to service_role;

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: fixes and the persist watermark (D5) ══════════════════════════════════════════════════════

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════
