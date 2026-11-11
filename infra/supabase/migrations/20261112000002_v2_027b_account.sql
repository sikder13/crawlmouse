-- v2 migration 027b (CC-27b): the account's email change, its deletion with a seven-day restore, the
-- shared erasure, and the account's Slack destination. Spec: docs/specs/v2/27b-account-wiring.md.
--
-- What changes for existing readers. Two columns are added to public.accounts (no client grant: 001
-- grants authenticated SELECT on accounts column by column, so they stay hidden). is_member,
-- member_role and is_member_for_site are redefined with one more condition, that the account is not
-- marked for deletion, so every policy and role check that calls them refuses a marked account at once.
-- Their signatures, owners, grants and search_path (20261108000002) are unchanged. Nothing else existing is altered.
--
-- Every function here is owned by postgres, revoked from every client role and granted to
-- service_role only; a route establishes the caller's role through the caller's own session before it
-- calls one. Definer functions set search_path = pg_catalog, public, pg_temp and name every object
-- with its schema.
--
-- Every statement is re-runnable (the tests apply the file twice). The revert is
-- infra/supabase/rollbacks/20261112000002_v2_027b_account.revert.sql.

-- ═══ Shared: the deletion mark, tokens and the account's events ═══════════════════════════════════

-- Set together when a deletion is confirmed, cleared together by a restore. accounts.deleted_at is
-- not used: the Stripe webhook and the reconcile skip rows that carry it (lib/billing/webhook-db.ts,
-- reconcile-v2.ts), and during the window Stripe's events for the account must still apply.
alter table public.accounts add column if not exists deletion_confirmed_at timestamptz;
alter table public.accounts add column if not exists purge_after timestamptz;
alter table public.accounts drop constraint if exists accounts_deletion_pair;
alter table public.accounts add constraint accounts_deletion_pair check (
  (deletion_confirmed_at is null) = (purge_after is null)
  and (purge_after is null or purge_after > deletion_confirmed_at));
create index if not exists accounts_purge_after_idx on public.accounts (purge_after)
  where purge_after is not null;

create or replace function public.is_member(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.seats s
      join public.accounts a on a.id = s.account_id
     where s.account_id = p_account
       and s.user_id = auth.uid()
       and s.status = 'active'
       and a.deleted_at is null
       and a.deletion_confirmed_at is null
  );
$$;

create or replace function public.member_role(p_account uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select s.role
    from public.seats s
    join public.accounts a on a.id = s.account_id
   where s.account_id = p_account
     and s.user_id = auth.uid()
     and s.status = 'active'
     and a.deleted_at is null
     and a.deletion_confirmed_at is null
   limit 1;
$$;

create or replace function public.is_member_for_site(p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.sites st
      join public.accounts a on a.id = st.account_id
      join public.seats s on s.account_id = st.account_id
     where st.id = p_site
       and s.user_id = auth.uid()
       and s.status = 'active'
       and a.deleted_at is null
       and a.deletion_confirmed_at is null
       and (s.client_scope_all
            or exists (select 1
                         from public.seat_sites ss
                        where ss.seat_id = s.id
                          and ss.site_id in (st.id, st.staging_of_site_id)))
  );
$$;

-- A link we email. The row is created with no token (Q5 ruling): `token_hash` and `issued_at` are null
-- until the mailer calls issue_account_link, which mints the raw token, stores only its sha256 and
-- returns the raw token once. No raw token is kept in the database, in Vault or in an event.
create table if not exists public.account_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('email_change', 'email_change_undo', 'delete_confirm', 'delete_restore')),
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz,
  -- A link sent in the same email as another: the deletion email's restore link names its confirm
  -- link here, and issue_account_link on the confirm link issues both.
  paired_with uuid references public.account_tokens (id) on delete cascade,
  -- email_change and email_change_undo only: the address moved to and the one moved from.
  new_email text,
  old_email text,
  -- delete_confirm and delete_restore only: the sign-in address when the deletion was requested, where
  -- both links go even if the address changes before the mailer sends.
  recipient text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  -- A token another action ended before it was used (an undo, a newer request, a restore).
  revoked_at timestamptz,
  constraint account_tokens_issued check ((token_hash is null) = (issued_at is null)),
  constraint account_tokens_used_after_issue check (used_at is null or issued_at is not null),
  constraint account_tokens_emails check (
    (kind in ('email_change', 'email_change_undo')) = (new_email is not null and old_email is not null)),
  constraint account_tokens_expiry check (expires_at > created_at),
  constraint account_tokens_pair check (paired_with is null or kind = 'delete_restore'),
  constraint account_tokens_recipient check (
    (kind in ('delete_confirm', 'delete_restore')) = (recipient is not null))
);
create index if not exists account_tokens_account_idx on public.account_tokens (account_id, kind);
alter table public.account_tokens enable row level security;
revoke all on public.account_tokens from public, anon, authenticated;

-- What happened to the account, without addresses. The rows go with the account.
create table if not exists public.account_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null check (kind in ('email_change_requested', 'email_changed', 'email_change_undone',
                                     'delete_requested', 'delete_confirmed', 'delete_restored')),
  actor_user_id uuid,
  at timestamptz not null default now()
);
create index if not exists account_events_account_idx on public.account_events (account_id, at);
alter table public.account_events enable row level security;
revoke all on public.account_events from public, anon, authenticated;

-- One live link of each email kind per person, whichever of their accounts it is on (fix round 1,
-- C5: the address is the person's, not the account's). A request creates the confirmation link and the
-- old address's undo link together, so the two kinds live side by side; request_email_change refuses a
-- second change while either of the first one's links is live (CMA02), and this index is what holds
-- when two requests race past that check. Dropped and created on every run, since its key changed.
drop index if exists public.account_tokens_one_email_change_uq;
drop index if exists public.account_tokens_one_live_email_link_uq;
create unique index account_tokens_one_live_email_link_uq
  on public.account_tokens (user_id, kind)
  where kind in ('email_change', 'email_change_undo') and used_at is null and revoked_at is null;

-- The addresses a person signed in with before an email change. The erasure reads them with the current
-- one, so an old address left in another table is still found. Not granted to a client role:
-- authenticated holds SELECT on users column by column (20261106000002), so a new column stays hidden.
alter table public.users add column if not exists previous_emails text[] not null default '{}';

-- The deletions waiting for their window to end: one row per person, holding the accounts the
-- confirm marked. No foreign key, so nothing the erasure deletes takes the row with it; the purge
-- deletes it only once the person's Auth user is gone (D4, plan-revision R1).
create table if not exists public.pending_erasures (
  user_id uuid primary key,
  accounts uuid[] not null check (cardinality(accounts) >= 1),
  confirmed_at timestamptz not null,
  purge_after timestamptz not null check (purge_after > confirmed_at),
  attempts integer not null default 0,
  last_attempt_at timestamptz
);
alter table public.pending_erasures enable row level security;
revoke all on public.pending_erasures from public, anon, authenticated;

