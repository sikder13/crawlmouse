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

-- An invitation is a seats row of status 'invited'. Its link's token is minted when the mail is sent
-- (issue_seat_invite) and kept as its sha256, with the time the link stops working. invite_seq numbers
-- the invitations sent for the row: the first is 1 and a resend is the next. The two new columns are
-- granted to no client role, as invite_token_hash is not (001 grants authenticated SELECT column by
-- column).
--
-- The functions of this section are granted to service_role alone; a route establishes the caller
-- through their own session and asks seat_may before it calls one. Each that changes a seat locks the
-- account's row first, so the changes to one account's seats run one after another, and each answers
-- {outcome: 'marked'} for an account marked for deletion (spec 27b: a marked account gains no member).
--
-- What these comments say about outcomes, grants and re-running is tested by:
--   pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-a-seats.test.ts
-- and the limit under two transactions by scripts/db/seats-race.test.ts.
alter table public.seats add column if not exists invite_expires_at timestamptz;
alter table public.seats add column if not exists invite_seq integer not null default 0;
alter table public.seats drop constraint if exists seats_invite_token;
alter table public.seats add constraint seats_invite_token check (
  (invite_token_hash is null and invite_expires_at is null)
  or (status = 'invited' and invite_token_hash is not null and invite_expires_at is not null
      and invite_token_hash ~ '^[0-9a-f]{64}$'));
create unique index if not exists seats_invite_token_hash_uq on public.seats (invite_token_hash)
  where invite_token_hash is not null;

-- Whether p_site_ids is a scope a seat of p_account can hold: null (every client), or at least one
-- id, each a live site of the account that is not a staging copy.
create or replace function public.seat_scope_valid(p_account uuid, p_site_ids uuid[])
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select p_site_ids is null
      or (pg_catalog.cardinality(p_site_ids) > 0
          and not exists (
            select 1
              from pg_catalog.unnest(p_site_ids) x(id)
             where x.id is null
                or not exists (select 1
                                 from public.sites st
                                where st.id = x.id
                                  and st.account_id = p_account
                                  and st.staging_of_site_id is null
                                  and st.removed_at is null)));
$$;

