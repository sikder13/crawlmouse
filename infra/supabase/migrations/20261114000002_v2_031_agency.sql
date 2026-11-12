-- v2 migration 031 (CC-31): the agency's workspace. Spec: docs/specs/v2/31-agency.md.
--
-- Sections: S, what a seat's role may do and what a scoped seat reads of seat_sites; A, seats and
-- invitations; B, reports, share links and client report schedules; C, erasure and mail kinds.
--
-- What changes for existing readers. Two policies are replaced (section S): a member reads a
-- seat_sites row only when their seat covers its site, and a seat scoped to some clients reads of
-- seats only its own row and the owner's. No foreign key is added, so no cascade is, and no object in
-- `auth` is created or altered.
--
-- Every statement is re-runnable (the tests apply the file twice). The revert is
-- infra/supabase/rollbacks/20261114000002_v2_031_agency.revert.sql.

-- ═══ S: what a role may do, and seat_sites ════════════════════════════════════════════════════════

-- The Guard column of docs/specs/v2/31-agency.md §3 as one table: the actions a seat's role may take
-- on its account. seat_may answers for the caller's own active seat (member_role reads auth.uid(), and
-- is null for a removed seat, a marked or deleted account, and a stranger), so it runs as the caller
-- and needs no definer rights. An action it does not list raises 22023 rather than answer false, so a
-- misspelt action in a route is an error and not a refusal. Whether the seat covers a site is not
-- asked here: that stays is_member_for_site's question.
create or replace function public.seat_may(p_account uuid, p_action text)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_known boolean;
  v_allowed boolean;
begin
  with guard(role, action) as (
    values
      ('owner', 'export_report'),
      ('owner', 'share_report'),
      ('owner', 'schedule_report'),
      ('owner', 'prospect_report'),
      ('owner', 'add_site'),
      ('owner', 'edit_site'),
      ('owner', 'remove_site'),
      ('owner', 'invite_seat'),
      ('owner', 'change_seat'),
      ('owner', 'remove_seat'),
      ('owner', 'buy_seats'),
      ('owner', 'edit_account_alerts'),
      ('account_manager', 'export_report'),
      ('account_manager', 'share_report'),
      ('account_manager', 'schedule_report'),
      ('account_manager', 'prospect_report'),
      ('account_manager', 'add_site'),
      ('account_manager', 'edit_site'),
      ('account_manager', 'remove_site'),
      ('account_manager', 'edit_account_alerts'),
      ('developer', 'export_report')
  )
  select pg_catalog.bool_or(g.action = p_action),
         pg_catalog.bool_or(g.action = p_action and g.role = public.member_role(p_account))
    into v_known, v_allowed
    from guard g;
  if v_known is not true then
    raise exception 'seat_may: % is not an action', coalesce(p_action, 'null') using errcode = '22023';
  end if;
  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.seat_may(uuid, text) from public, anon, authenticated;
grant execute on function public.seat_may(uuid, text) to authenticated, service_role;

-- A seat_sites row names a client site. Until now every member of the account read every row, so a
-- seat scoped to one client could list the site ids of the others. A member now reads the rows of the
-- sites their own seat covers; the owner's seat is unscoped (seats_owner_unscoped) and reads them all.
drop policy if exists seat_sites_member_read on public.seat_sites;
create policy seat_sites_member_read on public.seat_sites
  for select to authenticated
  using (public.is_member(account_id) and public.is_member_for_site(site_id));

-- Whether the caller's own active seat on the account covers every client. SECURITY DEFINER for the
-- reason is_member is: the policy on seats below calls it, and it reads seats.
create or replace function public.member_covers_all(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.seats s
      join public.accounts a on a.id = s.account_id
     where s.account_id = p_account
       and s.user_id = auth.uid()
       and s.status = 'active'
       and s.client_scope_all
       and a.deleted_at is null
       and a.deletion_confirmed_at is null
  );
$$;

revoke all on function public.member_covers_all(uuid) from public, anon, authenticated;
grant execute on function public.member_covers_all(uuid) to authenticated, service_role;

-- A seat row holds a person's name and the address they were invited at. Until now every member of
-- the account read every seat. A member now reads their own seat and the owner's, and the account's
-- other seats only when their own seat covers every client: a seat scoped to some clients no longer
-- reads its colleagues' addresses or the pending invitations.
drop policy if exists seats_member_read on public.seats;
create policy seats_member_read on public.seats
  for select to authenticated
  using (public.is_member(account_id)
         and (user_id = auth.uid() or role = 'owner' or public.member_covers_all(account_id)));

