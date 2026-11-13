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

-- ─── B: report files ──────────────────────────────────────────────────────────────────────────────
-- A report's file in the private `reports` bucket. file_state is null for a report that has no file
-- (a public link), 'pending' from create_report until the file is in the bucket, then 'stored', or
-- 'failed' with failed_reason, a short code. storage_path is the object's name, and a report holds it
-- from the row's first write, whatever its file_state (reports_file_path): a request that dies
-- between the upload and finish_report leaves an object its row still names, which is how the
-- erasure's storage list (20261112000002, erase_person_counts) finds it. Whether the file is there
-- to download is file_state = 'stored'. subject_fix_id names the fix a proof page is about; it has no
-- foreign key, and create_report accepts it only for a fix of the report's site.
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
alter table public.reports drop constraint if exists reports_file_path;
alter table public.reports add constraint reports_file_path
  check ((storage_path is not null) = (file_state is not null));
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
-- file_state 'pending', storage_path its own object name (report_file_path). p holds account_id, site_id, kind, format and covers_check_ids, and may hold
-- owner_seat_id and subject_fix_id; any other key, a kind this function does not make (audit_pdf as
-- pdf, compare as html, raw_export as csv, json or edge_list), more than two checks, two for a
-- kind other than compare, a repeated one, or a fix without two checks of a compare raises 22023.
-- The row is written only when, in the insert's own statement, the site is the
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
  v_new constant uuid := pg_catalog.gen_random_uuid();
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
     or (v_fix is not null and (v_kind <> 'compare' or pg_catalog.cardinality(v_checks) <> 2)) then
    raise exception 'create_report: not a report this function makes' using errcode = '22023';
  end if;

  insert into public.reports (id, account_id, site_id, kind, format, status, made_by,
                              covers_check_ids, owner_seat_id, subject_fix_id, file_state,
                              storage_path)
  select v_new, v_account, v_site, v_kind, v_format, 'ready', 'user', v_checks,
         (p ->> 'owner_seat_id')::uuid, v_fix, 'pending',
         public.report_file_path(v_account, v_new, v_format)
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

-- Records that a pending report's file is in the bucket: file_state 'stored' and its size.
-- p_path must be the report's own name (report_file_path, which the row holds), and p_bytes zero or
-- more; otherwise 22023. No such report raises P0002. Returns true when it stored the path, false when the report
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
     set file_state = 'stored', byte_count = p_bytes
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

-- ─── B2: share links and schedules ───────────────────────────────────────────────────────────────

-- A share link (CC-31 D7) is a share_links row: the sha256 of a random token, the report it opens and
-- when it stops. revoked_at is the time it was withdrawn, or replaced by a newer link of the same
-- report. The table is granted to no client role (003), so neither is the column.
--
-- The four functions are granted to service_role alone. A route calls create_share_link and
-- revoke_share_links only after the caller's own session has read the report and answered seat_may;
-- open_share_link and read_share_link are called for whoever holds the token, which is the credential.
--
-- What these comments say about outcomes, grants and re-running is tested by:
--   pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-b2-share.test.ts
alter table public.share_links add column if not exists revoked_at timestamptz;

-- Whether a report's file is stored. This is the one place the share functions ask it: making a
-- link, opening one and reading one each call this function, and the expression below is the whole
-- of the test.
create or replace function public.report_file_stored(r public.reports)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce((r).file_state = 'stored', false);
$$;