-- Invites p_email to p_account as p_role, covering p_site_ids (null: every client). p_cap is the
-- account's seat limit as the route's viewer read it with the trial and past-due clocks; the limit
-- applied is the lower of it and accounts.seat_limit. Seats that count toward it are the active and the
-- invited ones, an invited seat whose link has expired included. The count is made in the statement
-- that writes the row. A removed seat of the same address is written back to 'invited' rather than a
-- second row added. An address is compared in lower case and otherwise as written.
--
-- Answers {outcome}: 'invited' with seat_id and seq; 'marked'; 'invalid_scope'; 'exists' (the address
-- holds an invited seat, or is the current address of a user with an active one); 'full'.
-- Raises 22023 for a role other than account_manager or developer, or a p_email that is not an
-- address; P0002 for no such account, or a deleted one.
create or replace function public.invite_seat(
  p_account uuid, p_email text, p_role text, p_site_ids uuid[], p_cap integer, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email constant text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_deleted timestamptz;
  v_marked timestamptz;
  v_limit integer;
  v_reuse uuid;
  v_seat uuid;
  v_seq integer;
begin
  if p_account is null or p_cap is null or p_now is null then
    raise exception 'invite_seat: a required argument is null' using errcode = '22004';
  end if;
  if p_role is null or p_role not in ('account_manager', 'developer') then
    raise exception 'invite_seat: a seat is invited as account_manager or developer'
      using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'invite_seat: p_email is not an address' using errcode = '22023';
  end if;

  select a.deleted_at, a.deletion_confirmed_at, least(a.seat_limit, p_cap)
    into v_deleted, v_marked, v_limit
    from public.accounts a
   where a.id = p_account
     for update;
  if not found or v_deleted is not null then
    raise exception 'invite_seat: no live account %', p_account using errcode = 'P0002';
  end if;
  if v_marked is not null then
    return pg_catalog.jsonb_build_object('outcome', 'marked');
  end if;
  if not public.seat_scope_valid(p_account, p_site_ids) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid_scope');
  end if;
  if exists (select 1
               from public.seats s
              where s.account_id = p_account
                and s.status = 'invited'
                and pg_catalog.lower(s.invited_email) = v_email)
     or exists (select 1
                  from public.seats s
                  join public.users u on u.id = s.user_id
                 where s.account_id = p_account
                   and s.status = 'active'
                   and pg_catalog.lower(u.email) = v_email) then
    return pg_catalog.jsonb_build_object('outcome', 'exists');
  end if;

  select s.id
    into v_reuse
    from public.seats s
   where s.account_id = p_account
     and s.status = 'removed'
     and pg_catalog.lower(s.invited_email) = v_email
   order by s.removed_at desc, s.id
   limit 1;
  if v_reuse is null then
    insert into public.seats (account_id, invited_email, role, status, client_scope_all, invite_seq)
    select p_account, v_email, p_role, 'invited', p_site_ids is null, 1
     where (select pg_catalog.count(*)
              from public.seats c
             where c.account_id = p_account and c.status in ('invited', 'active')) < v_limit
    returning id, invite_seq into v_seat, v_seq;
  else
    update public.seats s
       set status = 'invited',
           role = p_role,
           client_scope_all = p_site_ids is null,
           invited_email = v_email,
           user_id = null,
           accepted_at = null,
           removed_at = null,
           invite_seq = s.invite_seq + 1
     where s.id = v_reuse
       and (select pg_catalog.count(*)
              from public.seats c
             where c.account_id = p_account and c.status in ('invited', 'active')) < v_limit
    returning s.id, s.invite_seq into v_seat, v_seq;
  end if;
  if v_seat is null then
    return pg_catalog.jsonb_build_object('outcome', 'full');
  end if;

  delete from public.seat_sites ss where ss.seat_id = v_seat;
  insert into public.seat_sites (seat_id, site_id, account_id)
  select distinct v_seat, x.id, p_account from pg_catalog.unnest(p_site_ids) x(id);
  return pg_catalog.jsonb_build_object('outcome', 'invited', 'seat_id', v_seat, 'seq', v_seq);
end;
$$;

-- The mailer's call when it sends invitation p_seq of p_seat: mints the link's token as
-- issue_account_link does (32 bytes from two gen_random_uuid() values, base64url, 43 characters),
-- stores its sha256 with an expiry seven days after p_now, and returns the token once with what the
-- mail says. Calling it again replaces the stored hash, so the link sent before stops working.
-- Returns no row when the seat is not invited, p_seq is not its current invitation, or its account is
-- deleted or marked for deletion.
create or replace function public.issue_seat_invite(p_seat uuid, p_seq integer, p_now timestamptz)
returns table (token text, email text, account_name text, role text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v public.seats%rowtype;
  v_name text;
  v_raw text;
begin
  if p_now is null then
    raise exception 'issue_seat_invite: p_now is null' using errcode = '22004';
  end if;
  select s.* into v
    from public.seats s
   where s.id = p_seat and s.status = 'invited' and s.invite_seq = p_seq
     for update;
  if not found then
    return;
  end if;
  select a.name into v_name
    from public.accounts a
   where a.id = v.account_id and a.deleted_at is null and a.deletion_confirmed_at is null;
  if not found then
    return;
  end if;
  v_raw := pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(pg_catalog.decode(
             pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
                                '-', ''), 'hex'), 'base64'), '+/', '-_'), '=');
  update public.seats s
     set invite_token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_raw, 'UTF8')), 'hex'),
         invite_expires_at = p_now + interval '7 days'
   where s.id = v.id;
  token := v_raw;
  email := v.invited_email;
  account_name := v_name;
  role := v.role;
  expires_at := p_now + interval '7 days';
  return next;
end;
$$;

-- The next invitation of an invited seat: invite_seq + 1, with the stored hash and expiry cleared, so
-- the link sent before stops working at once and the mailer issues a new one for the new number.
-- Answers {outcome}: 'resent' with seq; 'marked'; 'not_found' (no seat p_seat on p_account, or a
-- removed one); 'not_invited' (the seat is active).
create or replace function public.resend_seat_invite(p_seat uuid, p_account uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_deleted timestamptz;
  v_marked timestamptz;
  v_status text;
  v_seq integer;
begin
  select a.deleted_at, a.deletion_confirmed_at into v_deleted, v_marked
    from public.accounts a where a.id = p_account for update;
  if not found or v_deleted is not null then
    raise exception 'resend_seat_invite: no live account %', p_account using errcode = 'P0002';
  end if;
  if v_marked is not null then
    return pg_catalog.jsonb_build_object('outcome', 'marked');
  end if;
  select s.status into v_status
    from public.seats s where s.id = p_seat and s.account_id = p_account for update;
  if not found or v_status = 'removed' then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if v_status <> 'invited' then
    return pg_catalog.jsonb_build_object('outcome', 'not_invited');
  end if;
  update public.seats s
     set invite_seq = s.invite_seq + 1, invite_token_hash = null, invite_expires_at = null
   where s.id = p_seat
  returning s.invite_seq into v_seq;
  return pg_catalog.jsonb_build_object('outcome', 'resent', 'seq', v_seq);
end;
$$;

-- What the invitation page shows for a link's token hash: the account's name, the role, and whether
-- the seat covers every client. {outcome: 'gone'} for a hash no invited seat holds (unknown, accepted,
-- re-sent or removed), an expired link, and a deleted or marked account. It returns no address.
create or replace function public.read_seat_invite(p_token_hash text, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select pg_catalog.jsonb_build_object(
              'outcome', 'invite', 'account_name', a.name, 'role', s.role,
              'scope_all', s.client_scope_all)
       from public.seats s
       join public.accounts a on a.id = s.account_id
      where s.invite_token_hash = p_token_hash
        and s.status = 'invited'
        and s.invite_expires_at > p_now
        and a.deleted_at is null
        and a.deletion_confirmed_at is null),
    pg_catalog.jsonb_build_object('outcome', 'gone'));
