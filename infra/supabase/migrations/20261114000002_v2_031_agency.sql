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

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: erasure and mail kinds ════════════════════════════════════════════════════════════════════

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