-- ═══ end S ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ A: seats and invitations ═════════════════════════════════════════════════════════════════════

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: reports, share links and client report schedules ══════════════════════════════════════════

-- ─── B: report files ──────────────────────────────────────────────────────────────────────────────
-- A report's file in the private `reports` bucket. file_state is null for a report that has no file
-- (a public link), 'pending' from create_report until the file is in the bucket, then 'stored', or
-- 'failed' with failed_reason, a short code. storage_path is set exactly while file_state is 'stored'
-- (reports_stored_path). subject_fix_id names the fix a proof page is about; it has no foreign key,
-- and create_report accepts it only for a fix of the report's site.
-- A client reads file_state; storage_path, failed_reason and subject_fix_id are granted to none.
-- Functions, each security definer with search_path pg_catalog, pg_temp, owned by postgres, revoked
-- from every client role and granted to service_role: create_report, finish_report, fail_report,
-- fail_abandoned_reports.
-- Tests: apps/web/__tests__/v2-031-b-reports.test.ts.

alter table public.reports add column if not exists file_state text;
alter table public.reports add column if not exists failed_reason text;
alter table public.reports add column if not exists subject_fix_id uuid;

-- A row that holds a path and no state is one this file's revert left: its file is stored. No
-- such row exists the first time this runs, since nothing wrote storage_path before this file.
update public.reports set file_state = 'stored' where storage_path is not null and file_state is null;

alter table public.reports drop constraint if exists reports_file_state;
alter table public.reports add constraint reports_file_state
  check (file_state in ('pending', 'stored', 'failed'));
alter table public.reports drop constraint if exists reports_stored_path;
alter table public.reports add constraint reports_stored_path
  check ((storage_path is not null) = (file_state is not distinct from 'stored'));
alter table public.reports drop constraint if exists reports_failed_reason;
alter table public.reports add constraint reports_failed_reason
  check ((failed_reason is not null) = (file_state is not distinct from 'failed')
         and (failed_reason is null or failed_reason ~ '^[a-z][a-z_]{0,39}$'));

grant select (file_state) on public.reports to authenticated;