$$;

-- Accepts the invitation whose link's token hashes to p_token_hash, for the signed-in user p_user.
-- The seat becomes active with the user on it and its hash and expiry cleared, so the link works
-- once. The account's row is locked before the seat's, the order the other functions here take them.
--
-- Answers {outcome}: 'accepted' with account_id, seat_id and role; 'gone' (as read_seat_invite, but
-- for a marked account); 'email_mismatch' when the user's current address is not the invited one,
-- compared in lower case, which leaves the invitation as it was; 'marked'; 'already_member' when the
-- user holds an active seat on the account; 'full' when the account's active seats are not below
-- accounts.seat_limit, counted in the statement that writes the seat. A removed seat the user held on
-- the account gives up its user_id in the same step (seats_account_user_uq allows a user one row an
-- account), and keeps it when the answer is 'full'.
create or replace function public.accept_seat_invite(p_token_hash text, p_user uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account uuid;
  v_deleted timestamptz;
  v_marked timestamptz;
  v_limit integer;
  v public.seats%rowtype;
  v_email text;
begin
  if p_token_hash is null or p_user is null or p_now is null then
    raise exception 'accept_seat_invite: a required argument is null' using errcode = '22004';
  end if;
  select s.account_id into v_account from public.seats s where s.invite_token_hash = p_token_hash;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'gone');
  end if;
  select a.deleted_at, a.deletion_confirmed_at, a.seat_limit into v_deleted, v_marked, v_limit
    from public.accounts a where a.id = v_account for update;
  select s.* into v
    from public.seats s
   where s.invite_token_hash = p_token_hash and s.account_id = v_account and s.status = 'invited'
     for update;
  if not found or v.invite_expires_at <= p_now or v_deleted is not null then
    return pg_catalog.jsonb_build_object('outcome', 'gone');
  end if;
  select pg_catalog.lower(u.email) into v_email from public.users u where u.id = p_user;
  if v_email is distinct from pg_catalog.lower(v.invited_email) then
    return pg_catalog.jsonb_build_object('outcome', 'email_mismatch');
  end if;
  if v_marked is not null then
    return pg_catalog.jsonb_build_object('outcome', 'marked');
  end if;
  if exists (select 1 from public.seats s
              where s.account_id = v_account and s.user_id = p_user and s.status = 'active') then
    return pg_catalog.jsonb_build_object('outcome', 'already_member');
  end if;

  begin
    update public.seats s set user_id = null
     where s.account_id = v_account and s.user_id = p_user and s.status = 'removed';
    update public.seats s
       set status = 'active', user_id = p_user, accepted_at = p_now,
           invite_token_hash = null, invite_expires_at = null
     where s.id = v.id
       and (select pg_catalog.count(*)
              from public.seats c
             where c.account_id = v_account and c.status = 'active') < v_limit;
    if not found then
      raise exception 'accept_seat_invite: the account has no seat free' using errcode = 'CMSFL';
    end if;
  exception
    when sqlstate 'CMSFL' then
      return pg_catalog.jsonb_build_object('outcome', 'full');
  end;
  return pg_catalog.jsonb_build_object(
    'outcome', 'accepted', 'account_id', v_account, 'seat_id', v.id, 'role', v.role);
end;
$$;