-- Makes the link of p_report: a row for p_token_hash that expires 30 days after p_now, with
-- reports.share_expires_at set to the same time. The report's row is locked first, so two calls for
-- one report run one after the other, and the links it held before are revoked: a report has one
-- link that opens.
-- Answers {outcome}: 'created' with expires_at; 'not_found' (no report p_report); 'not_ready' (the
-- report has no stored file: report_file_stored).
create or replace function public.create_share_link(
  p_report uuid, p_token_hash text, p_user uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_stored boolean;
  v_expires timestamptz;
begin
  if p_report is null or p_token_hash is null or p_now is null then
    raise exception 'create_share_link: a required argument is null' using errcode = '22004';
  end if;
  select public.report_file_stored(r) into v_stored
    from public.reports r
   where r.id = p_report
     for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if not v_stored then
    return pg_catalog.jsonb_build_object('outcome', 'not_ready');
  end if;
  v_expires := p_now + interval '30 days';
  update public.share_links l
     set revoked_at = p_now
   where l.report_id = p_report and l.revoked_at is null;
  insert into public.share_links (token_hash, report_id, expires_at, created_by, created_at)
  values (p_token_hash, p_report, v_expires, p_user, p_now);
  update public.reports r set share_expires_at = v_expires where r.id = p_report;
  return pg_catalog.jsonb_build_object('outcome', 'created', 'expires_at', v_expires);
end;
$$;

-- The link a token hash names, when it opens: not revoked, p_now before its expiry, its report's
-- file stored, and the report's account neither deleted nor marked for deletion.
-- open_share_link counts the view in the statement that reads the link, so a link that does not
-- open is not counted. Answers {outcome}: 'open' with report_id, account_id, site_id, kind, format
-- and storage_path; 'gone' when a row holds the hash and does not open; 'unknown' when none does.
create or replace function public.open_share_link(p_token_hash text, p_now timestamptz)
returns jsonb
language sql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
  with opened as (
    update public.share_links l
       set view_count = l.view_count + 1
      from public.reports r
      join public.accounts a on a.id = r.account_id
      join public.sites st on st.id = r.site_id
     where l.token_hash = p_token_hash
       and r.id = l.report_id
       and l.revoked_at is null
       and l.expires_at > p_now
       and public.report_file_stored(r)
       and st.removed_at is null
       and a.deleted_at is null
       and a.deletion_confirmed_at is null
    returning r.id, r.account_id, r.site_id, r.kind, r.format, r.storage_path
  )
  select coalesce(
    (select pg_catalog.jsonb_build_object(
              'outcome', 'open', 'report_id', o.id, 'account_id', o.account_id,
              'site_id', o.site_id, 'kind', o.kind, 'format', o.format,
              'storage_path', o.storage_path)
       from opened o),
    (select pg_catalog.jsonb_build_object('outcome', 'gone')
       from public.share_links l
      where l.token_hash = p_token_hash),
    pg_catalog.jsonb_build_object('outcome', 'unknown'));
$$;

-- open_share_link's answer without the count: the shared page's own read, after the link was opened.
create or replace function public.read_share_link(p_token_hash text, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select pg_catalog.jsonb_build_object(
              'outcome', 'open', 'report_id', r.id, 'account_id', r.account_id,
              'site_id', r.site_id, 'kind', r.kind, 'format', r.format,
              'storage_path', r.storage_path)
       from public.share_links l
       join public.reports r on r.id = l.report_id
       join public.accounts a on a.id = r.account_id
       join public.sites st on st.id = r.site_id
      where l.token_hash = p_token_hash
        and l.revoked_at is null
        and l.expires_at > p_now
        and public.report_file_stored(r)
        and st.removed_at is null
        and a.deleted_at is null
        and a.deletion_confirmed_at is null),
    (select pg_catalog.jsonb_build_object('outcome', 'gone')
       from public.share_links l
      where l.token_hash = p_token_hash),
    pg_catalog.jsonb_build_object('outcome', 'unknown'));
$$;

