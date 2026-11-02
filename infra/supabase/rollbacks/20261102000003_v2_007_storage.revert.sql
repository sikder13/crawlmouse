-- Revert of infra/supabase/migrations/20261102000003_v2_007_storage.sql.
--
-- Removes the crawl_worker role, its grants, functions and policies, and the evidence and reports
-- buckets. A bucket that still holds objects is not deleted: the delete fails and the revert stops,
-- so empty it through the Storage API first (Supabase refuses a direct delete of storage rows).
--
-- Every statement is re-runnable (v2-007-storage.test.ts runs it twice).

drop policy if exists evidence_crawl_worker_part_insert on storage.objects;
do $$
begin
  if to_regclass('public.page_results') is not null then
    drop policy if exists page_results_crawl_worker_insert on public.page_results;
  end if;
end;
$$;

drop function if exists public.crawl_worker_part_path_ok(text);
drop function if exists public.crawl_worker_check_id();

delete from storage.buckets where id in ('evidence', 'reports');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'crawl_worker') then
    revoke all on storage.objects from crawl_worker;
    revoke usage on schema storage from crawl_worker;
    if to_regclass('public.page_results') is not null then
      revoke all on public.page_results from crawl_worker;
    end if;
    revoke usage on schema public from crawl_worker;
    revoke crawl_worker from authenticator;
    drop role crawl_worker;
  end if;
end;
$$;