-- Ends a person's sessions: every one, or every one but p_keep_session (the caller's own, after an
-- email change they confirmed). auth.refresh_tokens rows cascade from auth.sessions; rows with no
-- session_id (issued before sessions existed) are deleted by user id.
create or replace function public.end_user_sessions(p_user uuid, p_keep_session uuid default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v integer;
begin
  delete from auth.sessions s
   where s.user_id = p_user and (p_keep_session is null or s.id <> p_keep_session);
  get diagnostics v = row_count;
  if p_keep_session is null then
    delete from auth.refresh_tokens r where r.user_id = p_user::text;
  else
    delete from auth.refresh_tokens r where r.user_id = p_user::text and r.session_id is null;
  end if;
  return v;
end;
$$;
revoke all on function public.end_user_sessions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_user_sessions(uuid, uuid) to service_role;

-- Creates a link's row, with no token yet (the mailer issues it at send). A live token of the same kind
-- for the same account is revoked first, so a second request ends the first link (an email change
-- is refused while one is in flight, by request_email_change and account_tokens_one_live_email_link_uq).
create or replace function public.create_account_token(
  p_account uuid, p_user uuid, p_kind text, p_expires_at timestamptz,
  p_new_email text default null, p_old_email text default null, p_paired_with uuid default null,
  p_recipient text default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
begin
  update public.account_tokens t set revoked_at = now()
   where t.account_id = p_account and t.kind = p_kind and t.used_at is null and t.revoked_at is null;
  insert into public.account_tokens
    (account_id, user_id, kind, new_email, old_email, expires_at, paired_with, recipient)
  values (p_account, p_user, p_kind, p_new_email, p_old_email, p_expires_at, p_paired_with, p_recipient)
  returning id into v_id;
  return v_id;
end;
$$;

-- The mailer's call at send time (CC-28): mints a raw token, stores its sha256 and returns the raw
-- token with the recipient read from the row; for a deletion email, its paired restore link too, as a
-- second row. Answers only for a row that is unexpired, unused and unrevoked; otherwise no row. A retried send calls it again and gets a fresh token, and the earlier
-- one stops working because its hash is replaced.
-- The token is 32 bytes from two gen_random_uuid() values (pg_catalog's; pgcrypto lives in a
-- different schema on production and in the test sandbox): 244 random bits, base64url, 43 characters,
-- the shape apps/web/lib/v2/account/tokens.ts `isToken` accepts. The recipient is read from the row:
-- the new address for an email_change, the old one for its undo, and for a deletion link the sign-in
-- address request_account_deletion stored on it.
create or replace function public.issue_account_link(p_token uuid)
returns table (kind text, token text, recipient text)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v public.account_tokens%rowtype;
  v_raw text;
begin
  -- The link named, then any link sent in the same email (its paired restore link), in that order.
  for v in
    select * from public.account_tokens t
     where t.id = p_token
        or (t.paired_with = p_token
            and exists (select 1 from public.account_tokens c where c.id = p_token
                         and c.used_at is null and c.revoked_at is null and c.expires_at > now()))
     order by (t.id <> p_token), t.id
       for update
  loop
    continue when v.used_at is not null or v.revoked_at is not null or v.expires_at <= now();
    v_raw := rtrim(translate(encode(decode(
               replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'),
               'base64'), '+/', '-_'), '=');
    update public.account_tokens t
       set token_hash = encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), issued_at = now()
     where t.id = v.id;
    kind := v.kind;
    token := v_raw;
    recipient := case v.kind
                   when 'email_change' then v.new_email
                   when 'email_change_undo' then v.old_email
                   else v.recipient
                 end;
    return next;
  end loop;
end;
$$;

revoke all on function public.create_account_token(uuid, uuid, text, timestamptz, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.issue_account_link(uuid) from public, anon, authenticated;
grant execute on function public.create_account_token(uuid, uuid, text, timestamptz, text, text, uuid, text)
  to service_role;
grant execute on function public.issue_account_link(uuid) to service_role;

-- ═══ A: email change (D3) ═════════════════════════════════════════════════════════════════════════

-- The person's sign-in address changes in two steps, each a link. A request (request_email_change)
-- creates both links at once: the confirmation link, for the new address, and the "this wasn't me"
-- link, for the old one, so the old address hears before anything changes (D3). Confirming moves the
-- rows (apply_email_change) and gives the undo link seven days from that moment. The undo
-- (prepare_email_undo, then undo_email_change) stops a pending change, or, once it has applied, moves
-- the rows back. Supabase Auth's own row is changed by the caller, between the calls
-- (lib/v2/account/email-change.ts); revert_email_change undoes apply_email_change when Auth refuses.
--
-- The two links of one request are the email_change row and the email_change_undo row of the same
-- account created in the same transaction: their created_at, the transaction's now(), is equal, and
-- so are their addresses. That is how each function here finds a link's partner.
--
-- One change is in flight per person, across every account they hold: a request is refused (CMA02)
-- while the person has a live confirmation link, or a live undo link whose change has applied; an undo
-- link whose change was never confirmed and has expired does not hold them, and the next request
-- revokes it. account_tokens_one_live_email_link_uq holds when two requests race. No change starts
-- while the person's deletion is under way (CMA07). Both links are rows with no token until the
-- mailer issues them (issue_account_link, owner ruling Q5); a function here accepts a token only for
-- a row that was issued (`issued_at is not null`), so a row the mailer never issued, whose
-- token_hash is null, cannot be consumed.
--
-- Refusals, by SQLSTATE; lib/v2/account/email-change.ts answers each:
--   CMA01  the new address is the person's current one
--   CMA02  an email change is in flight for the account
--   CMA03  the account is marked for deletion
--   CMA04  another sign-in user or profile holds the address
--   CMA05  the link's token is unknown, of another kind, used, revoked or expired, or its change
--          was stopped
--   CMA06  the undo was prepared for a change that was pending, and the change applied in between
--   CMA07  the person's deletion is under way: a live delete_confirm link (the 24 hours before a
--          confirm) or a pending_erasures row (after it). A live delete_restore link alone does not
--          refuse: every deletion request creates one for 8 days, confirmed or not (fix round 2).

-- users.email_normalized: the rule of apps/web/lib/auth/normalize-email.ts (the trial ledger's key),
-- for an address request_email_change accepted (lowercase, no surrounding space). The TS function
-- stays the definition; __tests__/v2-027b-a-email.test.ts holds this one to it.
create or replace function public.normalize_email(p_email text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parts text[] := pg_catalog.regexp_match(pg_catalog.lower(pg_catalog.btrim(p_email)), '^(.+)@([^@]+)$');
  v_local text;
  v_domain text;
begin
  if v_parts is null then
    raise exception 'normalize_email: not an email address' using errcode = '22023';
  end if;
  v_local := v_parts[1];
  v_domain := v_parts[2];
  -- A tag is what follows the first `+`; an address that starts with `+` has none.
  if pg_catalog.split_part(v_local, '+', 1) <> '' then
    v_local := pg_catalog.split_part(v_local, '+', 1);
  end if;
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := pg_catalog.replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end;
$$;

-- Whether a sign-in user or profile other than p_user holds p_email, compared case-insensitively.
create or replace function public.email_held_by_other(p_email text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (select 1 from auth.users u
                  where pg_catalog.lower(u.email) = pg_catalog.lower(p_email) and u.id <> p_user)
      or exists (select 1 from public.users u
                  where pg_catalog.lower(u.email) = pg_catalog.lower(p_email) and u.id <> p_user);
$$;

-- Both links' rows, with no token until the mailer issues them: the confirmation link sixty minutes
-- from p_now, the undo link sixty minutes and seven days (it outlives any confirm). Returns
-- {change_token_id, undo_token_id}, the mailer's handles. Whether the new address is in use is not
-- checked here: the request answers the same either way, and apply_email_change refuses a held address.
create or replace function public.request_email_change(
  p_account uuid, p_user uuid, p_new_email text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_marked boolean;
  v_current text;
  v_constraint text;
  v_change uuid;
  v_undo uuid;
begin
  if p_new_email is null or p_new_email <> pg_catalog.lower(pg_catalog.btrim(p_new_email))
     or pg_catalog.length(p_new_email) > 254 or p_new_email !~ '^[^@]+@[^@]+$' then
    raise exception 'request_email_change: not a lowercase address' using errcode = '22023';
  end if;
  select a.deletion_confirmed_at is not null into v_marked from public.accounts a where a.id = p_account;
  if not found then
    raise exception 'request_email_change: account % not found', p_account using errcode = 'P0002';
  end if;
  if v_marked then
    raise exception 'request_email_change: the account is marked for deletion' using errcode = 'CMA03';
  end if;
  select u.email into v_current from public.users u where u.id = p_user;
  if not found then
    raise exception 'request_email_change: user % not found', p_user using errcode = 'P0002';
  end if;
  if pg_catalog.lower(v_current) = p_new_email then
    raise exception 'request_email_change: that is the current address' using errcode = 'CMA01';
  end if;
  if exists (select 1 from public.pending_erasures e where e.user_id = p_user)
     or exists (select 1 from public.account_tokens k
                 where k.user_id = p_user and k.kind = 'delete_confirm'
                   and k.used_at is null and k.revoked_at is null and k.expires_at > p_now) then
    raise exception 'request_email_change: the person''s deletion is under way' using errcode = 'CMA07';
  end if;
  -- The one definition of "in flight", which a deletion's request and confirm also ask (section B).
  if public.email_change_live(p_user, p_now) then
    raise exception 'request_email_change: an email change is in flight' using errcode = 'CMA02';
  end if;
  -- What is left of the person's earlier requests cannot be used (the check above passed), on this
  -- account or another; ending it frees the index. create_account_token revokes this account's only.
  update public.account_tokens k set revoked_at = now()
   where k.user_id = p_user and k.kind in ('email_change', 'email_change_undo')
     and k.used_at is null and k.revoked_at is null;
  begin
    v_change := public.create_account_token(p_account, p_user, 'email_change',
                                            p_now + interval '60 minutes', p_new_email, v_current);
    v_undo := public.create_account_token(p_account, p_user, 'email_change_undo',
                                          p_now + interval '60 minutes' + interval '7 days',
                                          p_new_email, v_current);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'account_tokens_one_live_email_link_uq' then
      raise exception 'request_email_change: an email change is in flight' using errcode = 'CMA02';
    end if;
    raise;
  end;
  insert into public.account_events (account_id, kind, actor_user_id)
  values (p_account, 'email_change_requested', p_user);
  return pg_catalog.jsonb_build_object('change_token_id', v_change, 'undo_token_id', v_undo);
end;
$$;

-- Confirms the change in one transaction: consumes the email_change token, refuses a held address,
-- moves public.users (email, email_normalized; the address it leaves is appended to previous_emails)
-- and the person's seats invited under the old address, and sets the request's undo link to expire
-- seven days from p_now. Returns {user_id, account_id, old_email, new_email, undo_token_id, tier};
-- tier is accounts.tier as stored. The advisory lock serialises the functions here that move a person
-- to the same address; Auth's own sign-up does not take it, so a sign-up can still claim the address
-- before the caller's Auth update, which then fails and is reverted.
create or replace function public.apply_email_change(p_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  t public.account_tokens%rowtype;
  v_tier text;
  v_old text;
  v_undo uuid;
begin
  select * into t from public.account_tokens k
   where k.token_hash = p_hash and k.kind = 'email_change'
     and k.issued_at is not null and k.used_at is null and k.revoked_at is null
     and k.expires_at > p_now
     for update;
  if not found then
    raise exception 'apply_email_change: the link cannot be used' using errcode = 'CMA05';
  end if;
  select a.tier into v_tier from public.accounts a
   where a.id = t.account_id and a.deletion_confirmed_at is null;
  if not found then
    raise exception 'apply_email_change: the account is marked for deletion' using errcode = 'CMA03';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account_email:' || pg_catalog.lower(t.new_email), 0));
  if public.email_held_by_other(t.new_email, t.user_id) then
    raise exception 'apply_email_change: the address is taken' using errcode = 'CMA04';
  end if;
  update public.account_tokens u set expires_at = p_now + interval '7 days'
   where u.account_id = t.account_id and u.kind = 'email_change_undo' and u.created_at = t.created_at
     and u.used_at is null and u.revoked_at is null
  returning u.id into v_undo;
  if v_undo is null then
    -- The request's undo link was used (which revokes this link too) or replaced: no change applies
    -- without a way back.
    raise exception 'apply_email_change: the change has no live undo link' using errcode = 'CMA05';
  end if;
  select u.email into v_old from public.users u where u.id = t.user_id for update;

  update public.account_tokens k set used_at = p_now where k.id = t.id;
  begin
    update public.users u
       set email = t.new_email,
           email_normalized = public.normalize_email(t.new_email),
           previous_emails = pg_catalog.array_append(pg_catalog.array_remove(u.previous_emails, v_old), v_old)
     where u.id = t.user_id;
  exception when unique_violation then
    raise exception 'apply_email_change: the address is taken' using errcode = 'CMA04';
  end;
  update public.seats s set invited_email = t.new_email
   where s.user_id = t.user_id and pg_catalog.lower(s.invited_email) = pg_catalog.lower(v_old);
  insert into public.account_events (account_id, kind, actor_user_id)
  values (t.account_id, 'email_changed', t.user_id);
  return pg_catalog.jsonb_build_object(
    'user_id', t.user_id, 'account_id', t.account_id, 'old_email', v_old, 'new_email', t.new_email,
    'undo_token_id', v_undo, 'tier', v_tier);
end;
$$;

-- When Auth refuses the change apply_email_change made in our rows: the rows go back, the undo link
-- is revoked and the latest email_changed event of the person on the account is removed. The
-- email_change token stays used, so the person asks again.
create or replace function public.revert_email_change(p_undo_token uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  t public.account_tokens%rowtype;
begin
  select * into t from public.account_tokens k
   where k.id = p_undo_token and k.kind = 'email_change_undo'
     and k.used_at is null and k.revoked_at is null
     for update;
  if not found then
    raise exception 'revert_email_change: no live undo link %', p_undo_token using errcode = 'CMA05';
  end if;
  update public.users u
     set email = t.old_email,
         email_normalized = public.normalize_email(t.old_email),
         previous_emails = pg_catalog.array_remove(u.previous_emails, t.old_email)
   where u.id = t.user_id and u.email = t.new_email;
  update public.seats s set invited_email = t.old_email
   where s.user_id = t.user_id and pg_catalog.lower(s.invited_email) = pg_catalog.lower(t.new_email);
  update public.account_tokens k set revoked_at = now() where k.id = t.id;
  delete from public.account_events e
   where e.id = (select x.id from public.account_events x
                  where x.account_id = t.account_id and x.kind = 'email_changed'
                    and x.actor_user_id = t.user_id
                  order by x.at desc limit 1);
end;
$$;

-- The undo's first step; it consumes nothing. Refuses an unusable link (CMA05). Says whether the
-- request's change has applied (`applied`): before it has, nothing else is read, since the old
-- address is still the person's. After it has, and another sign-in user holds the old address, that
-- user is cleared out of the way only when all four of the owner's conditions hold (ruling Q10);
-- otherwise the undo is refused (CMA04):
--   1. it was created after the change was applied (the confirmation link's used_at);
--   2. it has no seat but the one handle_new_user gave it at sign-up;
--   3. it has no row in audits or sessions, and no account but the one handle_new_user gave it,
--      which holds nothing: personal, on Free, no Stripe customer, no other seat, no site;
--   4. it is not banned.
-- Why 2 and 3 read "but the one handle_new_user gave it": handle_new_user (001) gives every new
-- Auth user a personal account (users.default_account_id) and an active owner seat on it, in the
-- sign-up's own transaction, so a user with no seat and no account at all does not exist after a
-- sign-up (measured: __tests__/v2-027b-a-email.test.ts, "a sign-up has the seat and account").
-- The provisioned account is deleted here, its seat with it, and the user's id is returned as
-- `squatter` for the caller to delete from Auth (its profile goes with it, 20261109000003).
-- Returns {user_id, account_id, old_email, applied, squatter}.
create or replace function public.prepare_email_undo(p_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  t public.account_tokens%rowtype;
  v_applied_at timestamptz;
  v_holder auth.users%rowtype;
  v_provisioned uuid;
begin
  select * into t from public.account_tokens k
   where k.token_hash = p_hash and k.kind = 'email_change_undo'
     and k.issued_at is not null and k.used_at is null and k.revoked_at is null
     and k.expires_at > p_now;
  if not found then
    raise exception 'prepare_email_undo: the link cannot be used' using errcode = 'CMA05';
  end if;
  select c.used_at into v_applied_at from public.account_tokens c
   where c.account_id = t.account_id and c.kind = 'email_change' and c.created_at = t.created_at;
  if v_applied_at is null then
    return pg_catalog.jsonb_build_object(
      'user_id', t.user_id, 'account_id', t.account_id, 'old_email', t.old_email,
      'applied', false, 'squatter', null);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account_email:' || pg_catalog.lower(t.old_email), 0));
  select * into v_holder from auth.users u
   where pg_catalog.lower(u.email) = pg_catalog.lower(t.old_email) and u.id <> t.user_id
   order by u.created_at limit 1;
  if v_holder.id is null then
    if public.email_held_by_other(t.old_email, t.user_id) then
      raise exception 'prepare_email_undo: the old address is taken' using errcode = 'CMA04';
    end if;
    return pg_catalog.jsonb_build_object(
      'user_id', t.user_id, 'account_id', t.account_id, 'old_email', t.old_email,
      'applied', true, 'squatter', null);
  end if;

  select u.default_account_id into v_provisioned from public.users u where u.id = v_holder.id;
  if not (
    -- 1
    coalesce(v_holder.created_at > v_applied_at, false)
    -- 2
    and not exists (select 1 from public.seats s
                     where s.user_id = v_holder.id
                       and not (s.account_id is not distinct from v_provisioned
                                and s.role = 'owner' and s.status = 'active'))
    -- 3
    and not exists (select 1 from public.audits x where x.user_id = v_holder.id)
    and not exists (select 1 from public.sessions x where x.user_id = v_holder.id)
    and (v_provisioned is null or exists (
          select 1 from public.accounts a
           where a.id = v_provisioned and a.kind = 'personal' and a.state = 'free'
             and a.stripe_customer_id is null
             and not exists (select 1 from public.seats o
                              where o.account_id = a.id and o.user_id is distinct from v_holder.id)
             and not exists (select 1 from public.sites st where st.account_id = a.id)))
    -- 4
    and (v_holder.banned_until is null or v_holder.banned_until <= now())
  ) then
    -- The two user ids, for the caller's error report; no address.
    raise exception 'prepare_email_undo: the old address is taken' using errcode = 'CMA04',
      detail = pg_catalog.jsonb_build_object('user_id', t.user_id, 'holder', v_holder.id)::text;
  end if;
  delete from public.accounts a where a.id = v_provisioned;
  return pg_catalog.jsonb_build_object(
    'user_id', t.user_id, 'account_id', t.account_id, 'old_email', t.old_email,
    'applied', true, 'squatter', v_holder.id);
end;
$$;

-- The undo's last step: consumes the undo link. Before the change applied, it revokes the
-- confirmation link, so the change cannot apply, and touches no other row. After, the caller has set
-- Auth back to the old address, and the rows move back: the old address leaves previous_emails and
-- the one the change set is added to it, since it is part of the person's record for the erasure.
-- Either way an email_change_undone event is written. p_applied is what prepare_email_undo said; if
-- the change applied since, the caller has not set Auth back, so this refuses (CMA06) and the caller
-- starts the undo again. Returns {user_id, account_id, applied}.
create or replace function public.undo_email_change(p_hash text, p_now timestamptz, p_applied boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  t public.account_tokens%rowtype;
  c public.account_tokens%rowtype;
begin
  select * into t from public.account_tokens k
   where k.token_hash = p_hash and k.kind = 'email_change_undo'
     and k.issued_at is not null and k.used_at is null and k.revoked_at is null
     and k.expires_at > p_now
     for update;
  if not found then
    raise exception 'undo_email_change: the link cannot be used' using errcode = 'CMA05';
  end if;
  select * into c from public.account_tokens k
   where k.account_id = t.account_id and k.kind = 'email_change' and k.created_at = t.created_at
     for update;
  if (c.used_at is not null) <> p_applied then
    raise exception 'undo_email_change: the change applied after the undo was prepared' using errcode = 'CMA06';
  end if;

  if c.used_at is null then
    update public.account_tokens k set revoked_at = now() where k.id = c.id and k.revoked_at is null;
    update public.account_tokens k set used_at = p_now where k.id = t.id;
    insert into public.account_events (account_id, kind, actor_user_id)
    values (t.account_id, 'email_change_undone', t.user_id);
    return pg_catalog.jsonb_build_object('user_id', t.user_id, 'account_id', t.account_id, 'applied', false);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account_email:' || pg_catalog.lower(t.old_email), 0));
  if public.email_held_by_other(t.old_email, t.user_id) then
    raise exception 'undo_email_change: the old address is taken' using errcode = 'CMA04';
  end if;
  update public.account_tokens k set used_at = p_now where k.id = t.id;
  begin
    update public.users u
       set email = t.old_email,
           email_normalized = public.normalize_email(t.old_email),
           previous_emails = pg_catalog.array_append(
             pg_catalog.array_remove(pg_catalog.array_remove(u.previous_emails, t.old_email), t.new_email),
             t.new_email)
     where u.id = t.user_id;
  exception when unique_violation then
    raise exception 'undo_email_change: the old address is taken' using errcode = 'CMA04';
  end;
  update public.seats s set invited_email = t.old_email
   where s.user_id = t.user_id and pg_catalog.lower(s.invited_email) = pg_catalog.lower(t.new_email);
  insert into public.account_events (account_id, kind, actor_user_id)
  values (t.account_id, 'email_change_undone', t.user_id);
  return pg_catalog.jsonb_build_object('user_id', t.user_id, 'account_id', t.account_id, 'applied', true);
end;
$$;

revoke all on function public.normalize_email(text) from public, anon, authenticated;
revoke all on function public.email_held_by_other(text, uuid) from public, anon, authenticated;
revoke all on function public.request_email_change(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.apply_email_change(text, timestamptz) from public, anon, authenticated;
revoke all on function public.revert_email_change(uuid) from public, anon, authenticated;
revoke all on function public.prepare_email_undo(text, timestamptz) from public, anon, authenticated;
revoke all on function public.undo_email_change(text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.normalize_email(text) to service_role;
grant execute on function public.email_held_by_other(text, uuid) to service_role;
grant execute on function public.request_email_change(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.apply_email_change(text, timestamptz) to service_role;
grant execute on function public.revert_email_change(uuid) to service_role;
grant execute on function public.prepare_email_undo(text, timestamptz) to service_role;
grant execute on function public.undo_email_change(text, timestamptz, boolean) to service_role;

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: deletion, restore, purge and the erasure (D4, D5) ═════════════════════════════════════════

-- The erasure's rules, the in-app deletion's three steps and the purge's queue reads. Functions are
-- owned by postgres, revoked from every client role and granted to service_role (erase_rules,
-- erase_person_refusals, deletion_refusal and email_change_live to no role: only the functions here
-- call them). Tests: apps/web/__tests__/v2-027b-b-deletion.test.ts (the deletion, the queue and the
-- catalogue), apps/web/lib/v2/account/deletion-purge.test.ts (the purge over this SQL) and, for the
-- erasure's rules, scripts/ops/erase-account.test.ts.

-- ─── The erasure's rules (D5) ─────────────────────────────────────────────────────────────────────
-- One row per rule. `kind`: `with_user` and `with_accounts` are counted only (they go with the Auth
-- user's and the accounts' cascades), `change` rows are what erase_person_apply changes, in `ord`
-- order, and `kept` rows are counted to say what stays. `target` names the table as `x`, `pred` is
-- the rows, over $1 the user id (null when there is none), $2 the lower-cased addresses and $3 the
-- accounts the person alone holds; `action` is the SET list of an update, or null for a delete. The
-- count and the change of a rule are built from the same `pred`, so they cannot disagree.
-- `fix_email_requests deleted` comes before `accounts deleted`: its seat reference is set null when a
-- seat goes, after which a request cannot be traced to the person.
create or replace function public.erase_rules()
returns table (ord integer, kind text, key text, target text, action text, pred text)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select r.ord, r.kind, r.key, r.target, r.action, r.pred
    from (values
      (1, 'with_user', 'auth.users deleted', 'auth.users x', null, 'x.id = $1'),
      (2, 'with_user', 'users deleted', 'public.users x', null, 'x.id = $1'),
      (3, 'with_user', 'audits deleted', 'public.audits x', null, 'x.user_id = $1'),
      (4, 'with_user', 'sessions deleted', 'public.sessions x', null, 'x.user_id = $1'),
      (5, 'with_user', 'domain_verifications deleted', 'public.domain_verifications x', null,
       'x.user_id = $1'),
      (6, 'with_user', 'embed_badges deleted', 'public.embed_badges x', null, 'x.user_id = $1'),
      (7, 'with_user', 'seats deleted (own)', 'public.seats x', null, 'x.user_id = $1'),
      (8, 'with_user', 'public_reports.minted_by nulled', 'public.public_reports x', null,
       'x.minted_by = $1'),
      (9, 'with_user', 'share_links.created_by nulled', 'public.share_links x', null,
       'x.created_by = $1'),
      (10, 'with_user', 'api_keys.created_by nulled', 'public.api_keys x', null, 'x.created_by = $1'),
      -- Supabase Auth's audit log, where the project keeps one. An entry names the user by id and
      -- address in its JSON payload.
      (20, 'change', 'auth.audit_log_entries deleted', 'auth.audit_log_entries x', null,
       $p$($1 is not null and x.payload->>'actor_id' = $1::text)
          or ($1 is not null and x.payload->'traits'->>'user_id' = $1::text)
          or lower(x.payload->>'actor_username') = any($2)
          or lower(x.payload->'traits'->>'user_email') = any($2)$p$),
      -- Not the user's own audits, which go with the user; with no user, every audit holding it.
      (21, 'change', 'audits.notify_email nulled', 'public.audits x', 'notify_email = null',
       'lower(x.notify_email) = any($2) and ($1 is null or x.user_id is distinct from $1)'),
      -- Checks of sites outside the person's own accounts (theirs go with the accounts).
      (22, 'change', 'checks.notify_email nulled', 'public.checks x', 'notify_email = null',
       $p$lower(x.notify_email) = any($2)
          and not exists (select 1 from public.sites s where s.id = x.site_id and s.account_id = any($3))$p$),
      (23, 'change', 'email_events deleted', 'public.email_events x', null,
       'lower(x.email_address) = any($2)'),
      (24, 'change', 'waitlist deleted', 'public.waitlist x', null, 'lower(x.email) = any($2)'),
      -- The column is NOT NULL, so the address is replaced, not nulled.
      (25, 'change', 'takedown_requests redacted (closed)', 'public.takedown_requests x',
       $p$requester_email = 'redacted@erased.invalid'$p$,
       $p$lower(x.requester_email) = any($2) and x.status in ('removed', 'rejected')$p$),
      (26, 'change', 'rate_limits deleted', 'public.rate_limits x', null,
       $p$($1 is not null and right(x.bucket_key, 37) = ':' || $1::text)
          or exists (select 1 from unnest($2) e where right(x.bucket_key, length(e) + 1) = ':' || e)$p$),
      -- Another person's record of the address as one they used before (an email change).
      (27, 'change', 'users.previous_emails pruned', 'public.users x',
       'previous_emails = array(select e from unnest(x.previous_emails) e where lower(e) <> all($2))',
       $p$x.id is distinct from $1
          and exists (select 1 from unnest(x.previous_emails) e where lower(e) = any($2))$p$),
      (28, 'change', 'seats deleted (invitations in other accounts)', 'public.seats x', null,
       'lower(x.invited_email) = any($2) and x.user_id is null and not (x.account_id = any($3))'),
      (29, 'change', 'reports.recipient_email nulled', 'public.reports x', 'recipient_email = null',
       'lower(x.recipient_email) = any($2) and not (x.account_id = any($3))'),
      (30, 'change', 'sites.client_contact_email nulled', 'public.sites x',
       'client_contact_email = null',
       'lower(x.client_contact_email) = any($2) and not (x.account_id = any($3))'),
      (31, 'change', 'fix_email_requests deleted', 'public.fix_email_requests x', null,
       $p$(x.requested_by_seat_id in (select s.id from public.seats s where s.user_id = $1)
           or lower(x.to_email) = any($2))
          and not (x.account_id = any($3))$p$),
      (32, 'change', 'accounts deleted', 'public.accounts x', null, 'x.id = any($3)'),
      (40, 'with_accounts', 'sites deleted', 'public.sites x', null, 'x.account_id = any($3)'),
      (41, 'with_accounts', 'checks deleted', 'public.checks x', null,
       'exists (select 1 from public.sites s where s.id = x.site_id and s.account_id = any($3))'),
      (42, 'with_accounts', 'reports deleted', 'public.reports x', null, 'x.account_id = any($3)'),
      (50, 'kept', 'trial_ledger (peppered hashes; account reference set null)',
       'public.trial_ledger x', null, 'x.account_id = any($3)'),
      (51, 'kept', 'takedown_requests (open; the address stays until closed)',
       'public.takedown_requests x', null,
       $p$lower(x.requester_email) = any($2) and x.status not in ('removed', 'rejected')$p$)
    ) r(ord, kind, key, target, action, pred)
   where r.target <> 'auth.audit_log_entries x'
      or pg_catalog.to_regclass('auth.audit_log_entries') is not null
   order by r.ord;
$$;

-- The accounts the person alone is seated on (through an active seat): what an erasure deletes, and
-- what a deletion marks.
create or replace function public.erase_person_accounts(p_user uuid)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(array_agg(a.id order by a.id::text), '{}')
    from (select distinct s.account_id as id
            from public.seats s
           where s.user_id = p_user and s.status = 'active'
             and not exists (select 1 from public.seats o
                              where o.account_id = s.account_id and o.status = 'active'
                                and o.user_id is distinct from p_user)) a;
$$;

-- Why an erasure of the person cannot run yet, apart from the Storage objects (erase_person_plan
-- adds that one): `others_seated`, `v1_subscription` and `live_subscription`, each with the line the
-- dry run prints.
create or replace function public.erase_person_refusals(p_user uuid, p_accounts uuid[])
returns table (code text, message text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select c.code, c.message from (
    select 1 as o, s.account_id::text as k, 'others_seated' as code,
           'account ' || s.account_id::text || ': other people are seated on it; transfer ownership first' as message
      from (select distinct s.account_id from public.seats s
             where s.user_id = p_user and s.role = 'owner'
               and exists (select 1 from public.seats o
                            where o.account_id = s.account_id and o.status = 'active'
                              and o.user_id is distinct from p_user)) s
    union all
    select 2, '', 'v1_subscription',
           'users.pro_until is in the future; cancel the subscription in Stripe first'
      from public.users u where u.id = p_user and u.pro_until > now()
    union all
    select 3, sb.id, 'live_subscription', 'subscription ' || sb.id || ' is live; cancel it in Stripe first'
      from public.subscriptions sb
     where sb.account_id = any(p_accounts) and sb.status not in ('canceled', 'incomplete_expired')
  ) c
  order by c.o, c.k;
$$;

-- Every count an erasure reports, for a user id (or null), its addresses and its accounts:
-- {counts, kept, storage}. `counts` holds the `with_user` rules only when there is a user. `storage`
-- lists the objects to delete through the Storage API (SQL cannot), listed before any row that names
-- them is gone: those the person uploaded (storage.objects.owner), and those the accounts' rows name.
create or replace function public.erase_person_counts(p_user uuid, p_emails text[], p_accounts uuid[])
returns json
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r record;
  v_n bigint;
  v_keys text[] := '{}';
  v_vals bigint[] := '{}';
  v_kept_keys text[] := '{}';
  v_kept_vals bigint[] := '{}';
  v_storage json;
  v_emails text[] := coalesce(p_emails, '{}');
  v_accounts uuid[] := coalesce(p_accounts, '{}');
begin
  for r in select * from public.erase_rules() loop
    continue when r.kind = 'with_user' and p_user is null;
    execute format('select count(*) from %s where %s', r.target, r.pred)
      into v_n using p_user, v_emails, v_accounts;
    if r.kind = 'kept' then
      v_kept_keys := v_kept_keys || r.key;
      v_kept_vals := v_kept_vals || v_n;
    else
      v_keys := v_keys || r.key;
      v_vals := v_vals || v_n;
    end if;
  end loop;

  with paths(bucket, name) as (
    select 'report-logos', b.logo_path from public.agency_brands b
     where b.account_id = any(v_accounts) and b.logo_path is not null
    union all
    select 'reports', rp.storage_path from public.reports rp
     where rp.account_id = any(v_accounts) and rp.storage_path is not null
    union all
    select 'evidence', e.storage_path from public.evidence_blobs e
      join public.checks c on c.id = e.check_id join public.sites s on s.id = c.site_id
     where s.account_id = any(v_accounts)
    union all
    select 'evidence', c.map_path from public.checks c join public.sites s on s.id = c.site_id
     where s.account_id = any(v_accounts) and c.map_path is not null
    union all
    select 'evidence', cb.result_path from public.crawl_batches cb
      join public.checks c on c.id = cb.check_id join public.sites s on s.id = c.site_id
     where s.account_id = any(v_accounts) and cb.result_path is not null
  )
  select coalesce(json_agg(json_build_object('bucket', o.bucket_id, 'name', o.name)
                           order by o.bucket_id, o.name), '[]'::json)
    into v_storage
    from storage.objects o
   where o.owner = p_user or (o.bucket_id, o.name) in (select p.bucket, p.name from paths p);

  return json_build_object(
    'counts', (select json_object_agg(k, v order by i) from unnest(v_keys, v_vals) with ordinality t(k, v, i)),
    'kept', (select json_object_agg(k, v order by i) from unnest(v_kept_keys, v_kept_vals) with ordinality t(k, v, i)),
    'storage', v_storage);
end;
$$;

-- What an erasure would do. Changes nothing (a stable function: Postgres refuses a write in it).
-- Name the person by user id or by address, not both. An address that names more than one user, or
-- an id no user has, raises (unless a confirmed deletion queued that id: see below). Returns {userId,
-- emails, accounts, refusals, refusalCodes, counts, kept, storage, mintedReports}: the keys
-- scripts/ops/erase-account.ts prints, and each refusal's code. `emails` is the address given, the
-- user's current ones and users.previous_emails (less any another person now holds), lower-cased.
create or replace function public.erase_person_plan(p_user uuid, p_email text)
returns json
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_given text := nullif(lower(btrim(p_email)), '');
  v_ids uuid[];
  v_user uuid;
  v_emails text[];
  v_accounts uuid[] := '{}';
  v_refusals text[] := '{}';
  v_codes text[] := '{}';
  v_counts json;
  v_held bigint := 0;
  v_orphan boolean := false;
begin
  if (p_user is null) = (v_given is null) then
    raise exception 'erase_person_plan: name exactly one of a user id and an address' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct u.id), '{}') into v_ids
    from (select a.id from auth.users a where a.id = p_user or lower(a.email) = v_given
          union
          select pu.id from public.users pu where pu.id = p_user or lower(pu.email) = v_given) u;
  if cardinality(v_ids) > 1 then
    raise exception 'the address names % users; erase by user id', cardinality(v_ids) using errcode = '22023';
  end if;
  v_user := v_ids[1];
  -- An Auth user deleted outside the erasure (the dashboard) whose deletion was confirmed in the app:
  -- public.users and its seats are gone with it, the accounts it marked are not. The erasure goes on
  -- by the queue row: the user id, and the marked accounts that still exist with no active member.
  if p_user is not null and v_user is null
     and exists (select 1 from public.pending_erasures q where q.user_id = p_user) then
    v_user := p_user;
    v_orphan := true;
  elsif p_user is not null and v_user is null then
    raise exception 'no user has that id' using errcode = '22023';
  end if;

  select coalesce(array_agg(e order by first_at), '{}') into v_emails
    from (select e, min(i) as first_at
            from unnest(array[v_given]
                        || array(select lower(btrim(a.email)) from auth.users a where a.id = v_user)
                        || array(select lower(btrim(pu.email)) from public.users pu where pu.id = v_user)
                        || array(select lower(btrim(p.e)) from public.users pu, unnest(pu.previous_emails) p(e)
                                  where pu.id = v_user
                                    and not public.email_held_by_other(p.e, v_user))) with ordinality t(e, i)
           where e is not null and e <> ''
           group by e) s;

  if v_orphan then
    v_accounts := array(select a.id from public.pending_erasures q
                          join public.accounts a on a.id = any(q.accounts)
                         where q.user_id = p_user
                           and not exists (select 1 from public.seats s
                                            where s.account_id = a.id and s.status = 'active')
                         order by a.id::text);
  elsif v_user is not null then
    v_accounts := public.erase_person_accounts(v_user);
  end if;
  if v_user is not null then
    select coalesce(array_agg(f.message order by f.i), '{}'), coalesce(array_agg(f.code order by f.i), '{}')
      into v_refusals, v_codes
      from public.erase_person_refusals(v_user, v_accounts) with ordinality f(code, message, i);
  end if;
  -- A previous address that another person now signs in with is theirs: it is left out of the
  -- addresses, so nothing of theirs is erased, and counted under `kept`.
  if v_user is not null then
    select count(*) into v_held
      from public.users pu, unnest(pu.previous_emails) p(e)
     where pu.id = v_user and public.email_held_by_other(p.e, v_user);
  end if;
  v_counts := public.erase_person_counts(v_user, v_emails, v_accounts);
  if json_array_length(v_counts->'storage') > 0 then
    -- The rows that name them go with the erasure, after which nothing can list them.
    v_refusals := v_refusals || (json_array_length(v_counts->'storage')::text
      || ' storage objects are still stored; delete them through the Storage API first (docs/ops/erasure.md §4)');
    v_codes := v_codes || 'storage'::text;
  end if;

  return json_build_object(
    'userId', v_user,
    'emails', to_json(v_emails),
    'accounts', to_json(array(select a::text from unnest(v_accounts) a order by 1)),
    'refusals', to_json(v_refusals),
    -- Each refusal's code, in the same order (`storage` for the line above): what the sequence in
    -- lib/v2/account/erase.ts reads, so it never depends on where a line sits.
    'refusalCodes', to_json(v_codes),
    'counts', v_counts->'counts',
    'kept', case when v_user is null then v_counts->'kept'
                 else (select json_object_agg(k.key, k.value order by k.i)
                         from (select e.key, e.value, e.i
                                 from json_each(v_counts->'kept') with ordinality e(key, value, i)
                               union all
                               select 'previous address now held by another person', to_json(v_held), 1000) k)
            end,
    'storage', v_counts->'storage',
    'mintedReports', to_json(array(select r.slug from public.public_reports r
                                    where v_user is not null and r.minted_by = v_user order by r.slug)));
end;
$$;

-- Carries out an erasure, in the caller's transaction. Plans again inside itself and raises on any
-- refusal. Applies each `change` rule, counting the rows it changed, and raises unless that equals the
-- count its own plan read, so a row that changed in between, or a change that touches more than its
-- count, commits nothing. With p_require_due (the purge), the person's pending_erasures row is locked
-- first and must have reached purge_after, so a restore cannot run beside it (restore_account takes
-- the same lock). Returns {applied, drift}: the rows changed by key, and the keys whose count differs
-- from p_expected's (the plan the caller read before it removed Storage objects), for its report only.
-- The Auth user is not deleted here: the caller does that through the Auth admin API.
create or replace function public.erase_person_apply(
  p_user uuid, p_email text, p_expected jsonb, p_require_due boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r record;
  v_plan jsonb;
  v_user uuid;
  v_emails text[];
  v_accounts uuid[];
  v_n bigint;
  v_planned bigint;
  v_marked uuid[];
  v_applied jsonb := '{}';
begin
  if p_require_due then
    select q.accounts into v_marked from public.pending_erasures q
      where q.user_id = p_user and q.purge_after <= now() for update;
    if not found then
      raise exception 'erase_person_apply: no erasure of this person is due' using errcode = '55000';
    end if;
  end if;
  v_plan := public.erase_person_plan(p_user, p_email)::jsonb;
  if jsonb_array_length(v_plan->'refusals') > 0 then
    raise exception 'refusing to erase:%', (select string_agg(E'\n- ' || x, '' order by i)
      from jsonb_array_elements_text(v_plan->'refusals') with ordinality t(x, i)) using errcode = '55000';
  end if;
  v_user := (v_plan->>'userId')::uuid;
  v_emails := array(select jsonb_array_elements_text(v_plan->'emails'));
  v_accounts := array(select jsonb_array_elements_text(v_plan->'accounts')::uuid);
  -- The purge erases only what its confirm marked, checked here under the queue row's lock, so an
  -- account the person came to hold after the plan was read is not deleted with the others.
  if p_require_due and not (v_accounts <@ v_marked) then
    raise exception 'erase_person_apply: accounts_changed: the accounts to erase are not those the confirm marked'
      using errcode = '55000';
  end if;

  for r in select * from public.erase_rules() where kind = 'change' loop
    execute case when r.action is null
                 then format('with done as (delete from %s where %s returning 1) select count(*) from done',
                             r.target, r.pred)
                 else format('with done as (update %s set %s where %s returning 1) select count(*) from done',
                             r.target, r.action, r.pred) end
      into v_n using v_user, v_emails, v_accounts;
    v_planned := (v_plan->'counts'->>r.key)::bigint;
    if v_n is distinct from v_planned then
      raise exception '%: counted %, changed %; nothing was committed', r.key, v_planned, v_n
        using errcode = '40001';
    end if;
    v_applied := v_applied || jsonb_build_object(r.key, v_n);
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'drift', coalesce((select jsonb_object_agg(k.key, jsonb_build_object(
                         'expected', p_expected->'counts'->k.key, 'planned', v_plan->'counts'->k.key))
                         from jsonb_object_keys(v_plan->'counts') k(key)
                        where (p_expected->'counts'->k.key) is distinct from (v_plan->'counts'->k.key)),
                      '{}'));
end;
$$;

-- Supabase Auth may log the deletion of the user, naming the address, after erase_person_apply
-- cleared the log: the same rule, run again after the Auth delete. 0 where there is no audit log.
create or replace function public.erase_auth_audit_log(p_user uuid, p_emails text[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r record;
  v integer := 0;
begin
  for r in select * from public.erase_rules() where key = 'auth.audit_log_entries deleted' loop
    execute format('with done as (delete from %s where %s returning 1) select count(*) from done',
                   r.target, r.pred)
      into v using p_user, coalesce(p_emails, '{}'::text[]), '{}'::uuid[];
  end loop;
  return v;
end;
$$;

revoke all on function public.erase_rules() from public, anon, authenticated, service_role;
revoke all on function public.erase_person_accounts(uuid) from public, anon, authenticated;
revoke all on function public.erase_person_refusals(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.erase_person_counts(uuid, text[], uuid[]) from public, anon, authenticated;
revoke all on function public.erase_person_plan(uuid, text) from public, anon, authenticated;
revoke all on function public.erase_person_apply(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.erase_auth_audit_log(uuid, text[]) from public, anon, authenticated;
grant execute on function public.erase_person_accounts(uuid) to service_role;
grant execute on function public.erase_person_counts(uuid, text[], uuid[]) to service_role;
grant execute on function public.erase_person_plan(uuid, text) to service_role;
grant execute on function public.erase_person_apply(uuid, text, jsonb, boolean) to service_role;
grant execute on function public.erase_auth_audit_log(uuid, text[]) to service_role;

-- ─── The in-app deletion (D4) ─────────────────────────────────────────────────────────────────────
-- Request → confirm → seven days in which the restore link undoes the confirm → the purge erases.
-- What the person is told, and the routes, are lib/v2/account/deletion.ts's.

-- The subscriptions a confirmed deletion asked Stripe to end, one row each, and whether this deletion
-- set it to end (false when the person had already set it to, or Stripe cancelled it at once), so a
-- restore resumes only what the deletion stopped (plan-revision R5). A person alone on two accounts
-- may hold two subscriptions, one per account. No foreign key:
-- like pending_erasures, nothing the erasure deletes takes a row with it; finish_erasure and
-- restore_account delete them.
create table if not exists public.deletion_cancellations (
  subscription_id text primary key check (subscription_id ~ '^sub_'),
  user_id uuid not null,
  account_id uuid not null,
  we_set_cancel boolean not null,
  recorded_at timestamptz not null default now()
);
create index if not exists deletion_cancellations_user_idx on public.deletion_cancellations (user_id);
alter table public.deletion_cancellations enable row level security;
revoke all on public.deletion_cancellations from public, anon, authenticated;

-- The host the owner re-types to delete an account: its primary site's (the oldest site that is not
-- a staging copy and not removed), or, with no site, the sign-in address. Lower-cased.
create or replace function public.deletion_hostname(p_account uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select lower(coalesce(
    (select s.host from public.sites s
      where s.account_id = p_account and s.staging_of_site_id is null and s.removed_at is null
      order by s.created_at, s.id limit 1),
    (select u.email from public.users u where u.id = p_user)));
$$;

-- Why the person's deletion cannot be requested or confirmed: the erasure's refusals, apart from a live
-- subscription (the confirm ends it, and the purge ends any still live) and Storage objects (the purge
-- removes them), and an account that is not the person's alone. The first code, or null.
create or replace function public.deletion_refusal(p_account uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (select f.code from public.erase_person_refusals(p_user, public.erase_person_accounts(p_user)) f
      where f.code <> 'live_subscription' limit 1),
    case when p_account = any(public.erase_person_accounts(p_user)) then null else 'others_seated' end);
$$;

-- An email change in flight for the person, at p_now: a live confirmation link, or a live undo link
-- whose change has applied (its partner confirmation link, created in the same transaction, was
-- used). An undo link whose change was never confirmed and has expired is an abandoned request, and
-- holds nothing. The one definition: request_email_change (CMA02, section A) and the deletion's
-- request and confirm (a deletion waits for the change, so its undo stays possible, R6a) ask it.
create or replace function public.email_change_live(p_user uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.account_tokens k
     where k.user_id = p_user and k.used_at is null and k.revoked_at is null
       and k.expires_at > p_now
       and (k.kind = 'email_change'
            or (k.kind = 'email_change_undo' and exists (
                  select 1 from public.account_tokens c
                   where c.account_id = k.account_id and c.kind = 'email_change'
                     and c.created_at = k.created_at and c.used_at is not null))));
$$;

-- The owner asks to delete the account (deletes nothing). Refuses with {ok: false, code}:
-- `hostname_mismatch`, `email_change_pending`, `others_seated`, `v1_subscription`. Otherwise creates
-- the confirmation link's row (24 hours) and the restore link's row (the 24 hours plus the 7-day
-- window; restore_account also requires the window) paired with it, both with no token until the
-- mailer's issue_account_link on the confirmation row issues the two, revoking any earlier pair;
-- records `delete_requested`; and returns {ok: true, confirmTokenId, tier}. The route has checked
-- that p_user is the account's owner through the caller's own session; this checks it again under the
-- account's row lock.
create or replace function public.request_account_deletion(
  p_account uuid, p_user uuid, p_hostname text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_refusal text;
  v_recipient text;
  v_confirm uuid;
  v_restore uuid;
begin
  perform 1 from public.accounts a
    where a.id = p_account and a.deleted_at is null and a.deletion_confirmed_at is null for update;
  if not found or not exists (select 1 from public.seats s
                               where s.account_id = p_account and s.user_id = p_user
                                 and s.role = 'owner' and s.status = 'active') then
    raise exception 'request_account_deletion: not the owner of a live account' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_hostname, ''))) <> public.deletion_hostname(p_account, p_user) then
    return jsonb_build_object('ok', false, 'code', 'hostname_mismatch');
  end if;
  if public.email_change_live(p_user) then
    return jsonb_build_object('ok', false, 'code', 'email_change_pending');
  end if;
  v_refusal := public.deletion_refusal(p_account, p_user);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'code', v_refusal);
  end if;
  select u.email into v_recipient from public.users u where u.id = p_user;
  v_confirm := public.create_account_token(p_account, p_user, 'delete_confirm',
                                           now() + interval '24 hours', p_recipient => v_recipient);
  v_restore := public.create_account_token(p_account, p_user, 'delete_restore',
                                           now() + interval '8 days', p_paired_with => v_confirm,
                                           p_recipient => v_recipient);
  insert into public.account_events (account_id, kind, actor_user_id)
  values (p_account, 'delete_requested', p_user);
  return jsonb_build_object('ok', true, 'confirmTokenId', v_confirm,
                            'tier', (select a.tier from public.accounts a where a.id = p_account));
end;
$$;

-- What a deletion link's page shows, without using the link: {ok: false, code} with `invalid_link`
-- (no such token of that kind, or used, revoked or expired; or a restore link whose own request was
-- not the one confirmed), `not_confirmed` (a restore link before its
-- deletion was confirmed) or `window_closed` (a restore link after its window); otherwise {ok: true,
-- userId, accounts: [{id, host, subscription}], purgeAfter}: for a confirmation link, the accounts the confirm would mark,
-- and for a restore link, those its confirm marked (purgeAfter null for a confirmation link). `host` is
-- deletion_hostname's, so the sign-in address for an account with no site. `subscription` is the
-- status of the plan the account follows (its mirror row), or null: the page's money sentence.
create or replace function public.read_deletion_link(p_kind text, p_hash text, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v public.account_tokens%rowtype;
  v_accounts uuid[];
  v_purge timestamptz;
begin
  if p_kind not in ('delete_confirm', 'delete_restore') then
    raise exception 'read_deletion_link: not a deletion link kind' using errcode = '22023';
  end if;
  select * into v from public.account_tokens t
   where t.token_hash = p_hash and t.kind = p_kind and t.issued_at is not null;
  if not found or v.used_at is not null or v.revoked_at is not null or v.expires_at <= p_now then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  if p_kind = 'delete_confirm' then
    v_accounts := public.erase_person_accounts(v.user_id);
  else
    select q.accounts, q.purge_after into v_accounts, v_purge
      from public.pending_erasures q where q.user_id = v.user_id;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_confirmed'); end if;
    -- As restore_account: the link restores only the deletion it was sent with.
    if not exists (select 1 from public.account_tokens c
                    where c.id = v.paired_with and c.kind = 'delete_confirm' and c.used_at is not null) then
      return jsonb_build_object('ok', false, 'code', 'invalid_link');
    end if;
    if v_purge <= greatest(p_now, now()) then
      return jsonb_build_object('ok', false, 'code', 'window_closed');
    end if;
  end if;
  return jsonb_build_object(
    'ok', true,
    'userId', v.user_id,
    'purgeAfter', v_purge,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', a.id, 'host', public.deletion_hostname(a.id, v.user_id),
                                   'subscription', (select sb.status from public.accounts ac
                                                      join public.subscriptions sb
                                                        on sb.id = ac.current_subscription_id
                                                     where ac.id = a.id))
                                 order by a.id::text)
                            from unnest(v_accounts) a(id)), '[]'));
end;
$$;

-- The confirmation link's POST, in one transaction (plan-revision R4): consumes the token (an issued
-- one, by hash and kind); refuses as request_account_deletion does, and while an email change is in
-- flight (its "this wasn't me" link must stay usable), leaving the token usable so the person can
-- press again once that is resolved; marks every account the person alone holds, queues the person in
-- pending_erasures with the window's end, ends every session, and records `delete_confirmed` on each
-- account. Returns {ok: true, userId, accountId, tier, accounts, purgeAfter} (accountId and tier: the
-- account the link was issued for) or {ok: false, code} (`invalid_link`, `already_confirmed`,
-- `email_change_pending`, `others_seated`, `v1_subscription`). Signing-in is stopped by the caller's Auth ban; the
-- subscription is ended by deletionCancelFn.
create or replace function public.confirm_account_deletion(p_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v public.account_tokens%rowtype;
  v_refusal text;
  v_accounts uuid[];
  v_purge timestamptz := p_now + interval '7 days';
begin
  select * into v from public.account_tokens t
   where t.token_hash = p_hash and t.kind = 'delete_confirm' and t.issued_at is not null for update;
  if not found or v.used_at is not null or v.revoked_at is not null or v.expires_at <= p_now then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  -- One confirm per person at a time: two links (one per account the person holds) posted at once
  -- would each pass the check below before either inserted the queue row. The lock is the
  -- transaction's, so the second waits and then reads the first's row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account-deletion:' || v.user_id::text, 0));
  v_refusal := case
    -- A link from another account the person holds, after the first confirm marked them all.
    when exists (select 1 from public.pending_erasures q where q.user_id = v.user_id)
      then 'already_confirmed'
    when public.email_change_live(v.user_id, p_now) then 'email_change_pending'
    else public.deletion_refusal(v.account_id, v.user_id) end;
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'code', v_refusal);
  end if;
  v_accounts := public.erase_person_accounts(v.user_id);

  update public.account_tokens t set used_at = p_now where t.id = v.id;
  update public.accounts a set deletion_confirmed_at = p_now, purge_after = v_purge
   where a.id = any(v_accounts);
  insert into public.pending_erasures (user_id, accounts, confirmed_at, purge_after)
  values (v.user_id, v_accounts, p_now, v_purge);
  perform public.end_user_sessions(v.user_id);
  insert into public.account_events (account_id, kind, actor_user_id)
  select a, 'delete_confirmed', v.user_id from unnest(v_accounts) a;
  return jsonb_build_object('ok', true, 'userId', v.user_id, 'accountId', v.account_id,
                            'tier', (select a.tier from public.accounts a where a.id = v.account_id),
                            'accounts', to_jsonb(v_accounts), 'purgeAfter', v_purge);
end;
$$;

-- The restore link's POST, in one transaction (its paired confirmation link must be the one used, and
-- the person's other unused confirmation links are revoked): consumes the token (an issued one, by hash and kind) only while the person's
-- pending_erasures row, locked as erase_person_apply locks it, is inside its window; clears the
-- accounts' marks and the queue row, records `delete_restored`, and returns {ok: true, userId,
-- accountId, tier, accounts, resume}: `resume` names the subscriptions this deletion set to end, which the caller asks
-- Stripe to continue. Otherwise {ok: false, code} as read_deletion_link, and nothing changes.
create or replace function public.restore_account(p_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v public.account_tokens%rowtype;
  q public.pending_erasures%rowtype;
  v_resume text[];
begin
  select * into v from public.account_tokens t
   where t.token_hash = p_hash and t.kind = 'delete_restore' and t.issued_at is not null for update;
  if not found or v.used_at is not null or v.revoked_at is not null or v.expires_at <= p_now then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  select * into q from public.pending_erasures e where e.user_id = v.user_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_confirmed'); end if;
  -- The link restores only the deletion it was sent with: its paired confirmation link must be the
  -- one that was used. A restore link from a request never confirmed (another account's link
  -- confirmed the erasure) is not one.
  if not exists (select 1 from public.account_tokens c
                  where c.id = v.paired_with and c.kind = 'delete_confirm' and c.used_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  if q.purge_after <= greatest(p_now, now()) then
    return jsonb_build_object('ok', false, 'code', 'window_closed');
  end if;

  update public.account_tokens t set used_at = p_now where t.id = v.id;
  -- The person's other confirmation links (one per account they hold) stop working: a restore ends
  -- this deletion, and a new one starts from a new request.
  update public.account_tokens t set revoked_at = p_now
   where t.user_id = v.user_id and t.kind = 'delete_confirm'
     and t.used_at is null and t.revoked_at is null;
  update public.accounts a set deletion_confirmed_at = null, purge_after = null
   where a.id = any(q.accounts);
  delete from public.pending_erasures e where e.user_id = q.user_id;
  with gone as (delete from public.deletion_cancellations c where c.user_id = q.user_id returning c.*)
  select coalesce(array_agg(g.subscription_id order by g.subscription_id), '{}') into v_resume
    from gone g where g.we_set_cancel;
  insert into public.account_events (account_id, kind, actor_user_id)
  select a.id, 'delete_restored', q.user_id from public.accounts a where a.id = any(q.accounts);
  return jsonb_build_object('ok', true, 'userId', q.user_id, 'accountId', v.account_id,
                            'tier', (select a.tier from public.accounts a where a.id = v.account_id),
                            'accounts', to_jsonb(q.accounts), 'resume', to_jsonb(v_resume));
end;
$$;

-- deletionCancelFn's record of a subscription it is about to end, under the queue row's lock. False,
-- recording nothing, when the person is no longer waiting for erasure with that account (a restore came
-- first), so a late run does not cancel a restored plan.
create or replace function public.record_deletion_cancel(
  p_user uuid, p_account uuid, p_subscription text, p_we_set_cancel boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform 1 from public.pending_erasures q
    where q.user_id = p_user and p_account = any(q.accounts) for update;
  if not found then return false; end if;
  insert into public.deletion_cancellations (subscription_id, user_id, account_id, we_set_cancel)
  values (p_subscription, p_user, p_account, p_we_set_cancel)
  on conflict (subscription_id) do nothing;
  return true;
end;
$$;

-- Whether the person is waiting for erasure. The confirm reads it before its Auth ban and again
-- after it, lifting the ban when the row is gone (banAfterConfirm, lib/v2/account/deletion.ts); a
-- committed restore lifts the ban without reading it.
create or replace function public.erasure_pending(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (select 1 from public.pending_erasures q where q.user_id = p_user);
$$;

-- Where the person's deletion stands: `pending` (queued), `erased` (the purge removed them: no
-- public.users row, which cascades from auth.users), `restored` otherwise. What a restore whose answer
-- was lost asks, to tell a committed restore from one that did not happen or a finished purge.
create or replace function public.erasure_state(p_user uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when exists (select 1 from public.pending_erasures q where q.user_id = p_user) then 'pending'
    when not exists (select 1 from public.users u where u.id = p_user) then 'erased'
    else 'restored'
  end;
$$;

-- The purge's work: the people whose window has ended by p_now and by the database's clock; those
-- not yet attempted first, then the least recently attempted, so people a refusal keeps in the queue
-- cannot hold the others back. A restore refuses once either clock has passed the window's end
-- (restore_account), and a person is due only once both have, so a restore cannot succeed for someone
-- the purge has started on (it removes Storage objects before its apply takes the queue row's lock).
create or replace function public.due_erasures(p_now timestamptz, p_limit integer)
returns table (user_id uuid, accounts uuid[], purge_after timestamptz, attempts integer)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select q.user_id, q.accounts, q.purge_after, q.attempts from public.pending_erasures q
   where q.purge_after <= least(p_now, now())
   order by q.last_attempt_at nulls first, q.purge_after, q.user_id
   limit greatest(p_limit, 0);
$$;

-- A purge attempt that did not finish: counted, for the report and the next run.
create or replace function public.record_erasure_attempt(p_user uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  update public.pending_erasures q set attempts = q.attempts + 1, last_attempt_at = now()
   where q.user_id = p_user;
$$;

-- The purge's last step: the queue row and the person's cancellation records go, once the Auth user and
-- the accounts the confirm marked are gone. Raises while either is still there, so the row cannot go
-- before the erasure is complete (R1).
create or replace function public.finish_erasure(p_user uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'finish_erasure: the Auth user is still there' using errcode = '55000';
  end if;
  if exists (select 1 from public.pending_erasures q join public.accounts a on a.id = any(q.accounts)
              where q.user_id = p_user) then
    raise exception 'finish_erasure: an account it marked is still there' using errcode = '55000';
  end if;
  delete from public.deletion_cancellations c where c.user_id = p_user;
  delete from public.pending_erasures q where q.user_id = p_user;
end;
$$;

revoke all on function public.deletion_hostname(uuid, uuid) from public, anon, authenticated;
revoke all on function public.deletion_refusal(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_change_live(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.request_account_deletion(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.read_deletion_link(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_account_deletion(text, timestamptz) from public, anon, authenticated;
revoke all on function public.restore_account(text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_deletion_cancel(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.erasure_pending(uuid) from public, anon, authenticated;
revoke all on function public.erasure_state(uuid) from public, anon, authenticated;
revoke all on function public.due_erasures(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.record_erasure_attempt(uuid) from public, anon, authenticated;
revoke all on function public.finish_erasure(uuid) from public, anon, authenticated;
grant execute on function public.deletion_hostname(uuid, uuid) to service_role;
grant execute on function public.request_account_deletion(uuid, uuid, text)
  to service_role;
grant execute on function public.read_deletion_link(text, text, timestamptz) to service_role;
grant execute on function public.confirm_account_deletion(text, timestamptz) to service_role;
grant execute on function public.restore_account(text, timestamptz) to service_role;
grant execute on function public.record_deletion_cancel(uuid, uuid, text, boolean) to service_role;
grant execute on function public.erasure_pending(uuid) to service_role;
grant execute on function public.erasure_state(uuid) to service_role;
grant execute on function public.due_erasures(timestamptz, integer) to service_role;
grant execute on function public.record_erasure_attempt(uuid) to service_role;
grant execute on function public.finish_erasure(uuid) to service_role;

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: the account's Slack destination (D7) ══════════════════════════════════════════════════════

-- The account's Slack incoming-webhook URL (D7). The URL is a Vault secret named
-- `slack_webhook:<account id>`; this table holds that secret's id and the URL's last four characters,
-- which the settings page shows. No client role and not service_role holds a privilege on the table:
-- the three functions below are the way in, and none of them returns the URL (decrypting it to send
-- an alert is CC-28's). The row goes with its account; its trigger takes the secret with it.
create table if not exists public.account_slack_destinations (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  vault_secret_id uuid not null,
  last4 text not null check (length(last4) = 4),
  updated_at timestamptz not null default now()
);
alter table public.account_slack_destinations enable row level security;
revoke all on public.account_slack_destinations from public, anon, authenticated, service_role;

-- Stores or replaces the account's URL and returns its last four characters. A replace updates the
-- one secret in place, so an account never holds two. The URL is held to Slack's incoming-webhook
-- form, as the route holds it, and Slack is refused on a Free account: the tier is read as
-- alert_rules_entitlement_check (003) reads it, the account row locked so two writes for one account
-- run one after the other.
create or replace function public.set_account_slack_webhook(p_account uuid, p_url text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_name text := 'slack_webhook:' || p_account::text;
  v_tier text;
  v_secret uuid;
begin
  if p_url is null or length(p_url) > 500
     or p_url !~ '^https://hooks\.slack\.com/services/[A-Za-z0-9_/-]+$' then
    raise exception 'set_account_slack_webhook: not a Slack incoming-webhook URL' using errcode = '22023';
  end if;
  select case
           when a.state = 'pro_trial' and a.trial_variant = 'no_card'
             then case when now() < a.trial_ends_at then a.tier else 'free' end
           when a.state = 'past_due'
             then case when now() < a.past_due_since + interval '168 hours' then a.past_due_tier else 'free' end
           else a.tier
         end
    into v_tier
    from public.accounts a
   where a.id = p_account and a.deleted_at is null and a.deletion_confirmed_at is null
     for update;
  if not found then
    raise exception 'set_account_slack_webhook: no account %', p_account using errcode = 'P0002';
  end if;
  if v_tier is null or v_tier not in ('pro', 'agency') then
    raise exception 'set_account_slack_webhook: Slack alerts need a paid plan' using errcode = '23514';
  end if;

  select d.vault_secret_id into v_secret
    from public.account_slack_destinations d where d.account_id = p_account;
  if v_secret is null then
    -- A secret of this name with no row (a row deleted without its trigger) is reused, not duplicated.
    select s.id into v_secret from vault.secrets s where s.name = v_name;
  end if;
  if v_secret is null then
    v_secret := vault.create_secret(p_url, v_name, '');
  else
    perform vault.update_secret(v_secret, p_url);
  end if;
  insert into public.account_slack_destinations as d (account_id, vault_secret_id, last4, updated_at)
  values (p_account, v_secret, right(p_url, 4), now())
  on conflict (account_id) do update
    set vault_secret_id = excluded.vault_secret_id, last4 = excluded.last4, updated_at = excluded.updated_at;
  return right(p_url, 4);
end;
$$;

-- Removes the account's URL; true when there was one. The trigger removes the secret.
create or replace function public.clear_account_slack_webhook(p_account uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  delete from public.account_slack_destinations d where d.account_id = p_account;
  return found;
end;
$$;

-- What the settings page shows: the URL's last four characters, or null when none is set.
create or replace function public.account_slack_last4(p_account uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select d.last4 from public.account_slack_destinations d where d.account_id = p_account;
$$;

-- A destination row that goes (a clear, or its account's cascade at the purge) takes its secret with
-- it. Definer, because a cascaded delete fires the trigger as the role that deleted the account.
create or replace function public.account_slack_destinations_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  delete from vault.secrets s where s.id = old.vault_secret_id;
  return old;
end;
$$;
drop trigger if exists account_slack_destinations_drop_secret on public.account_slack_destinations;
create trigger account_slack_destinations_drop_secret after delete on public.account_slack_destinations
  for each row execute function public.account_slack_destinations_drop_secret();

revoke all on function public.set_account_slack_webhook(uuid, text) from public, anon, authenticated;
revoke all on function public.clear_account_slack_webhook(uuid) from public, anon, authenticated;
revoke all on function public.account_slack_last4(uuid) from public, anon, authenticated;
revoke all on function public.account_slack_destinations_drop_secret()
  from public, anon, authenticated, service_role;
grant execute on function public.set_account_slack_webhook(uuid, text) to service_role;
grant execute on function public.clear_account_slack_webhook(uuid) to service_role;
grant execute on function public.account_slack_last4(uuid) to service_role;


-- What the delete step shows in place of a form its request would refuse (CC-27b review, item 6):
-- the code request_account_deletion answers past the hostname check, in its order, or null. It reads
-- section B's email_change_live and deletion_refusal, so the page and the request cannot disagree.
-- Answers nothing about the hostname: the page asks for it.
create or replace function public.account_deletion_blocked(p_account uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case when public.email_change_live(p_user) then 'email_change_pending'
              else public.deletion_refusal(p_account, p_user) end;
$$;
revoke all on function public.account_deletion_blocked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blocked(uuid, uuid) to service_role;

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