-- Withdraws the links of p_report that are not revoked yet, and clears reports.share_expires_at.
-- Returns how many links it revoked.
create or replace function public.revoke_share_links(p_report uuid, p_now timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_revoked integer;
begin
  if p_report is null or p_now is null then
    raise exception 'revoke_share_links: a required argument is null' using errcode = '22004';
  end if;
  perform 1 from public.reports r where r.id = p_report for update;
  update public.share_links l
     set revoked_at = p_now
   where l.report_id = p_report and l.revoked_at is null;
  get diagnostics v_revoked = row_count;
  update public.reports r set share_expires_at = null where r.id = p_report;
  return v_revoked;
end;
$$;

revoke all on function public.report_file_stored(public.reports) from public, anon, authenticated;
revoke all on function public.create_share_link(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.open_share_link(text, timestamptz) from public, anon, authenticated;
revoke all on function public.read_share_link(text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_share_links(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.report_file_stored(public.reports) to service_role;
grant execute on function public.create_share_link(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.open_share_link(text, timestamptz) to service_role;
grant execute on function public.read_share_link(text, timestamptz) to service_role;
grant execute on function public.revoke_share_links(uuid, timestamptz) to service_role;

-- Client report schedules (CC-31 D8; docs/specs/v2/31-agency.md §10). A client's report goes to the
-- client's contact, sites.client_contact_email, one address a site. report_schedules gains what the
-- double opt-in and the recipient's pause need: the sha256 of the confirmation link's token with the
-- time it was issued, the time the contact confirmed, and the sha256 of the pause link's token. The
-- four columns are granted to no client role (003 grants authenticated SELECT column by column).
--
-- The functions are granted to service_role alone. A route calls set_client, set_report_schedule,
-- clear_report_schedule and resume_report_schedule only after the caller's own session has answered
-- is_member_for_site and seat_may; the two links' tokens are the recipient's credential.
--
-- What these comments say about outcomes, grants and re-running is tested by:
--   pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-b2-schedules.test.ts
alter table public.report_schedules add column if not exists recipient_confirm_hash text;
alter table public.report_schedules add column if not exists recipient_confirm_sent_at timestamptz;
alter table public.report_schedules add column if not exists recipient_confirmed_at timestamptz;
alter table public.report_schedules add column if not exists pause_token_hash text;
alter table public.report_schedules drop constraint if exists report_schedules_link_hashes;
alter table public.report_schedules add constraint report_schedules_link_hashes check (
  (recipient_confirm_hash is null
   or (recipient_confirm_hash ~ '^[0-9a-f]{64}$' and recipient_confirm_sent_at is not null))
  and (pause_token_hash is null or pause_token_hash ~ '^[0-9a-f]{64}$'));
create unique index if not exists report_schedules_confirm_hash_uq
  on public.report_schedules (recipient_confirm_hash) where recipient_confirm_hash is not null;
create unique index if not exists report_schedules_pause_hash_uq
  on public.report_schedules (pause_token_hash) where pause_token_hash is not null;

-- A link token as issue_account_link mints one: 32 bytes from two gen_random_uuid() values,
-- base64url, 43 characters.
create or replace function public.report_link_token()
returns text
language sql
volatile
set search_path = pg_catalog, pg_temp
as $$
  select pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(pg_catalog.decode(
           pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
                              '-', ''), 'hex'), 'base64'), '+/', '-_'), '=');
$$;

-- When a schedule runs next after p_after: the first moment later than p_after that is p_time_local
-- on weekday p_iso_weekday (1 Monday to 7 Sunday) in p_timezone; for 'monthly', on the first such
-- weekday of a calendar month. A zone PostgreSQL does not know raises 22023.
create or replace function public.report_schedule_next(
  p_cadence text, p_iso_weekday smallint, p_time_local text, p_timezone text, p_after timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_day date := (p_after at time zone p_timezone)::date;
  v_next timestamptz;
begin
  if p_cadence = 'weekly' then
    v_day := v_day + ((p_iso_weekday - pg_catalog.date_part('isodow', v_day)::integer + 7) % 7);
    v_next := (v_day + p_time_local::time) at time zone p_timezone;
    if v_next <= p_after then
      v_next := (v_day + 7 + p_time_local::time) at time zone p_timezone;
    end if;
    return v_next;
  end if;
  if p_cadence <> 'monthly' then
    raise exception 'report_schedule_next: a client report is weekly or monthly' using errcode = '22023';
  end if;
  v_day := pg_catalog.date_trunc('month', v_day)::date;
  for i in 1..2 loop
    v_next := (v_day + ((p_iso_weekday - pg_catalog.date_part('isodow', v_day)::integer + 7) % 7)
               + p_time_local::time) at time zone p_timezone;
    exit when v_next > p_after;
    v_day := (v_day + interval '1 month')::date;
  end loop;
  return v_next;
end;
$$;

-- The one writer of a client's name, contact address and owning seat. p holds any of client_name,
-- client_contact_email and owner_seat_id: a key present is written (null clears it), a key absent is
-- left, and any other key raises 22023, so sites.client_contact_name is not written here. The
-- address is trimmed and put in lower case. A contact address that changes clears the schedule's
-- confirmation, its two link hashes and the recipient's pause in the statement that writes the site
-- (the trigger sites_contact_changed, below): the next report waits for the new address to confirm.
-- Answers {outcome}: 'saved' with contact_changed; 'not_found' (no live site p_site of p_account
-- that is not a staging copy, or the account is deleted or marked for deletion); 'invalid_owner'
-- (owner_seat_id is not an active seat of the account that covers the site). Raises 22023 for an
-- address that is not one.
create or replace function public.set_client(p_site uuid, p_account uuid, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_keys constant text[] := array['client_name', 'client_contact_email', 'owner_seat_id'];
  v_old text;
  v_new text;
  v_owner uuid;
  v_changed boolean;
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object'
     or not (array(select pg_catalog.jsonb_object_keys(p)) <@ v_keys) then
    raise exception 'set_client: p holds a key set_client does not set' using errcode = '22023';
  end if;
  select st.client_contact_email into v_old
    from public.sites st
    join public.accounts a on a.id = st.account_id
   where st.id = p_site
     and st.account_id = p_account
     and st.removed_at is null
     and st.staging_of_site_id is null
     and a.deleted_at is null
     and a.deletion_confirmed_at is null
     for update of st;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;

  v_new := v_old;
  if p ? 'client_contact_email' then
    v_new := nullif(pg_catalog.lower(pg_catalog.btrim(p ->> 'client_contact_email')), '');
    if v_new is not null and v_new !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
      raise exception 'set_client: client_contact_email is not an address' using errcode = '22023';
    end if;
  end if;
  if p ? 'owner_seat_id' and (p ->> 'owner_seat_id') is not null then
    v_owner := (p ->> 'owner_seat_id')::uuid;
    if not exists (select 1
                     from public.seats s
                    where s.id = v_owner
                      and s.account_id = p_account
                      and s.status = 'active'
                      and (s.client_scope_all
                           or exists (select 1 from public.seat_sites ss
                                       where ss.seat_id = s.id and ss.site_id = p_site))) then
      return pg_catalog.jsonb_build_object('outcome', 'invalid_owner');
    end if;
  end if;
  v_changed := pg_catalog.lower(v_new) is distinct from pg_catalog.lower(v_old);

  update public.sites st
     set client_name = case when p ? 'client_name'
                            then nullif(pg_catalog.btrim(p ->> 'client_name'), '')
                            else st.client_name end,
         client_contact_email = v_new,
         owner_seat_id = case when p ? 'owner_seat_id' then v_owner else st.owner_seat_id end,
         updated_at = pg_catalog.now()
   where st.id = p_site;
  return pg_catalog.jsonb_build_object('outcome', 'saved', 'contact_changed', v_changed);
end;
$$;

-- What a schedule holds about its contact goes when the contact's address does, whoever changes it:
-- set_client above, and the erasure, whose rule blanks sites.client_contact_email directly
-- (20261112000002, rule 30). The confirmation, both link hashes (the pause link's is derived from
-- the address) and the recipient's pause are cleared in the statement that writes the site. Case
-- alone is not a change. The function is a trigger's: no role is granted it.
create or replace function public.sites_contact_changed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if pg_catalog.lower(new.client_contact_email)
       is distinct from pg_catalog.lower(old.client_contact_email) then
    update public.report_schedules rs
       set recipient_confirm_hash = null,
           recipient_confirm_sent_at = null,
           recipient_confirmed_at = null,
           pause_token_hash = null,
           paused_by_recipient_at = null,
           updated_at = pg_catalog.now()
     where rs.site_id = new.id;
  end if;
  return new;
end;
$$;
alter function public.sites_contact_changed() owner to postgres;
revoke all on function public.sites_contact_changed() from public, anon, authenticated, service_role;
drop trigger if exists sites_contact_changed on public.sites;
create trigger sites_contact_changed
  after update of client_contact_email on public.sites
  for each row execute function public.sites_contact_changed();

-- Writes a client site's report schedule, one row a site. p holds cadence ('weekly' or 'monthly'),
-- iso_weekday, time_local, timezone and send_when_unchanged, each required; any other key raises
-- 22023, as does a value the table's CHECKs or report_schedule_next refuse. next_run_at is the
-- first run after p_now. A schedule that exists keeps its confirmation, its pause and its last run.
-- Answers {outcome}: 'saved' with next_run_at; 'not_found' (as set_client).
create or replace function public.set_report_schedule(
  p_site uuid, p_account uuid, p jsonb, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_keys constant text[] :=
    array['cadence', 'iso_weekday', 'time_local', 'timezone', 'send_when_unchanged'];
  v_cadence text;
  v_weekday smallint;
  v_time text;
  v_zone text;
  v_unchanged boolean;
  v_next timestamptz;
begin
  if p_now is null then
    raise exception 'set_report_schedule: p_now is null' using errcode = '22004';
  end if;
  if pg_catalog.jsonb_typeof(p) is distinct from 'object'
     or not (array(select pg_catalog.jsonb_object_keys(p)) <@ v_keys)
     or not (p ?& v_keys) then
    raise exception 'set_report_schedule: p holds the five keys of a schedule and no other'
      using errcode = '22023';
  end if;
  v_cadence := p ->> 'cadence';
  v_time := p ->> 'time_local';
  v_zone := p ->> 'timezone';
  if v_cadence is null or v_cadence not in ('weekly', 'monthly')
     or v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or v_zone is null
     or pg_catalog.jsonb_typeof(p -> 'iso_weekday') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p -> 'send_when_unchanged') is distinct from 'boolean'
     or (p ->> 'iso_weekday') !~ '^[1-7]$' then
    raise exception 'set_report_schedule: a value is not one a schedule holds' using errcode = '22023';
  end if;
  v_weekday := (p ->> 'iso_weekday')::smallint;
  v_unchanged := (p ->> 'send_when_unchanged')::boolean;

  perform 1
     from public.sites st
     join public.accounts a on a.id = st.account_id
    where st.id = p_site
      and st.account_id = p_account
      and st.removed_at is null
      and st.staging_of_site_id is null
      and a.deleted_at is null
      and a.deletion_confirmed_at is null
      for update of st;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;

  v_next := public.report_schedule_next(v_cadence, v_weekday, v_time, v_zone, p_now);
  insert into public.report_schedules (
    site_id, account_id, cadence, iso_weekday, time_local, timezone, send_when_unchanged,
    page_slug, next_run_at, created_at, updated_at)
  values (p_site, p_account, v_cadence, v_weekday, v_time, v_zone, v_unchanged,
          'c-' || pg_catalog.replace(p_site::text, '-', ''), v_next, p_now, p_now)
  on conflict (site_id) do update
     set cadence = excluded.cadence,
         iso_weekday = excluded.iso_weekday,
         time_local = excluded.time_local,
         timezone = excluded.timezone,
         send_when_unchanged = excluded.send_when_unchanged,
         next_run_at = excluded.next_run_at,
         updated_at = excluded.updated_at;
  return pg_catalog.jsonb_build_object('outcome', 'saved', 'next_run_at', v_next);
end;
$$;

-- Removes a site's report schedule, with its confirmation and its links.
-- Answers {outcome}: 'cleared'; 'not_found' (no schedule for p_site on p_account).
create or replace function public.clear_report_schedule(p_site uuid, p_account uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  delete from public.report_schedules rs where rs.site_id = p_site and rs.account_id = p_account;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  return pg_catalog.jsonb_build_object('outcome', 'cleared');
end;
$$;

-- The mailer's call when it sends the confirmation mail of p_site's schedule: mints the link's
-- token, stores its sha256 with p_now as the time it was issued, and returns the token once with
-- what the mail says and where it goes. Calling it again replaces the stored hash, so the link sent
-- before stops working. The link is used within seven days of p_now (confirm_report_recipient).
-- An account in its Agency trial sends to its owner's own address and no other (D8), and that holds
-- for this mail as for a report: for such an account the contact must be the address of the
-- account's owner. The rule is here, so the hourly run, a saved contact and "ask again" share it.
-- Answers {outcome}: 'issued' with token, email, host and account_name; 'none' when the site has no
-- schedule or no contact address, the contact has confirmed, the account is in its Agency trial and
-- the contact is not its owner's address, the site is removed, or its account is deleted or marked
-- for deletion.
create or replace function public.issue_recipient_confirmation(p_site uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email text;
  v_host text;
  v_name text;
  v_raw text;
begin
  if p_now is null then
    raise exception 'issue_recipient_confirmation: p_now is null' using errcode = '22004';
  end if;
  select st.client_contact_email, st.host, a.name into v_email, v_host, v_name
    from public.report_schedules rs
    join public.sites st on st.id = rs.site_id
    join public.accounts a on a.id = st.account_id
   where rs.site_id = p_site
     and rs.recipient_confirmed_at is null
     and st.client_contact_email is not null
     and (a.state <> 'agency_trial'
          or exists (select 1
                       from public.seats o
                       join public.users u on u.id = o.user_id
                      where o.account_id = a.id and o.role = 'owner' and o.status = 'active'
                        and pg_catalog.lower(u.email) = pg_catalog.lower(st.client_contact_email)))
     and st.removed_at is null
     and a.deleted_at is null
     and a.deletion_confirmed_at is null
     for update of rs;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'none');
  end if;
  v_raw := public.report_link_token();
  update public.report_schedules rs
     set recipient_confirm_hash =
           pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_raw, 'UTF8')), 'hex'),
         recipient_confirm_sent_at = p_now
   where rs.site_id = p_site;
  return pg_catalog.jsonb_build_object(
    'outcome', 'issued', 'token', v_raw, 'email', v_email, 'host', v_host, 'account_name', v_name);
end;
$$;

-- What a recipient's link page says before its button is pressed, for a token hash: whether it is a
-- confirmation link or a pause link, the site the reports are about and the name of the account
-- that sends them. It changes nothing and returns no address.
-- Answers {outcome}: 'confirm' or 'pause' with host and account_name; 'gone' for a hash no schedule
-- holds, a confirmation link issued more than seven days before p_now, a removed site, and a
-- deleted or marked account.
create or replace function public.read_report_link(p_token_hash text, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select pg_catalog.jsonb_build_object(
              'outcome',
              case when rs.pause_token_hash = p_token_hash then 'pause' else 'confirm' end,
              'host', st.host, 'account_name', a.name)
       from public.report_schedules rs
       join public.sites st on st.id = rs.site_id
       join public.accounts a on a.id = st.account_id
      where (rs.pause_token_hash = p_token_hash
             or (rs.recipient_confirm_hash = p_token_hash
                 and rs.recipient_confirm_sent_at > p_now - interval '7 days'))
        and st.removed_at is null
        and a.deleted_at is null
        and a.deletion_confirmed_at is null),
    pg_catalog.jsonb_build_object('outcome', 'gone'));
$$;

-- The contact confirms: the schedule whose confirmation link hashes to p_token_hash, issued within
-- the seven days before p_now, is marked confirmed at p_now and the hash is cleared, so the link
-- works once. Answers {outcome}: 'confirmed'; 'gone' (as read_report_link).
create or replace function public.confirm_report_recipient(p_token_hash text, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_token_hash is null or p_now is null then
    raise exception 'confirm_report_recipient: a required argument is null' using errcode = '22004';
  end if;
  update public.report_schedules rs
     set recipient_confirmed_at = p_now,
         recipient_confirm_hash = null,
         updated_at = pg_catalog.now()
    from public.sites st
    join public.accounts a on a.id = st.account_id
   where rs.recipient_confirm_hash = p_token_hash
     and rs.recipient_confirm_sent_at > p_now - interval '7 days'
     and st.id = rs.site_id
     and st.removed_at is null
     and a.deleted_at is null
     and a.deletion_confirmed_at is null;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'gone');
  end if;
  return pg_catalog.jsonb_build_object('outcome', 'confirmed');
end;
$$;

-- The mailer's call when it sends a report of p_site's schedule to p_email: stores p_token_hash, the
-- sha256 of the pause link's token, and returns the address the report goes to. The mailer derives
-- the token from the site and that address (lib/v2/mail/report-pause-token.ts), so each report sent
-- to one contact carries the same pause link, and the link of an earlier report still pauses; a call
-- with the hash already stored changes nothing. A change of contact clears the hash
-- (sites_contact_changed), and a call for an address that is no longer the site's contact (a report
-- row written before the change, handled late) stores nothing.
-- Answers {outcome}: 'issued' with email, host and account_name; 'none' when the site has no
-- schedule, p_email is not its contact, the contact has not confirmed, the schedule is paused, the
-- site is removed, or its account is deleted or marked for deletion.
create or replace function public.issue_report_pause(
  p_site uuid, p_email text, p_token_hash text, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email text;
  v_host text;
  v_name text;
begin
  if p_email is null or p_token_hash is null or p_now is null then
    raise exception 'issue_report_pause: a required argument is null' using errcode = '22004';
  end if;
  select st.client_contact_email, st.host, a.name into v_email, v_host, v_name
    from public.report_schedules rs
    join public.sites st on st.id = rs.site_id
    join public.accounts a on a.id = st.account_id
   where rs.site_id = p_site
     and rs.recipient_confirmed_at is not null
     and rs.paused_by_recipient_at is null
     and pg_catalog.lower(st.client_contact_email) = pg_catalog.lower(pg_catalog.btrim(p_email))
     and st.removed_at is null
     and a.deleted_at is null
     and a.deletion_confirmed_at is null
     for update of rs;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'none');
  end if;
  update public.report_schedules rs
     set pause_token_hash = p_token_hash
   where rs.site_id = p_site and rs.pause_token_hash is distinct from p_token_hash;
  return pg_catalog.jsonb_build_object(
    'outcome', 'issued', 'email', v_email, 'host', v_host, 'account_name', v_name);
