-- Revert of infra/supabase/migrations/20261114000002_v2_031_agency.sql, section by section in reverse.

-- ─── C ────────────────────────────────────────────────────────────────────────────────────────────

-- ─── B ────────────────────────────────────────────────────────────────────────────────────────────

-- ─── A ────────────────────────────────────────────────────────────────────────────────────────────

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
