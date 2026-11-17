-- v2 go-live (CC-GL D2, owner ruling 2026-11-16, option (a)): what a removed site held is deleted
-- seven days after it was removed.
--
-- remove_site (migration 026b) sets removed_at and deletes nothing. From this migration on, the daily
-- expiry (`crawlmouse.check.expiry`, step `purge-removed`, apps/web/lib/v2/pipeline/expire.ts
-- purgeRemoved) lists the kept sites removed before a cutoff it computes from RESTORE_DAYS
-- (apps/web/lib/v2/copy/restore-window.ts), and for each site, one page of checks at a time, removes
-- the checks' evidence objects and then deletes those checks. The cutoff is the caller's: this file
-- states no number of days.
--
-- The site row stays, with removed_at and report_refusals: sites_carry_report_refusals (migration
-- 031) reads the removed row of a host when that host is added again.
--
-- Three functions, not one read and one delete: a site checked for a year holds more checks than
-- one PostgREST response returns (`max_rows`, 1000 in infra/supabase/config.toml), and a read cut
-- short there would leave the objects of the checks it did not return. So sites are listed on their
-- own, a site's checks are read a page at a time, and each delete names the checks whose objects the
-- caller removed.
--
-- 1. removed_sites_past_keeping(p_before, p_after, p_limit): the first p_limit sites, in id order
--    after p_after, that an account keeps, whose removed_at is before p_before, that still hold a
--    check, and that have no check queued or running. `remaining` counts the sites after p_after
--    that qualify, this page's included.
-- 2. removed_site_checks(p_site, p_after, p_limit): the first p_limit checks of p_site, in id order
--    after p_after, when p_site is a kept site that has been removed (none otherwise), with each
--    check's batch numbers, its copied_for, and every evidence path a row of it stores
--    (crawl_batches.result_path, checks.map_path, evidence_blobs.storage_path). `remaining` as
--    above.
-- 3. delete_removed_site_checks(p_site, p_before, p_checks): under the site row's lock, and only
--    while the site is still a kept site removed before p_before with no check queued or running, it
--      - clears the last firing (last_fired_at and last_fired_check_id together, per
--        alert_rules_fired_pair) of every alert rule that last fired on one of p_checks: that foreign
--        key has no action on delete (migration 003), so a rule that fired would refuse the delete.
--        An account-wide rule is one of these, since it outlives the site;
--      - deletes the site's changes, all of them, at the first call: they go with their checks in
--        any case, and deleting a fix first would set their fix_id null by its foreign key, which
--        can make two of a check's changes equal under changes_idempotency_uq and refuse the delete;
--      - deletes the site's fixes, all of them, at the first call: site_fixes names two of the
--        site's checks with no action on delete, and the fixes' events go by their cascade;
--      - deletes those of p_checks that are checks of p_site: their measurement rows, batches,
--        changes, ledger links and staged chunks go by the foreign keys' cascades;
--        usage_events.check_id, public_reports.check_id and a later check's previous_check_id are
--        set null by theirs (a public report's snapshot is not touched).
--    It returns how many checks it deleted, or null when it deleted nothing because the site no
--    longer qualified.
--
-- All three are SECURITY DEFINER with search_path pg_catalog, pg_temp and every name schema-qualified,
-- are owned by postgres, and are executable by service_role alone.
--
-- Rollback: infra/supabase/rollbacks/20261121000001_v2_gl_removed_site_purge.revert.sql
-- Tested by: pnpm --filter @crawlmouse/web exec vitest run lib/v2/pipeline/purge-removed.test.ts lib/v2/pipeline/expire-store.test.ts

-- ─── removed_sites_past_keeping ───────────────────────────────────────────────────────────────────

create or replace function public.removed_sites_past_keeping(p_before timestamptz, p_after uuid,
                                                             p_limit integer)
returns table (site_id uuid, account_id uuid, remaining bigint)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select s.id, s.account_id, pg_catalog.count(*) over ()
    from public.sites s
   where s.account_id is not null
     and s.removed_at is not null
     and s.removed_at < p_before
     and (p_after is null or s.id > p_after)
     and exists (select 1 from public.checks c where c.site_id = s.id)
     and not exists (select 1 from public.checks c
                      where c.site_id = s.id and c.status in ('queued', 'running'))
   order by s.id
   limit p_limit
$$;

-- ─── removed_site_checks ──────────────────────────────────────────────────────────────────────────

create or replace function public.removed_site_checks(p_site uuid, p_after uuid, p_limit integer)
returns table (check_id uuid, batches integer[], copied_for uuid[], paths text[], remaining bigint)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select c.id,
         coalesce((select pg_catalog.array_agg(b.batch order by b.batch)
                     from public.crawl_batches b where b.check_id = c.id), '{}'::integer[]),
         coalesce(c.copied_for, '{}'::uuid[]),
         coalesce((select pg_catalog.array_agg(x.path order by x.path)
                     from (select b.result_path as path from public.crawl_batches b
                            where b.check_id = c.id and b.result_path is not null
                           union
                           select c.map_path where c.map_path is not null
                           union
                           select e.storage_path from public.evidence_blobs e
                            where e.check_id = c.id) x), '{}'::text[]),
         pg_catalog.count(*) over ()
    from public.checks c
    join public.sites s on s.id = c.site_id
   where c.site_id = p_site
     and s.account_id is not null
     and s.removed_at is not null
     and (p_after is null or c.id > p_after)
   order by c.id
   limit p_limit
$$;

-- ─── delete_removed_site_checks ───────────────────────────────────────────────────────────────────

create or replace function public.delete_removed_site_checks(p_site uuid, p_before timestamptz,
                                                             p_checks uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  perform 1
     from public.sites s
    where s.id = p_site
      and s.account_id is not null
      and s.removed_at is not null
      and s.removed_at < p_before
      for update;
  if not found then
    return null;
  end if;
  if exists (select 1 from public.checks c
              where c.site_id = p_site and c.status in ('queued', 'running')) then
    return null;
  end if;

  update public.alert_rules r
     set last_fired_at = null, last_fired_check_id = null
   where r.last_fired_check_id = any (p_checks);

  delete from public.changes ch where ch.site_id = p_site;
  delete from public.site_fixes f where f.site_id = p_site;

  with gone as (
    delete from public.checks c
     where c.site_id = p_site and c.id = any (p_checks)
    returning 1)
  select pg_catalog.count(*)::integer into v_count from gone;
  return v_count;
end;
$$;

-- ─── Ownership and grants ─────────────────────────────────────────────────────────────────────────

alter function public.removed_sites_past_keeping(timestamptz, uuid, integer) owner to postgres;
alter function public.removed_site_checks(uuid, uuid, integer) owner to postgres;
alter function public.delete_removed_site_checks(uuid, timestamptz, uuid[]) owner to postgres;

revoke all on function public.removed_sites_past_keeping(timestamptz, uuid, integer),
  public.removed_site_checks(uuid, uuid, integer),
  public.delete_removed_site_checks(uuid, timestamptz, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.removed_sites_past_keeping(timestamptz, uuid, integer),
  public.removed_site_checks(uuid, uuid, integer),
  public.delete_removed_site_checks(uuid, timestamptz, uuid[])
  to service_role;
