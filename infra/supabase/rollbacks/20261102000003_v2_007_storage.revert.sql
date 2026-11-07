-- Revert of infra/supabase/migrations/20261102000003_v2_007_storage.sql.
--
-- Removes the crawl_worker role, its grants, functions and policies, and the evidence and reports
-- buckets. While either bucket holds objects the first statement raises with the count per bucket
-- and nothing runs, so the revert never orphans files: empty them through the Storage API first.
--
-- Run it as one transaction (scripts/db/rollback.ts does): `set local` below lasts only until the
-- transaction ends.
--
-- Every statement is re-runnable (v2-007-storage.test.ts runs it twice).

do $$
declare
  evidence_count bigint;
  reports_count bigint;
begin
  select count(*) filter (where bucket_id = 'evidence'), count(*) filter (where bucket_id = 'reports')
    into evidence_count, reports_count
    from storage.objects
   where bucket_id in ('evidence', 'reports');
  if evidence_count + reports_count > 0 then
    raise exception 'revert stopped: the buckets still hold objects (evidence: %, reports: %); empty them through the Storage API first',
      evidence_count, reports_count;
  end if;
end;
$$;

drop policy if exists evidence_crawl_worker_part_insert on storage.objects;
do $$
begin
  if to_regclass('public.page_results') is not null then
    drop policy if exists page_results_crawl_worker_insert on public.page_results;
    alter table public.page_results alter column check_month drop default;
    alter table public.page_results alter column lineage_id drop default;
  end if;
end;
$$;

drop function if exists public.crawl_worker_lineage_id();
drop function if exists public.crawl_worker_check_month();
drop function if exists public.crawl_worker_part_path_ok(text);
drop function if exists public.crawl_worker_check_id();

-- storage.protect_delete() refuses a direct delete from storage.buckets unless this is set.
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id in ('evidence', 'reports');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'crawl_worker') then
    revoke all on storage.objects from crawl_worker;
    revoke usage on schema storage from crawl_worker;
    if to_regclass('public.page_results') is not null then
      revoke all on public.page_results from crawl_worker;
    end if;
    if to_regprocedure('public.v2_http_url_ok(text)') is not null then
      revoke all on function public.v2_http_url_ok(text), public.v2_crawled_text_ok(jsonb, integer, integer),
        public.v2_nullable_url_ok(jsonb), public.v2_redirect_shape_ok(jsonb),
        public.v2_redirect_statuses_ok(jsonb), public.v2_canonical_shape_ok(jsonb),
        public.v2_hreflang_shape_ok(jsonb), public.v2_search_robots_shape_ok(jsonb),
        public.v2_search_robots_verdicts_ok(jsonb), public.v2_search_robots_ua_unique(jsonb),
        public.v2_headers_shape_ok(jsonb)
        from crawl_worker;
    end if;
    revoke usage on schema public from crawl_worker;
    revoke crawl_worker from authenticator;
    drop role crawl_worker;
  end if;
end;
$$;