-- Changes the role and the scope of an invited or active seat of p_account. The owner's seat is
-- not changed, and no seat is made an owner: no transfer of ownership is built.
-- Answers {outcome}: 'changed'; 'marked'; 'not_found' (no seat p_seat on p_account, or a removed
-- one); 'owner' (p_seat is the owner's); 'invalid_scope'. Raises 22023 for a role other than
-- account_manager or developer.
create or replace function public.change_seat(
  p_seat uuid, p_account uuid, p_role text, p_site_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_deleted timestamptz;
  v_marked timestamptz;
  v_role text;
  v_status text;
begin
  if p_role is null or p_role not in ('account_manager', 'developer') then
    raise exception 'change_seat: a seat is changed to account_manager or developer'
      using errcode = '22023';
  end if;
  select a.deleted_at, a.deletion_confirmed_at into v_deleted, v_marked
    from public.accounts a where a.id = p_account for update;
  if not found or v_deleted is not null then
    raise exception 'change_seat: no live account %', p_account using errcode = 'P0002';
  end if;
  if v_marked is not null then
    return pg_catalog.jsonb_build_object('outcome', 'marked');
  end if;
  select s.role, s.status into v_role, v_status
    from public.seats s where s.id = p_seat and s.account_id = p_account for update;
  if not found or v_status = 'removed' then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if v_role = 'owner' then
    return pg_catalog.jsonb_build_object('outcome', 'owner');
  end if;
  if not public.seat_scope_valid(p_account, p_site_ids) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid_scope');
  end if;
  update public.seats s
     set role = p_role, client_scope_all = p_site_ids is null
   where s.id = p_seat;
  delete from public.seat_sites ss where ss.seat_id = p_seat;
  insert into public.seat_sites (seat_id, site_id, account_id)
  select distinct p_seat, x.id, p_account from pg_catalog.unnest(p_site_ids) x(id);
  return pg_catalog.jsonb_build_object('outcome', 'changed');
end;
$$;

-- Removes an invited or active seat of p_account: status 'removed', its invitation's hash and expiry
-- cleared, its seat_sites rows deleted, and the sites it was the owning seat of given to the
-- account's owner seat. is_member, member_role and is_member_for_site read status = 'active', so the
-- person's access ends with this statement's commit. The owner's seat is not removed.
-- Answers {outcome}: 'removed'; 'marked'; 'not_found' (no seat p_seat on p_account, or one removed
-- already); 'owner'.
create or replace function public.remove_seat(p_seat uuid, p_account uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_deleted timestamptz;
  v_marked timestamptz;
  v_role text;
  v_status text;
begin
  if p_now is null then
    raise exception 'remove_seat: p_now is null' using errcode = '22004';
  end if;
  select a.deleted_at, a.deletion_confirmed_at into v_deleted, v_marked
    from public.accounts a where a.id = p_account for update;
  if not found or v_deleted is not null then
    raise exception 'remove_seat: no live account %', p_account using errcode = 'P0002';
  end if;
  if v_marked is not null then
    return pg_catalog.jsonb_build_object('outcome', 'marked');
  end if;
  select s.role, s.status into v_role, v_status
    from public.seats s where s.id = p_seat and s.account_id = p_account for update;
  if not found or v_status = 'removed' then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if v_role = 'owner' then
    return pg_catalog.jsonb_build_object('outcome', 'owner');
  end if;
  update public.seats s
     set status = 'removed', removed_at = p_now, invite_token_hash = null, invite_expires_at = null
   where s.id = p_seat;
  delete from public.seat_sites ss where ss.seat_id = p_seat;
  update public.sites st
     set owner_seat_id = (select o.id
                            from public.seats o
                           where o.account_id = p_account and o.role = 'owner' and o.status = 'active'),
         updated_at = pg_catalog.now()
   where st.account_id = p_account and st.owner_seat_id = p_seat;
  return pg_catalog.jsonb_build_object('outcome', 'removed');
end;
$$;

revoke all on function public.seat_scope_valid(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.invite_seat(uuid, text, text, uuid[], integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.issue_seat_invite(uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.resend_seat_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.read_seat_invite(text, timestamptz) from public, anon, authenticated;
revoke all on function public.accept_seat_invite(text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.change_seat(uuid, uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.remove_seat(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.seat_scope_valid(uuid, uuid[]) to service_role;
grant execute on function public.invite_seat(uuid, text, text, uuid[], integer, timestamptz)
  to service_role;
grant execute on function public.issue_seat_invite(uuid, integer, timestamptz) to service_role;
grant execute on function public.resend_seat_invite(uuid, uuid) to service_role;
grant execute on function public.read_seat_invite(text, timestamptz) to service_role;
grant execute on function public.accept_seat_invite(text, uuid, timestamptz) to service_role;
grant execute on function public.change_seat(uuid, uuid, text, uuid[]) to service_role;
grant execute on function public.remove_seat(uuid, uuid, timestamptz) to service_role;

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: reports, share links and client report schedules ══════════════════════════════════════════

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: erasure and mail kinds ════════════════════════════════════════════════════════════════════

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
