-- v2 migration 022b (CC-22b): what the public check flow stores beside a check.
--
-- Additive. No existing column, policy or grant is dropped or renamed. v1 reads none of it.
--
-- Section C (notify): checks.notify_email, the address a visitor leaves on the crawl screen to be
-- told when the check ends (POST /api/checks/[id]/notify). It is not granted to any client role:
-- 003 grants authenticated SELECT on checks column by column, so a column added later stays hidden.
-- It goes when the check's row goes.
--
-- Section D (keep and expiry): the index sites_unkept_idx and six functions, which the claim of an
-- audit (apps/web/lib/auth/claim.ts through lib/v2/pipeline/keep.ts) and the daily
-- crawlmouse.check.expiry function (inngest/check-expiry.ts through lib/v2/pipeline/expire.ts) call
-- as service_role:
--   keep_check: an account takes an unkept site, the site's checks stop expiring and the stored
--     evidence paths that were copied are rewritten, in one transaction;
--   move_check_paths: the same rewrite alone, for a kept check whose objects are moved later;
--   unkept_site_expired: whether a site no account keeps is past keeping;
--   expired_unkept_sites, delete_expired_unkept_sites: the expiry's read and its delete;
--   unsettled_kept_checks: the ended checks of kept sites whose evidence may still lie under anon/.
-- The six are SECURITY INVOKER with search_path pg_catalog, public, pg_temp, as 008's invoker
-- functions are. They read and write sites, checks and crawl_batches, which service_role may; the
-- rows a deleted site takes with it go by the foreign keys' cascades, which Postgres runs itself.
-- The tests below call them as service_role. EXECUTE is revoked from public, anon and authenticated
-- and granted to service_role (__tests__/v2-022b-keep-expiry.test.ts reads the catalog).
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261111000001_v2_022b_public_checks.revert.sql.
-- Section D is tested by: pnpm --filter @crawlmouse/web exec vitest run \
--   __tests__/v2-022b-keep-expiry.test.ts lib/v2/pipeline/keep.test.ts lib/v2/pipeline/expire.test.ts

-- ─── Section C: notify ────────────────────────────────────────────────────────────────────────────

alter table public.checks add column if not exists notify_email text;

-- ─── Section D: keep and expiry ───────────────────────────────────────────────────────────────────

-- The expiry reads the sites no account keeps in id order.
create index if not exists sites_unkept_idx on public.sites (id) where account_id is null;

-- ─── move_check_paths ─────────────────────────────────────────────────────────────────────────────
-- Rewrites a kept check's stored evidence paths by the pairs in p_paths, a JSON array of
-- {"old_path", "new_path"}: crawl_batches.result_path and checks.map_path move to new_path where
-- they hold old_path, and a path no pair names is left as it is. Returns how many stored paths it
-- rewrote. Raises, writing nothing, when p_account does not keep the check's site (P0002), and when
-- p_paths is not an array of pairs that each lead from the check's own directory under anon/ to the
-- same object name in its directory under p_account (22023).

create or replace function public.move_check_paths(p_check uuid, p_account uuid, p_paths jsonb)
returns integer
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_site uuid;
  v_from text;
  v_to text;
  v_moved integer;
begin
  if p_paths is null or jsonb_typeof(p_paths) <> 'array' then
    raise exception 'move_check_paths: p_paths is not a JSON array' using errcode = '22023';
  end if;
  select c.site_id into v_site
    from public.checks c join public.sites s on s.id = c.site_id
   where c.id = p_check and s.account_id = p_account;
  if not found then
    raise exception 'move_check_paths: the account does not keep the site of that check'
      using errcode = 'P0002';
  end if;
  v_from := 'anon/' || v_site::text || '/' || p_check::text || '/';
  v_to := p_account::text || '/' || v_site::text || '/' || p_check::text || '/';
  if exists (
    select 1 from jsonb_to_recordset(p_paths) as p(old_path text, new_path text)
     where p.old_path is null or p.new_path is null
        or left(p.old_path, length(v_from)) <> v_from
        or left(p.new_path, length(v_to)) <> v_to
        or length(p.old_path) = length(v_from)
        or substr(p.old_path, length(v_from) + 1) <> substr(p.new_path, length(v_to) + 1)) then
    raise exception 'move_check_paths: a pair does not lead from the check''s anon/ directory to the same name under the account'
      using errcode = '22023';
  end if;
  with batches as (
    update public.crawl_batches b
       set result_path = p.new_path
      from jsonb_to_recordset(p_paths) as p(old_path text, new_path text)
     where b.check_id = p_check and b.result_path = p.old_path
    returning 1
  ), map as (
    update public.checks c
       set map_path = p.new_path
      from jsonb_to_recordset(p_paths) as p(old_path text, new_path text)
     where c.id = p_check and c.map_path = p.old_path
    returning 1
  )
  select (select count(*) from batches) + (select count(*) from map) into v_moved;
  return v_moved;
