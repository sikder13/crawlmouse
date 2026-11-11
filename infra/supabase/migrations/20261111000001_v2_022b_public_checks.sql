-- v2 migration 022b (CC-22b): what the public check flow stores beside a check.
--
-- Additive. No existing column, policy or grant is dropped or renamed. v1 reads none of it.
--
-- Section C (notify): checks.notify_email, the address a visitor leaves on the crawl screen to be
-- told when the check ends (POST /api/checks/[id]/notify). 003 grants authenticated SELECT on checks
-- column by column, and this file grants nothing on the column, so no client role reads it
-- (apps/web/__tests__/v2-003-check-tables.test.ts, "no privilege beyond the plan", compares each
-- column's grants with a list in which notify_email and copied_for have none). It goes when the
-- check's row goes.
--
-- Section D (keep and expiry): the index sites_unkept_idx, the column checks.copied_for and seven
-- functions, which the claim of an audit (apps/web/lib/auth/claim.ts through
-- lib/v2/pipeline/keep.ts) and the daily crawlmouse.check.expiry function (inngest/check-expiry.ts
-- through lib/v2/pipeline/expire.ts) call as service_role:
--   note_check_copy: records the account a Keep is about to copy a check's evidence for;
--   keep_check: an account takes an unkept site, the site's checks stop expiring and the stored
--     evidence paths that were copied are rewritten, in one transaction;
--   move_check_paths: the same rewrite alone, for a kept check whose objects are moved later;
--   unkept_site_expired: whether a site no account keeps is past keeping;
--   expired_unkept_sites, delete_expired_unkept_sites: the expiry's read and its delete;
--   unsettled_kept_checks: the ended checks of kept sites whose evidence may still lie under anon/,
--     or of which a refused Keep may have left a copy under another account.
-- The seven are SECURITY INVOKER with search_path pg_catalog, public, pg_temp, as 008's invoker
-- functions are. They read and write sites, checks and crawl_batches, which service_role may; the
-- rows a deleted site takes with it go by the foreign keys' cascades, which Postgres runs itself.
-- EXECUTE is revoked from public, anon and authenticated and granted to service_role
-- (apps/web/__tests__/v2-022b-keep-expiry.test.ts reads the catalog for the seven and calls them as
-- service_role).
--
-- The statements are written to be run again (add column if not exists, create index if not
-- exists, create or replace function), and so are the revert's
-- (infra/supabase/rollbacks/20261111000001_v2_022b_public_checks.revert.sql).
-- apps/web/__tests__/v2-022b-keep-expiry.test.ts ("applies twice and reverts twice") runs each a
-- second time on PGlite; the pull request's dry run (scripts/db/dry-run.ts) does the same on a
-- branch of production.
-- Section D is tested by: pnpm --filter @crawlmouse/web exec vitest run \
--   __tests__/v2-022b-keep-expiry.test.ts lib/v2/pipeline/keep.test.ts lib/v2/pipeline/expire.test.ts

-- ─── Section C: notify ────────────────────────────────────────────────────────────────────────────

alter table public.checks add column if not exists notify_email text;

-- ─── Section D: keep and expiry ───────────────────────────────────────────────────────────────────

-- The expiry reads the sites no account keeps in id order.
create index if not exists sites_unkept_idx on public.sites (id) where account_id is null;

-- The accounts a Keep copied this check's evidence objects for, written before the copy starts
-- (note_check_copy). keep_check takes the keeping account out when it commits, so what is left
-- names the accounts whose directory of this check may hold a copy that no stored path names: the
-- expiry removes those objects with an unkept site's own, and the settle step removes them for a
-- site another account went on to keep (apps/web/lib/v2/pipeline/expire.ts, keep.ts). No client
-- role is granted the column, as with notify_email above.
alter table public.checks add column if not exists copied_for uuid[] not null default '{}';

-- ─── note_check_copy ──────────────────────────────────────────────────────────────────────────────
-- Adds p_account to the check's copied_for when it is not there. True when there is such a check.

create or replace function public.note_check_copy(p_check uuid, p_account uuid)
returns boolean
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_account is null then
    raise exception 'note_check_copy: p_account is null' using errcode = '22004';
  end if;
  update public.checks c
     set copied_for = case when p_account = any (c.copied_for) then c.copied_for
                           else array_append(c.copied_for, p_account) end
   where c.id = p_check;
  return found;
end;
$$;

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
-- and move_check_paths rewrote the stored paths in p_paths; p_account is then taken out of the
-- check's copied_for, since its directory is now where the check's objects belong. Otherwise nothing
-- is written:
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
  update public.checks c set copied_for = array_remove(c.copied_for, p_account)
   where c.id = p_check and p_account = any (c.copied_for);
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
-- name its batch objects in the evidence bucket, and its copied_for (empty for a site with no
-- check). `remaining` counts the sites after p_after that qualify, this page's included.

create or replace function public.expired_unkept_sites(p_cutoff timestamptz,
                                                       p_bare_before timestamptz, p_after uuid,
                                                       p_limit integer)
returns table (site_id uuid, check_id uuid, batches integer[], copied_for uuid[], remaining bigint)
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
         coalesce(c.copied_for, '{}'::uuid[]),
         d.remaining
    from due d left join public.checks c on c.site_id = d.id
   order by d.id, c.id
$$;

-- ─── delete_expired_unkept_sites ──────────────────────────────────────────────────────────────────
-- Deletes those of p_sites that no account keeps and for which unkept_site_expired is true when the
-- statement runs, and returns their ids. Each site's checks, their measurement rows, batches and
-- staged chunks, and the site's fixes and fix events go with it by the foreign keys' cascades.
-- A site an account took after it was listed is not deleted: unkept_site_expired asks
-- `account_id is null` when the delete runs (apps/web/lib/v2/pipeline/expire.test.ts, "a site an
-- account took after it was listed"). The delete states `account_id is null` as its own condition
-- too. That copy does work in one case: keep_check commits on another connection while this
-- statement waits for the site's row lock, and READ COMMITTED then tests the statement's own
-- conditions against the new row, where the stable function still reads the statement's snapshot.
-- PGlite has one connection, so no test in this repository runs that case; with the copy removed
-- the tests here stay green. The expiry calls this with an array of one site, so a statement holds
-- one site's cascade.

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
-- an account keeps, that hold a stored evidence path under anon/, or whose site was updated at or
-- after p_since and that either are a first audit or have an account in copied_for (a claim sets
-- sites.updated_at, as any other write to the site's row does, so this lists a check claimed since then: its anon/ objects a failed removal may
-- have left, and the copies a refused Keep of it may have left under another account). `strays` is
-- the check's copied_for. `remaining` as above.

create or replace function public.unsettled_kept_checks(p_since timestamptz, p_after uuid,
                                                        p_limit integer)
returns table (check_id uuid, site_id uuid, account_id uuid, batches integer[], strays uuid[],
               remaining bigint)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select c.id as check_id, s.id as site_id, s.account_id, c.copied_for,
           count(*) over () as remaining
      from public.checks c join public.sites s on s.id = c.site_id
     where s.account_id is not null
       and c.status in ('finished', 'partial', 'failed')
       and (p_after is null or c.id > p_after)
       and (left(c.map_path, 5) = 'anon/'
            or exists (select 1 from public.crawl_batches b
                        where b.check_id = c.id and left(b.result_path, 5) = 'anon/')
            or (s.updated_at >= p_since
                and (c.trigger = 'first_audit' or cardinality(c.copied_for) > 0)))
     order by c.id
     limit p_limit
  )
  select d.check_id,
         d.site_id,
         d.account_id,
         coalesce((select array_agg(b.batch order by b.batch)
                     from public.crawl_batches b where b.check_id = d.check_id), '{}'::integer[]),
         d.copied_for,
         d.remaining
    from due d
   order by d.check_id
$$;

-- ─── Ownership and grants ─────────────────────────────────────────────────────────────────────────

alter function public.note_check_copy(uuid, uuid) owner to postgres;
alter function public.move_check_paths(uuid, uuid, jsonb) owner to postgres;
alter function public.keep_check(uuid, uuid, uuid, text, integer, integer, jsonb) owner to postgres;
alter function public.unkept_site_expired(uuid, timestamptz, timestamptz) owner to postgres;
alter function public.expired_unkept_sites(timestamptz, timestamptz, uuid, integer) owner to postgres;
alter function public.delete_expired_unkept_sites(uuid[], timestamptz, timestamptz) owner to postgres;
alter function public.unsettled_kept_checks(timestamptz, uuid, integer) owner to postgres;

revoke all on function public.note_check_copy(uuid, uuid),
  public.move_check_paths(uuid, uuid, jsonb),
  public.keep_check(uuid, uuid, uuid, text, integer, integer, jsonb),
  public.unkept_site_expired(uuid, timestamptz, timestamptz),
  public.expired_unkept_sites(timestamptz, timestamptz, uuid, integer),
  public.delete_expired_unkept_sites(uuid[], timestamptz, timestamptz),
  public.unsettled_kept_checks(timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.note_check_copy(uuid, uuid),
  public.move_check_paths(uuid, uuid, jsonb),
  public.keep_check(uuid, uuid, uuid, text, integer, integer, jsonb),
  public.unkept_site_expired(uuid, timestamptz, timestamptz),
  public.expired_unkept_sites(timestamptz, timestamptz, uuid, integer),
  public.delete_expired_unkept_sites(uuid[], timestamptz, timestamptz),
  public.unsettled_kept_checks(timestamptz, uuid, integer)
  to service_role;
