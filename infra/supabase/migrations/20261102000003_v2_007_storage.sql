-- v2 migration 007 (ARCH-2 §2.2 rule 7, §2.14, §6.1; DECISION-LOG J6): Storage and the crawl worker.
--
-- Creates the private `evidence` and `reports` buckets and the `crawl_worker` role. The Fly worker
-- reaches Supabase only with a crawl_worker JWT minted by the server for one check, and through it
-- may do two things: insert page_results rows for that check, and upload evidence parts under that
-- check's path. It holds no other privilege on a table in public and cannot read what it writes.
-- frontier is not granted: frontier.audit_id is NOT NULL until 009, so a crawl_worker row there
-- would have to name a v1 audit.
--
-- The token. Both policies hold only for a token whose claims say role = crawl_worker, whose
-- check_id names a check in status 'running', whose exp has not passed, whose iat is no more than a
-- minute ahead of the database clock, and whose lifetime (exp − iat) is at most 15 minutes. These
-- are read from the verified claims (auth.jwt()), so they hold whichever way the token was minted.
-- How it is minted is docs/specs/v2/06-check-tables.md, "The crawl_worker token".
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261102000003_v2_007_storage.revert.sql.
-- Tested by: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-007-storage.test.ts

-- ─── Buckets ──────────────────────────────────────────────────────────────────────────────────────
-- Private: no object is served without a signed URL. A bucket that already exists is made private.

insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false), ('reports', 'reports', false)
on conflict (id) do update set public = false;

-- ─── The role ─────────────────────────────────────────────────────────────────────────────────────
-- No login: PostgREST and Storage switch to it from authenticator when a token's role claim names it.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crawl_worker') then
    create role crawl_worker nologin noinherit;
  end if;
end;
$$;

grant crawl_worker to authenticator;
grant usage on schema public to crawl_worker;
grant usage on schema storage to crawl_worker;

-- ─── The token's check ────────────────────────────────────────────────────────────────────────────
-- The check the caller's token is for, or null when the token does not qualify (above). SECURITY
-- DEFINER, because crawl_worker cannot read checks.

create or replace function public.crawl_worker_check_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_claims jsonb := auth.jwt();
  v_now numeric := extract(epoch from now());
  v_check uuid;
begin
  if v_claims is null
     or v_claims ->> 'role' is distinct from 'crawl_worker'
     or jsonb_typeof(v_claims -> 'exp') is distinct from 'number'
     or jsonb_typeof(v_claims -> 'iat') is distinct from 'number'
     or coalesce(v_claims ->> 'check_id', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  if (v_claims ->> 'exp')::numeric <= v_now
     or (v_claims ->> 'iat')::numeric > v_now + 60
     or (v_claims ->> 'exp')::numeric - (v_claims ->> 'iat')::numeric > 900 then
    return null;
  end if;
  select c.id into v_check
    from public.checks c
   where c.id = (v_claims ->> 'check_id')::uuid and c.status = 'running';
  return v_check;
end;
$$;

-- True when `p_name` is an evidence part of the token's check:
-- {account_id, or "anon" for an unkept site}/{site_id}/{check_id}.part{1–6 digits}.json.gz
create or replace function public.crawl_worker_part_path_ok(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_check uuid := public.crawl_worker_check_id();
  v_prefix text;
begin
  if v_check is null or p_name is null then
    return false;
  end if;
  select coalesce(s.account_id::text, 'anon') || '/' || s.id::text || '/' || c.id::text
    into v_prefix
    from public.checks c join public.sites s on s.id = c.site_id
   where c.id = v_check;
  return left(p_name, length(v_prefix)) = v_prefix
     and substr(p_name, length(v_prefix) + 1) ~ '^\.part[0-9]{1,6}\.json\.gz$';
end;
$$;

revoke all on function public.crawl_worker_check_id() from public, anon, authenticated, service_role;
revoke all on function public.crawl_worker_part_path_ok(text) from public, anon, authenticated, service_role;
grant execute on function public.crawl_worker_check_id() to crawl_worker;
grant execute on function public.crawl_worker_part_path_ok(text) to crawl_worker;

-- ─── page_results: insert only, for the token's check ─────────────────────────────────────────────
-- No SELECT, so the worker inserts without RETURNING (PostgREST `Prefer: return=minimal`).

grant insert on public.page_results to crawl_worker;

drop policy if exists page_results_crawl_worker_insert on public.page_results;
create policy page_results_crawl_worker_insert on public.page_results
  for insert to crawl_worker with check (check_id = public.crawl_worker_check_id());

-- ─── evidence parts: insert only, under the token's check's path ──────────────────────────────────
-- No SELECT, UPDATE or DELETE on storage.objects, so the worker cannot read, overwrite or remove an
-- object, its own parts included. finalize (service role) joins the parts and deletes them.

grant insert on storage.objects to crawl_worker;

drop policy if exists evidence_crawl_worker_part_insert on storage.objects;
create policy evidence_crawl_worker_part_insert on storage.objects
  for insert to crawl_worker
  with check (bucket_id = 'evidence' and public.crawl_worker_part_path_ok(name));