end;
$$;

-- ─── keep_check ───────────────────────────────────────────────────────────────────────────────────
-- The claim's one transaction. 'taken' when p_account took the check's site (owner seat, schedule
-- and updated_at as the claim wrote them before this function), the site's checks stopped expiring
-- and move_check_paths rewrote the stored paths in p_paths. Otherwise nothing is written:
-- 'not_unowned' when there is no such check or its site has an account already, 'expired' when the
-- check's expires_at is at or before now(), 'host_kept' when the account keeps a site with that host
-- (sites_account_host_uq). The site's row is locked before the expiry is read, in the order
-- delete_expired_unkept_sites takes its locks (site, then checks). PGlite has one connection, so no
-- test here runs the two at the same time; the tests place one between the other's statements.

create or replace function public.keep_check(p_check uuid, p_account uuid, p_owner_seat uuid,
                                             p_cadence text, p_iso_weekday integer,
                                             p_hour_local integer, p_paths jsonb)
returns text
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_site uuid;
  v_owner uuid;
  v_expires timestamptz;
  v_constraint text;
begin
  select c.site_id into v_site from public.checks c where c.id = p_check;
  if not found then
    return 'not_unowned';
  end if;
  select s.account_id into v_owner from public.sites s where s.id = v_site for update;
  if not found or v_owner is not null then
    return 'not_unowned';
  end if;
  select c.expires_at into v_expires from public.checks c where c.id = p_check;
  if not found then
    return 'not_unowned';
  end if;
  if v_expires is not null and v_expires <= now() then
    return 'expired';
  end if;
  begin
    update public.sites s
       set account_id = p_account,
           owner_seat_id = p_owner_seat,
           schedule_cadence = p_cadence,
           schedule_iso_weekday = p_iso_weekday,
           schedule_hour_local = p_hour_local,
           updated_at = now()
     where s.id = v_site;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'sites_account_host_uq' then
      return 'host_kept';
    end if;
    raise;
  end;
  update public.checks c set expires_at = null where c.site_id = v_site and c.expires_at is not null;
  perform public.move_check_paths(p_check, p_account, p_paths);
  return 'taken';
end;
$$;

-- ─── unkept_site_expired ──────────────────────────────────────────────────────────────────────────
-- True for a site no account keeps that has a check and no check still to keep (one with no
-- expires_at, one expiring after p_cutoff, or one queued or running), and for a site no account
-- keeps that has no check and was created at or before p_bare_before.

create or replace function public.unkept_site_expired(p_site uuid, p_cutoff timestamptz,
                                                      p_bare_before timestamptz)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.sites s
     where s.id = p_site
       and s.account_id is null
       and not exists (
         select 1 from public.checks c
          where c.site_id = s.id
            and (c.expires_at is null or c.expires_at > p_cutoff
                 or c.status in ('queued', 'running')))
       and (s.created_at <= p_bare_before
            or exists (select 1 from public.checks c where c.site_id = s.id)))
$$;

-- ─── expired_unkept_sites ─────────────────────────────────────────────────────────────────────────
-- The first p_limit sites, in id order after p_after, for which unkept_site_expired is true: one row
-- per check of each (check_id null for a site with none), with the check's batch numbers, which
-- name its batch objects in the evidence bucket. `remaining` counts the sites after p_after that
-- qualify, this page's included.

create or replace function public.expired_unkept_sites(p_cutoff timestamptz,
                                                       p_bare_before timestamptz, p_after uuid,
                                                       p_limit integer)