end;
$$;

-- The recipient pauses: the schedule whose pause link hashes to p_token_hash is paused from p_now.
-- A schedule already paused keeps the time it was first paused, and the link keeps answering.
-- Answers {outcome}: 'paused'; 'gone' for a hash no schedule holds.
create or replace function public.pause_report_schedule(p_token_hash text, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_token_hash is null or p_now is null then
    raise exception 'pause_report_schedule: a required argument is null' using errcode = '22004';
  end if;
  update public.report_schedules rs
     set paused_by_recipient_at = coalesce(rs.paused_by_recipient_at, p_now),
         updated_at = pg_catalog.now()
   where rs.pause_token_hash = p_token_hash;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'gone');
  end if;
  return pg_catalog.jsonb_build_object('outcome', 'paused');
end;
$$;

-- The account resumes a schedule its recipient paused: the pause is cleared and next_run_at is the
-- first run after p_now, so a schedule paused for a month does not send at once for the weeks missed.
-- Answers {outcome}: 'resumed' with next_run_at; 'not_paused'; 'not_found' (no schedule for p_site on
-- p_account).
create or replace function public.resume_report_schedule(
  p_site uuid, p_account uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v public.report_schedules%rowtype;
  v_next timestamptz;
begin
  if p_now is null then
    raise exception 'resume_report_schedule: p_now is null' using errcode = '22004';
  end if;
  select rs.* into v
    from public.report_schedules rs
   where rs.site_id = p_site and rs.account_id = p_account
     for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if v.paused_by_recipient_at is null then
    return pg_catalog.jsonb_build_object('outcome', 'not_paused');
  end if;
  v_next := public.report_schedule_next(v.cadence, v.iso_weekday, v.time_local, v.timezone, p_now);
  update public.report_schedules rs
     set paused_by_recipient_at = null, next_run_at = v_next, updated_at = pg_catalog.now()
   where rs.site_id = p_site;
  return pg_catalog.jsonb_build_object('outcome', 'resumed', 'next_run_at', v_next);
end;
$$;

-- The schedules to run at p_now, earliest first, at most p_limit: not paused, next_run_at at or
-- before p_now, of a live site that is not removed and an account neither deleted nor marked for
-- deletion. Each as a jsonb object, with what the runner decides on and no address:
--   site_id, account_id, slot (the schedule's next_run_at), send_when_unchanged;
--   has_contact, confirmed, confirmation_requested (a confirmation link was issued);
--   contact_is_owner (the contact address is the account owner's own, compared in lower case);
--   the account's state, tier, past_due_tier, past_due_since, trial_variant and trial_ends_at, from
--   which the runner reads the plan and whether the account is in its Agency trial;
--   check_id, the site's latest finished or partial check, or null;
--   changed, whether a change other than a baseline was detected at the site after the last client
--   report sent for it (true when none was sent).
create or replace function public.due_report_schedules(p_now timestamptz, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(pg_catalog.jsonb_agg(d.o order by d.slot, d.site_id), '[]'::jsonb)
    from (
      select rs.next_run_at as slot, rs.site_id,
             pg_catalog.jsonb_build_object(
               'site_id', rs.site_id,
               'account_id', rs.account_id,
               'slot', rs.next_run_at,
               'send_when_unchanged', rs.send_when_unchanged,
               'has_contact', st.client_contact_email is not null,
               'confirmed', rs.recipient_confirmed_at is not null,
               'confirmation_requested', rs.recipient_confirm_sent_at is not null,
               'contact_is_owner', coalesce(
                 (select pg_catalog.lower(u.email) = pg_catalog.lower(st.client_contact_email)
                    from public.seats o
                    join public.users u on u.id = o.user_id
                   where o.account_id = rs.account_id and o.role = 'owner' and o.status = 'active'),
                 false),
               'state', a.state,
               'tier', a.tier,
               'past_due_tier', a.past_due_tier,
               'past_due_since', a.past_due_since,
               'trial_variant', a.trial_variant,
               'trial_ends_at', a.trial_ends_at,
               'check_id', (select c.id
                              from public.checks c
                             where c.site_id = rs.site_id and c.status in ('finished', 'partial')
                             order by c.finished_at desc, c.id
                             limit 1),
               -- Whether a check queued after the one the last sent report ended on found a change:
               -- asked of what that report covered, not of when its mail went, so a change found
               -- between the report's write and its mail is still one. True with no report sent.
               'changed', coalesce(
                 (select exists (select 1
                                   from public.changes ch
                                   join public.checks cc on cc.id = ch.check_id
                                  where ch.site_id = rs.site_id
                                    and ch.kind <> 'baseline'
                                    and cc.queued_at > lc.queued_at)
                    from (select r.covers_check_ids[
                                   pg_catalog.array_upper(r.covers_check_ids, 1)] as check_id
                            from public.reports r
                           where r.site_id = rs.site_id and r.kind = 'client_report'
                             and r.status = 'sent'
                           order by r.sent_at desc, r.scheduled_for desc nulls last, r.id desc
                           limit 1) last
                    join public.checks lc on lc.id = last.check_id),
                 true)) as o
        from public.report_schedules rs
        join public.sites st on st.id = rs.site_id
        join public.accounts a on a.id = rs.account_id
       where rs.paused_by_recipient_at is null
         and rs.next_run_at <= p_now
         and st.removed_at is null
         and a.deleted_at is null
         and a.deletion_confirmed_at is null
       order by rs.next_run_at, rs.site_id
       limit p_limit
    ) d;
$$;

-- The runner is done with p_site's schedule for the run at p_now, whether or not it sent:
-- last_run_at is p_now and next_run_at the first run after it. Returns the new next_run_at, or
-- null when the site has no schedule.
create or replace function public.mark_report_schedule_run(p_site uuid, p_now timestamptz)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_next timestamptz;
begin
  if p_now is null then
    raise exception 'mark_report_schedule_run: p_now is null' using errcode = '22004';
  end if;
  update public.report_schedules rs
     set last_run_at = p_now,
         next_run_at = public.report_schedule_next(
           rs.cadence, rs.iso_weekday, rs.time_local, rs.timezone, p_now),
         updated_at = pg_catalog.now()
   where rs.site_id = p_site
  returning rs.next_run_at into v_next;
  return v_next;
end;
$$;

-- The client report of p_site's schedule for the run at p_slot: a reports row of kind
-- 'client_report' and status 'scheduled', made by the schedule, for the site's contact address as it
-- is now and its owning seat. It covers p_check, and before it the check the site's last sent client
-- report covered when that is another finished or partial check of the site, so the report's
-- document compares the two. Its document is a file like any report's: the row names its object
-- from this write (report_file_path) with file_state 'pending', and the mailer stores the document
-- when it sends (finish_report). One row a site and slot: a second call for the same slot writes
-- nothing and answers with the row the first wrote, so a run that is retried does not send twice.
-- Answers {outcome}: 'written' or 'exists', each with report_id and status; 'none' when the site has
-- no contact address, or p_check is not a finished or partial check of it.
create or replace function public.write_client_report(
  p_site uuid, p_slot timestamptz, p_check uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account uuid;
  v_email text;
  v_owner uuid;
  v_report uuid;
  v_status text;
  v_before uuid;
  v_new constant uuid := pg_catalog.gen_random_uuid();
begin
  if p_slot is null or p_now is null then
    raise exception 'write_client_report: a required argument is null' using errcode = '22004';
  end if;
  -- The account's row is locked before the site's, the order section A's functions take them in
  -- (remove_seat, and apply_entitlement_transition before it): the insert below takes the
  -- account's key through the report's foreign key.
  select st.account_id into v_account from public.sites st where st.id = p_site;
  perform 1 from public.accounts a where a.id = v_account for update;
  select st.account_id, st.client_contact_email, st.owner_seat_id into v_account, v_email, v_owner
    from public.sites st
   where st.id = p_site and st.account_id is not null and st.removed_at is null
     for update;
  if not found or v_email is null
     or not exists (select 1 from public.checks c
                     where c.id = p_check and c.site_id = p_site
                       and c.status in ('finished', 'partial')) then
    return pg_catalog.jsonb_build_object('outcome', 'none');
  end if;
  select r.id, r.status into v_report, v_status
    from public.reports r
   where r.site_id = p_site and r.kind = 'client_report' and r.made_by = 'report_schedule'
     and r.scheduled_for = p_slot;
  if found then
    return pg_catalog.jsonb_build_object('outcome', 'exists', 'report_id', v_report, 'status', v_status);
  end if;
  -- The check the last report sent for this site ended on, when it is another check than p_check
  -- and is still a finished or partial check of the site. An earlier report is not looked at: a
  -- report on the check the last one covered is about one check, not last time's comparison again.
  select c.id into v_before
    from (select r.covers_check_ids[pg_catalog.array_upper(r.covers_check_ids, 1)] as check_id
            from public.reports r
           where r.site_id = p_site and r.kind = 'client_report' and r.status = 'sent'
           order by r.sent_at desc, r.scheduled_for desc nulls last, r.id desc
           limit 1) last
    join public.checks c on c.id = last.check_id
   where c.site_id = p_site and c.status in ('finished', 'partial') and c.id <> p_check;
  insert into public.reports (id, account_id, site_id, kind, format, status, made_by, created_at,
                              covers_check_ids, scheduled_for, recipient_email, owner_seat_id,
                              file_state, storage_path)
  values (v_new, v_account, p_site, 'client_report', 'html', 'scheduled', 'report_schedule', p_now,
          case when v_before is null then array[p_check] else array[v_before, p_check] end,
          p_slot, v_email, v_owner, 'pending',
          public.report_file_path(v_account, v_new, 'html'));
  return pg_catalog.jsonb_build_object('outcome', 'written', 'report_id', v_new, 'status', 'scheduled');
end;
$$;

-- A client report's mail was sent: the row becomes 'sent' at p_now. first is true when the account
-- had sent no client report before this one.
-- Answers {outcome}: 'sent' with account_id and first; 'already' (the row is sent); 'not_found' (no
-- client report p_report waiting to be sent).
create or replace function public.mark_client_report_sent(p_report uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account uuid;
  v_status text;
  v_first boolean;
begin
  if p_now is null then
    raise exception 'mark_client_report_sent: p_now is null' using errcode = '22004';
  end if;
  select r.account_id, r.status into v_account, v_status
    from public.reports r
   where r.id = p_report and r.kind = 'client_report'
     for update;
  if not found or v_status not in ('scheduled', 'sent') then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if v_status = 'sent' then
    return pg_catalog.jsonb_build_object('outcome', 'already');
  end if;
  perform 1 from public.accounts a where a.id = v_account for update;
  v_first := not exists (select 1 from public.reports r
                          where r.account_id = v_account and r.kind = 'client_report'
                            and r.status = 'sent');
  update public.reports r set status = 'sent', sent_at = p_now where r.id = p_report;
  return pg_catalog.jsonb_build_object('outcome', 'sent', 'account_id', v_account, 'first', v_first);
end;
$$;

revoke all on function public.report_link_token() from public, anon, authenticated;
revoke all on function public.report_schedule_next(text, smallint, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.set_client(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_report_schedule(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.clear_report_schedule(uuid, uuid) from public, anon, authenticated;
revoke all on function public.issue_recipient_confirmation(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.read_report_link(text, timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_report_recipient(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.issue_report_pause(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.pause_report_schedule(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.resume_report_schedule(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.due_report_schedules(timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.mark_report_schedule_run(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.write_client_report(uuid, timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.mark_client_report_sent(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.report_link_token() to service_role;
grant execute on function public.report_schedule_next(text, smallint, text, text, timestamptz)
  to service_role;
grant execute on function public.set_client(uuid, uuid, jsonb) to service_role;
grant execute on function public.set_report_schedule(uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.clear_report_schedule(uuid, uuid) to service_role;
grant execute on function public.issue_recipient_confirmation(uuid, timestamptz) to service_role;
grant execute on function public.read_report_link(text, timestamptz) to service_role;
grant execute on function public.confirm_report_recipient(text, timestamptz) to service_role;
grant execute on function public.issue_report_pause(uuid, text, text, timestamptz) to service_role;
grant execute on function public.pause_report_schedule(text, timestamptz) to service_role;
grant execute on function public.resume_report_schedule(uuid, uuid, timestamptz) to service_role;
grant execute on function public.due_report_schedules(timestamptz, integer) to service_role;
grant execute on function public.mark_report_schedule_run(uuid, timestamptz) to service_role;
grant execute on function public.write_client_report(uuid, timestamptz, uuid, timestamptz)
  to service_role;
grant execute on function public.mark_client_report_sent(uuid, timestamptz) to service_role;

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: erasure and mail kinds ════════════════════════════════════════════════════════════════════

-- Three kinds of mail join the ledger (docs/specs/v2/31-agency.md §6 and §10). The list in code is
-- MAIL_KINDS, apps/web/lib/v2/mail/types.ts:
--   seat_invite     a seat's invitation                              a suppression does not stop it
--   report_confirm  the confirmation asked of a client's contact     a suppression does not stop it
--   client_report   a scheduled client report                        a suppression stops it
--
-- 028 lists the kinds in two places: the CHECK on email_sends.kind, and email_kind_suppressible. Both
-- are rebuilt here from what they hold when this runs, with the three added, so a kind a migration
-- before this one added stays, with its answer. The block reads the CHECK on the kind column alone
-- and raises, changing nothing, unless there is one and it is a plain list of kinds. Run again, it
-- finds the three there and writes the same two definitions.
--
-- Test: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-m-mail-kinds.test.ts
do $$
declare
  v_added constant text[] := array['seat_invite', 'report_confirm', 'client_report'];
  v_added_suppressible constant text[] := array['client_report'];
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

  -- What a suppression stops now, asked of the function for each kind the CHECK lists.
  select coalesce(pg_catalog.array_agg(u.k order by u.n), '{}')
    into v_suppressible
    from pg_catalog.unnest(v_kinds) with ordinality as u(k, n)
   where u.k <> all (v_added) and public.email_kind_suppressible(u.k);
  v_kinds := v_kinds || coalesce(
    (select pg_catalog.array_agg(a.k order by a.n)
       from pg_catalog.unnest(v_added) with ordinality as a(k, n)
      where a.k <> all (v_kinds)), '{}');
  v_suppressible := v_suppressible || v_added_suppressible;

  execute pg_catalog.format('alter table public.email_sends drop constraint %I', v_name);
  execute pg_catalog.format(
    'alter table public.email_sends add constraint %I check (kind in (%s))', v_name,
    (select pg_catalog.string_agg(pg_catalog.quote_literal(u.k), ', ' order by u.n)
       from pg_catalog.unnest(v_kinds) with ordinality as u(k, n)));
  execute pg_catalog.format(
    'create or replace function public.email_kind_suppressible(p_kind text) returns boolean '
    'language sql immutable set search_path = pg_catalog, pg_temp '
    'as $f$ select p_kind = any (%L::text[]); $f$', v_suppressible);
end;
$$;

revoke all on function public.email_kind_suppressible(text) from public, anon, authenticated;
grant execute on function public.email_kind_suppressible(text) to service_role;

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