-- The object name of a report's file: its account's folder, then the report's own id and the
-- format's extension. apps/web/lib/v2/reports/generate.ts (reportPath, REPORT_FILES) writes the same
-- name; the test this section names compares the two for each format.
create or replace function public.report_file_path(p_account uuid, p_report uuid, p_format text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_account::text || '/' || p_report::text || '.' ||
         case p_format
           when 'pdf' then 'pdf'
           when 'csv' then 'csv'
           when 'json' then 'json'
           when 'edge_list' then 'edges.csv'
           when 'html' then 'doc.json'
         end;
$$;

-- Writes one report a person asked for, waiting for its file: status 'ready', made_by 'user',
-- file_state 'pending'. p holds account_id, site_id, kind, format and covers_check_ids, and may hold
-- owner_seat_id and subject_fix_id; any other key, a kind this function does not make (audit_pdf as
-- pdf, compare as html, raw_export as csv, json or edge_list), more than two checks or a repeated
-- one raises 22023. The row is written only when, in the insert's own statement, the site is the
-- account's, each id of covers_check_ids is a finished or partial check of that site, and
-- subject_fix_id, when given, is a fix of that site; otherwise P0002. Returns the report's id.
create or replace function public.create_report(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_required constant text[] := array['account_id', 'site_id', 'kind', 'format', 'covers_check_ids'];
  v_optional constant text[] := array['owner_seat_id', 'subject_fix_id'];
  v_given text[];
  v_account uuid;
  v_site uuid;
  v_kind text;
  v_format text;
  v_checks uuid[];
  v_fix uuid;
  v_id uuid;
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object' then
    raise exception 'create_report: p is not an object' using errcode = '22023';
  end if;
  v_given := array(select pg_catalog.jsonb_object_keys(p));
  if not (v_given @> v_required and v_given <@ (v_required || v_optional))
     or pg_catalog.jsonb_typeof(p -> 'covers_check_ids') is distinct from 'array' then
    raise exception 'create_report: p is not a report request' using errcode = '22023';
  end if;
  v_account := (p ->> 'account_id')::uuid;
  v_site := (p ->> 'site_id')::uuid;
  v_kind := p ->> 'kind';
  v_format := p ->> 'format';
  v_fix := (p ->> 'subject_fix_id')::uuid;
  v_checks := array(select e::uuid
                      from pg_catalog.jsonb_array_elements_text(p -> 'covers_check_ids') e);
  if v_account is null or v_site is null
     or not coalesce((v_kind = 'audit_pdf' and v_format = 'pdf')
                     or (v_kind = 'compare' and v_format = 'html')
                     or (v_kind = 'raw_export' and v_format in ('csv', 'json', 'edge_list')), false)
     or pg_catalog.cardinality(v_checks) not between 1 and 2
     or (pg_catalog.cardinality(v_checks) = 2 and (v_kind <> 'compare' or v_checks[1] = v_checks[2]))
     or (v_fix is not null and v_kind <> 'compare') then
    raise exception 'create_report: not a report this function makes' using errcode = '22023';
  end if;

  insert into public.reports (account_id, site_id, kind, format, status, made_by, covers_check_ids,
                              owner_seat_id, subject_fix_id, file_state)
  select v_account, v_site, v_kind, v_format, 'ready', 'user', v_checks,
         (p ->> 'owner_seat_id')::uuid, v_fix, 'pending'
   where exists (select 1 from public.sites s where s.id = v_site and s.account_id = v_account)
     and (select pg_catalog.count(*)
            from public.checks c
           where c.id = any (v_checks)
             and c.site_id = v_site
             and c.status in ('finished', 'partial')) = pg_catalog.cardinality(v_checks)
     and (v_fix is null
          or exists (select 1 from public.site_fixes f where f.id = v_fix and f.site_id = v_site))
  returning id into v_id;
  if v_id is null then
    raise exception 'create_report: the site, a check or the fix is not the account''s'
      using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

-- Records that a pending report's file is in the bucket: file_state 'stored', its path and size.
-- p_path must be the report's own name (report_file_path), and p_bytes zero or more; otherwise
-- 22023. No such report raises P0002. Returns true when it stored the path, false when the report
-- was not pending (a second call for the same report changes nothing).
create or replace function public.finish_report(p_report uuid, p_path text, p_bytes bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account uuid;
  v_format text;
  v_state text;
begin
  select r.account_id, r.format, r.file_state into v_account, v_format, v_state
    from public.reports r
   where r.id = p_report
     for update;
  if not found then
    raise exception 'finish_report: no report %', p_report using errcode = 'P0002';
  end if;
  if p_path is distinct from public.report_file_path(v_account, p_report, v_format) then
    raise exception 'finish_report: the path is not report %''s own', p_report
      using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes < 0 then
    raise exception 'finish_report: p_bytes is not a size' using errcode = '22023';
  end if;
  if v_state is distinct from 'pending' then
    return false;
  end if;
  update public.reports r
     set file_state = 'stored', storage_path = p_path, byte_count = p_bytes
   where r.id = p_report;
  return true;
end;
$$;

-- Records that a pending report's file could not be made: file_state 'failed' with p_reason, a
-- short code (lower-case letters and underscores, at most 40; anything else raises 22023, so no
-- crawled text and no stack trace is stored). Returns true when it marked the report, false when
-- there is no such report or it was not pending.
create or replace function public.fail_report(p_report uuid, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  if p_reason is null or p_reason !~ '^[a-z][a-z_]{0,39}$' then
    raise exception 'fail_report: the reason is not a short code' using errcode = '22023';
  end if;
  update public.reports r
     set file_state = 'failed', failed_reason = p_reason
   where r.id = p_report and r.file_state = 'pending';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Marks failed, with the reason 'abandoned', each report of p_account that a person asked for and
-- that has been pending since before p_before: the request that was making its file has ended
-- without storing one. Returns how many it marked.
create or replace function public.fail_abandoned_reports(p_account uuid, p_before timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  if p_account is null or p_before is null then
    raise exception 'fail_abandoned_reports: an account and a time are required'
      using errcode = '22023';
  end if;
  update public.reports r
     set file_state = 'failed', failed_reason = 'abandoned'
   where r.account_id = p_account
     and r.made_by = 'user'
     and r.file_state = 'pending'
     and r.created_at < p_before;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.report_file_path(uuid, uuid, text) owner to postgres;
alter function public.create_report(jsonb) owner to postgres;
alter function public.finish_report(uuid, text, bigint) owner to postgres;
alter function public.fail_report(uuid, text) owner to postgres;
alter function public.fail_abandoned_reports(uuid, timestamptz) owner to postgres;
revoke all on function public.report_file_path(uuid, uuid, text), public.create_report(jsonb),
  public.finish_report(uuid, text, bigint), public.fail_report(uuid, text),
  public.fail_abandoned_reports(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.report_file_path(uuid, uuid, text), public.create_report(jsonb),
  public.finish_report(uuid, text, bigint), public.fail_report(uuid, text),
  public.fail_abandoned_reports(uuid, timestamptz)
  to service_role;


-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: erasure and mail kinds ════════════════════════════════════════════════════════════════════

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
