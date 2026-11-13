-- Revert of infra/supabase/migrations/20261114000002_v2_031_agency.sql, section by section in reverse.

-- ─── C ────────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.report_confirm_mail_counts(uuid, text, timestamptz);
-- The three kinds leave the CHECK on email_sends.kind and email_kind_suppressible, each rebuilt from
-- what it holds now without them, so a kind another migration added stays with its answer. A ledger
-- row of one of the three is deleted first, since the CHECK without its kind would refuse it; with it
-- goes the record that its message was sent. Like the migration's block, this raises and changes
-- nothing unless the kind column has one CHECK and it is a plain list. The function's body is
-- written in 028's own words, since the schema fingerprint reads its text: reverted over 028 alone,
-- the function is 028's to the character.
--   pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-revert-fingerprint.test.ts
do $$
declare
  v_removed constant text[] := array['seat_invite', 'report_confirm', 'client_report'];
  v_count integer;
  v_name name;
  v_def text;
  v_kinds text[];
  v_suppressible text[];
begin
  select pg_catalog.count(*), pg_catalog.min(c.conname), pg_catalog.min(pg_catalog.pg_get_constraintdef(c.oid))
    into v_count, v_name, v_def
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.email_sends'::pg_catalog.regclass
     and c.contype = 'c'
     and c.conkey = array[(select a.attnum
                             from pg_catalog.pg_attribute a
                            where a.attrelid = 'public.email_sends'::pg_catalog.regclass
                              and a.attname = 'kind')];
  if v_count <> 1 then
    raise exception 'email_sends.kind: % CHECKs on the column, where one is read', v_count;
  end if;
  select pg_catalog.array_agg(m.k[1] order by m.n)
    into v_kinds
    from pg_catalog.regexp_matches(v_def, '''([a-z0-9_]+)''::text', 'g') with ordinality as m(k, n);
  if v_kinds is null
     or v_def <> 'CHECK ((kind = ANY (ARRAY['
                 || (select pg_catalog.string_agg(pg_catalog.quote_literal(u.k) || '::text', ', ' order by u.n)
                       from pg_catalog.unnest(v_kinds) with ordinality as u(k, n))
                 || '])))' then
    raise exception 'email_sends.kind: the CHECK % is not a plain list of kinds', v_name;
  end if;

  select coalesce(pg_catalog.array_agg(u.k order by u.n)
                    filter (where public.email_kind_suppressible(u.k)), '{}'),
         pg_catalog.array_agg(u.k order by u.n)
    into v_suppressible, v_kinds
    from pg_catalog.unnest(v_kinds) with ordinality as u(k, n)
   where u.k <> all (v_removed);
  if v_kinds is null then
    raise exception 'email_sends.kind: the CHECK % lists no kind but the three', v_name;
  end if;

  delete from public.email_sends e where e.kind = any (v_removed);
  execute pg_catalog.format('alter table public.email_sends drop constraint %I', v_name);
  execute pg_catalog.format(
    'alter table public.email_sends add constraint %I check (kind in (%s))', v_name,
    (select pg_catalog.string_agg(pg_catalog.quote_literal(u.k), ', ' order by u.n)
       from pg_catalog.unnest(v_kinds) with ordinality as u(k, n)));
  execute pg_catalog.format(
    E'create or replace function public.email_kind_suppressible(p_kind text) returns boolean '
    'language sql immutable set search_path = pg_catalog, pg_temp '
    'as $f$\n  select p_kind in (%s);\n$f$',
    (select pg_catalog.string_agg(pg_catalog.quote_literal(u.k), ', ' order by u.n)
       from pg_catalog.unnest(v_suppressible) with ordinality as u(k, n)));
end;
$$;

-- ─── B ────────────────────────────────────────────────────────────────────────────────────────────
-- B2, client report schedules: the functions go, then the four columns with their constraint and
-- indexes. A schedule saved meanwhile stays as a row, with no record left of whether its contact
-- confirmed; sites.client_name, client_contact_email and owner_seat_id keep what set_client wrote,
-- and a client report row written meanwhile stays.
drop function if exists public.mark_client_report_sent(uuid, timestamptz);
drop function if exists public.write_client_report(uuid, timestamptz, uuid, timestamptz);
drop function if exists public.mark_report_schedule_run(uuid, timestamptz);
drop function if exists public.due_report_schedules(timestamptz, integer);
drop function if exists public.resume_report_schedule(uuid, uuid, timestamptz);
drop function if exists public.pause_report_schedule(text, timestamptz);
drop function if exists public.issue_report_pause(uuid, text, text, timestamptz);
drop function if exists public.confirm_report_recipient(text, timestamptz);
drop function if exists public.read_report_link(text, timestamptz);
drop function if exists public.issue_recipient_confirmation(uuid, timestamptz);
drop function if exists public.clear_report_schedule(uuid, uuid);
drop function if exists public.set_report_schedule(uuid, uuid, jsonb, timestamptz);
drop function if exists public.set_client(uuid, uuid, jsonb);
drop function if exists public.report_schedule_next(text, smallint, text, text, timestamptz);
drop function if exists public.report_link_token();
drop trigger if exists sites_contact_changed on public.sites;
drop function if exists public.sites_contact_changed();
drop index if exists public.report_schedules_pause_hash_uq;
drop index if exists public.report_schedules_confirm_hash_uq;
alter table public.report_schedules drop constraint if exists report_schedules_link_hashes;
alter table public.report_schedules drop column if exists pause_token_hash;
alter table public.report_schedules drop column if exists recipient_confirmed_at;
alter table public.report_schedules drop column if exists recipient_confirm_sent_at;
alter table public.report_schedules drop column if exists recipient_confirm_hash;
-- B2, share links: the four functions go, then the column. A link made meanwhile stays as a row,
-- and no function is left to open it. A withdrawn link is deleted first: without revoked_at it could
-- not be told from a live one, and applying the migration again would open it.
drop function if exists public.revoke_share_links(uuid, timestamptz);
drop function if exists public.read_share_link(text, timestamptz);
drop function if exists public.open_share_link(text, timestamptz);
drop function if exists public.create_share_link(uuid, text, uuid, timestamptz);
drop function if exists public.report_file_stored(public.reports);
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'share_links'
                and column_name = 'revoked_at') then
    delete from public.share_links where revoked_at is not null;
  end if;
end $$;
alter table public.share_links drop column if exists revoked_at;
-- Report files: the functions, then the three columns (the grant on file_state goes with it).
-- storage_path is 003's column and stays, so a stored file keeps its path; a pending or failed
-- report becomes a row with no file state and no path.
drop function if exists public.fail_abandoned_reports(uuid, timestamptz);
drop function if exists public.fail_report(uuid, text);
drop function if exists public.finish_report(uuid, text, bigint);
drop function if exists public.create_report(jsonb);
drop function if exists public.report_file_path(uuid, uuid, text);
alter table public.reports drop constraint if exists reports_failed_reason;
alter table public.reports drop constraint if exists reports_file_path;
alter table public.reports drop constraint if exists reports_file_state;
-- A pending or failed report names an object that is not a stored file: its path goes with its
-- state, so a re-apply (which reads a path without a state as a stored file) finds stored files only.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'reports' and column_name = 'file_state') then
    update public.reports set storage_path = null
     where storage_path is not null and file_state is distinct from 'stored';
  end if;
end $$;
alter table public.reports drop column if exists subject_fix_id;
alter table public.reports drop column if exists failed_reason;
alter table public.reports drop column if exists file_state;

-- ─── A ────────────────────────────────────────────────────────────────────────────────────────────
-- The seat functions go, then the invitation's columns. A seat invited meanwhile stays, as a row of
-- status 'invited'. Its link's hash is cleared: no function is left to accept the link, and a hash
-- without an expiry would stop the migration's CHECK from being added again.
drop function if exists public.remove_seat(uuid, uuid, timestamptz);
drop function if exists public.change_seat(uuid, uuid, text, uuid[]);
drop function if exists public.accept_seat_invite(text, uuid, timestamptz);
drop function if exists public.read_seat_invite(text, timestamptz);
drop function if exists public.resend_seat_invite(uuid, uuid);
drop function if exists public.issue_seat_invite(uuid, integer, timestamptz);
drop function if exists public.invite_seat(uuid, text, text, uuid[], integer, timestamptz);
drop function if exists public.seat_scope_valid(uuid, uuid[]);
drop index if exists public.seats_invite_token_hash_uq;
alter table public.seats drop constraint if exists seats_invite_token;
update public.seats set invite_token_hash = null where invite_token_hash is not null;
alter table public.seats drop column if exists invite_seq;
alter table public.seats drop column if exists invite_expires_at;

-- ─── S ────────────────────────────────────────────────────────────────────────────────────────────
-- BEFORE RUNNING THIS FILE ON A DATABASE THAT HAS SCOPED SEATS: the two policies below go back to
-- is_member(account_id), and a seat invited while the migration was on stays active (section A's
-- revert keeps the rows). From then on a seat that covers some clients reads each seat row of its
-- account (colleagues' and pending invitations' addresses) and each seat_sites row (each client's
-- site id), and remove_seat is gone. The dry run requires a rollback to restore the earlier schema
-- (docs/ops/db-migrations.md §2, step 8), so this file cannot keep the narrowed policies. Count the
-- seats this reaches, and decide what to do with them first:
--   select account_id, count(*) from public.seats
--    where status = 'active' and not client_scope_all group by 1;
-- seats returns to 001's policy: every member of the account reads every seat.
drop policy if exists seats_member_read on public.seats;
create policy seats_member_read on public.seats
  for select to authenticated using (public.is_member(account_id));
drop function if exists public.member_covers_all(uuid);
-- seat_sites returns to 003's policy: every member of the account reads every row.
drop policy if exists seat_sites_member_read on public.seat_sites;
create policy seat_sites_member_read on public.seat_sites
  for select to authenticated using (public.is_member(account_id));
drop function if exists public.seat_may(uuid, text);