returns table (site_id uuid, check_id uuid, batches integer[], remaining bigint)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select s.id, count(*) over () as remaining
      from public.sites s
     where s.account_id is null
       and (p_after is null or s.id > p_after)
       and public.unkept_site_expired(s.id, p_cutoff, p_bare_before)
     order by s.id
     limit p_limit
  )
  select d.id,
         c.id,
         coalesce((select array_agg(b.batch order by b.batch)
                     from public.crawl_batches b where b.check_id = c.id), '{}'::integer[]),
         d.remaining
    from due d left join public.checks c on c.site_id = d.id
   order by d.id, c.id
$$;

-- ─── delete_expired_unkept_sites ──────────────────────────────────────────────────────────────────
-- Deletes those of p_sites that no account keeps and for which unkept_site_expired is true when the
-- statement runs, and returns their ids. Each site's checks, their measurement rows, batches and
-- staged chunks, and the site's fixes and fix events go with it by the foreign keys' cascades.
-- `account_id is null` is a condition of the delete itself: a site an account took after it was
-- listed is not deleted.

create or replace function public.delete_expired_unkept_sites(p_sites uuid[],
                                                              p_cutoff timestamptz,
                                                              p_bare_before timestamptz)
returns setof uuid
language sql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
  delete from public.sites s
   where s.id = any (p_sites)
     and s.account_id is null
     and public.unkept_site_expired(s.id, p_cutoff, p_bare_before)
  returning s.id
$$;

-- ─── unsettled_kept_checks ────────────────────────────────────────────────────────────────────────
-- The first p_limit ended checks (finished, partial or failed), in id order after p_after, of sites
-- an account keeps, that either hold a stored evidence path under anon/ or are a first audit of a
-- site updated at or after p_since (a claim sets sites.updated_at, so this lists a check claimed
-- since then, whose anon/ objects a failed removal may have left). `remaining` as above.

create or replace function public.unsettled_kept_checks(p_since timestamptz, p_after uuid,
                                                        p_limit integer)
returns table (check_id uuid, site_id uuid, account_id uuid, batches integer[], remaining bigint)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select c.id as check_id, s.id as site_id, s.account_id, count(*) over () as remaining
      from public.checks c join public.sites s on s.id = c.site_id
     where s.account_id is not null
       and c.status in ('finished', 'partial', 'failed')
       and (p_after is null or c.id > p_after)
       and (left(c.map_path, 5) = 'anon/'
            or exists (select 1 from public.crawl_batches b
                        where b.check_id = c.id and left(b.result_path, 5) = 'anon/')
            or (c.trigger = 'first_audit' and s.updated_at >= p_since))
     order by c.id
     limit p_limit
  )
  select d.check_id,
         d.site_id,
         d.account_id,
         coalesce((select array_agg(b.batch order by b.batch)
                     from public.crawl_batches b where b.check_id = d.check_id), '{}'::integer[]),
         d.remaining
    from due d
   order by d.check_id
$$;

-- ─── Ownership and grants ─────────────────────────────────────────────────────────────────────────

alter function public.move_check_paths(uuid, uuid, jsonb) owner to postgres;
alter function public.keep_check(uuid, uuid, uuid, text, integer, integer, jsonb) owner to postgres;
alter function public.unkept_site_expired(uuid, timestamptz, timestamptz) owner to postgres;
alter function public.expired_unkept_sites(timestamptz, timestamptz, uuid, integer) owner to postgres;
alter function public.delete_expired_unkept_sites(uuid[], timestamptz, timestamptz) owner to postgres;
alter function public.unsettled_kept_checks(timestamptz, uuid, integer) owner to postgres;

revoke all on function public.move_check_paths(uuid, uuid, jsonb),
  public.keep_check(uuid, uuid, uuid, text, integer, integer, jsonb),
  public.unkept_site_expired(uuid, timestamptz, timestamptz),
  public.expired_unkept_sites(timestamptz, timestamptz, uuid, integer),
  public.delete_expired_unkept_sites(uuid[], timestamptz, timestamptz),
  public.unsettled_kept_checks(timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.move_check_paths(uuid, uuid, jsonb),
  public.keep_check(uuid, uuid, uuid, text, integer, integer, jsonb),
  public.unkept_site_expired(uuid, timestamptz, timestamptz),
  public.expired_unkept_sites(timestamptz, timestamptz, uuid, integer),
  public.delete_expired_unkept_sites(uuid[], timestamptz, timestamptz),
  public.unsettled_kept_checks(timestamptz, uuid, integer)
  to service_role;
