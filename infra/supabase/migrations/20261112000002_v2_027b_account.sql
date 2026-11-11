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

-- Only one email change in flight per account: an unused, unrevoked confirmation or undo token blocks
-- a second request. An index, not a read-then-insert check, so two concurrent requests cannot both pass.
create unique index if not exists account_tokens_one_email_change_uq on public.account_tokens (account_id)
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
-- for the same account is revoked first, so a second request ends the first link (email changes are
-- also held to one in flight by account_tokens_one_email_change_uq).
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

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: deletion, restore, purge and the erasure (D4, D5) ═════════════════════════════════════════

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


-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
