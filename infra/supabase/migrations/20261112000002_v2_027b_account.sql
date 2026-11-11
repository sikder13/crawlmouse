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

-- A link we email: only its sha256 is stored. `link_secret_id` names the Vault secret that holds the
-- raw token until the mailer takes it (take_account_link); it is null once taken or expired.
create table if not exists public.account_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('email_change', 'email_change_undo', 'delete_confirm', 'delete_restore')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- email_change and email_change_undo only: the address moved to and the one moved from.
  new_email text,
  old_email text,
  link_secret_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  -- A token another action ended before it was used (an undo, a newer request, a restore).
  revoked_at timestamptz,
  constraint account_tokens_emails check (
    (kind in ('email_change', 'email_change_undo')) = (new_email is not null and old_email is not null)),
  constraint account_tokens_expiry check (expires_at > created_at)
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

-- ═══ A: email change (D3) ═════════════════════════════════════════════════════════════════════════

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: deletion, restore, purge and the erasure (D4, D5) ═════════════════════════════════════════

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: the account's Slack destination (D7) ══════════════════════════════════════════════════════

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
