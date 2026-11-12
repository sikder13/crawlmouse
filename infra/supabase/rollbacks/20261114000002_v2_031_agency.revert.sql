-- Revert of infra/supabase/migrations/20261114000002_v2_031_agency.sql, section by section in reverse.

-- ─── C ────────────────────────────────────────────────────────────────────────────────────────────

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
drop function if exists public.issue_report_pause(uuid, timestamptz);
drop function if exists public.confirm_report_recipient(text, timestamptz);
drop function if exists public.read_report_link(text, timestamptz);
drop function if exists public.issue_recipient_confirmation(uuid, timestamptz);
drop function if exists public.clear_report_schedule(uuid, uuid);
drop function if exists public.set_report_schedule(uuid, uuid, jsonb, timestamptz);
drop function if exists public.set_client(uuid, uuid, jsonb);
drop function if exists public.report_schedule_next(text, smallint, text, text, timestamptz);
drop function if exists public.report_link_token();
drop index if exists public.report_schedules_pause_hash_uq;
drop index if exists public.report_schedules_confirm_hash_uq;
alter table public.report_schedules drop constraint if exists report_schedules_link_hashes;
alter table public.report_schedules drop column if exists pause_token_hash;
alter table public.report_schedules drop column if exists recipient_confirmed_at;
alter table public.report_schedules drop column if exists recipient_confirm_sent_at;
alter table public.report_schedules drop column if exists recipient_confirm_hash;
-- B2, share links: the four functions go, then the column. A link made meanwhile stays as a row;
-- without revoked_at a withdrawn link is no longer told from a live one, and no function is left to
-- open either.
drop function if exists public.revoke_share_links(uuid, timestamptz);
drop function if exists public.read_share_link(text, timestamptz);
drop function if exists public.open_share_link(text, timestamptz);
drop function if exists public.create_share_link(uuid, text, uuid, timestamptz);
alter table public.share_links drop column if exists revoked_at;

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
