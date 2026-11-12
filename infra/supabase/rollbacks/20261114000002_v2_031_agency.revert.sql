-- Revert of infra/supabase/migrations/20261114000002_v2_031_agency.sql, section by section in reverse.

-- ─── C ────────────────────────────────────────────────────────────────────────────────────────────

-- ─── B ────────────────────────────────────────────────────────────────────────────────────────────
-- Report files: the functions, then the three columns (the grant on file_state goes with it).
-- storage_path is 003's column and stays, so a stored file keeps its path; a pending or failed
-- report becomes a row with no file state.
drop function if exists public.fail_abandoned_reports(uuid, timestamptz);
drop function if exists public.fail_report(uuid, text);
drop function if exists public.finish_report(uuid, text, bigint);
drop function if exists public.create_report(jsonb);
drop function if exists public.report_file_path(uuid, uuid, text);
alter table public.reports drop constraint if exists reports_failed_reason;
alter table public.reports drop constraint if exists reports_stored_path;
alter table public.reports drop constraint if exists reports_file_state;
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
