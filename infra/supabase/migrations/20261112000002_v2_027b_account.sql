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
  constraint account_tokens_pair check (paired_with is null or kind = 'delete_restore')
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

-- One live link of each email kind per account. A request creates the confirmation link and the old
-- address's undo link together, so the two kinds live side by side; request_email_change refuses a
-- second change while either of the first one's links is live (CMA02), and this index is what holds
-- when two requests race past that check.
drop index if exists public.account_tokens_one_email_change_uq;
create unique index if not exists account_tokens_one_live_email_link_uq
  on public.account_tokens (account_id, kind)
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
  -- The subscription the confirm asked Stripe to end, and whether this confirm set it to end (false
  -- when it was already set to, so a restore leaves the person's own cancellation alone).
  subscription_id text check (subscription_id ~ '^sub_'),
  we_set_cancel boolean not null default false,
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
  p_new_email text default null, p_old_email text default null, p_paired_with uuid default null)
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
  insert into public.account_tokens (account_id, user_id, kind, new_email, old_email, expires_at, paired_with)
  values (p_account, p_user, p_kind, p_new_email, p_old_email, p_expires_at, p_paired_with)
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
-- the shape apps/web/lib/v2/account/tokens.ts `isToken` accepts. The recipient is the new address
-- for an email_change, the old one for its undo, and the sign-in address otherwise.
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
                   else (select u.email from public.users u where u.id = v.user_id)
                 end;
    return next;
  end loop;
end;
$$;

revoke all on function public.create_account_token(uuid, uuid, text, timestamptz, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.issue_account_link(uuid) from public, anon, authenticated;
grant execute on function public.create_account_token(uuid, uuid, text, timestamptz, text, text, uuid)
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
-- One change is in flight per account: a request is refused (CMA02) while the account has a live
-- confirmation link, or a live undo link whose change has applied; an undo link whose change was
-- never confirmed and has expired does not hold the account. account_tokens_one_live_email_link_uq
-- holds when two requests race. Both links are rows with no token until the mailer issues them
-- (issue_account_link, owner ruling Q5); a function here accepts a token only for a row that was
-- issued (`issued_at is not null`), so a row the mailer never issued, whose token_hash is null,
-- cannot be consumed.
--
-- Refusals, by SQLSTATE; lib/v2/account/email-change.ts answers each:
--   CMA01  the new address is the person's current one
--   CMA02  an email change is in flight for the account
--   CMA03  the account is marked for deletion
--   CMA04  another sign-in user or profile holds the address
--   CMA05  the link's token is unknown, of another kind, used, revoked or expired, or its change
--          was stopped
--   CMA06  the undo was prepared for a change that was pending, and the change applied in between

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
  if exists (
       select 1 from public.account_tokens k
        where k.account_id = p_account and k.used_at is null and k.revoked_at is null
          and k.expires_at > p_now
          and (k.kind = 'email_change'
               or (k.kind = 'email_change_undo' and exists (
                     select 1 from public.account_tokens c
                      where c.account_id = k.account_id and c.kind = 'email_change'
                        and c.created_at = k.created_at and c.used_at is not null)))) then
    raise exception 'request_email_change: an email change is in flight' using errcode = 'CMA02';
  end if;
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

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: the account's Slack destination (D7) ══════════════════════════════════════════════════════

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
