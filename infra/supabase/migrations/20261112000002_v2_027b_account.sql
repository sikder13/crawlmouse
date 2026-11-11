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

-- Issues a link: the token row with its hash, and the raw token in a Vault secret until the mailer
-- takes it. The secret's name carries the token row's id only. A token of the same kind for the same
-- account that is still live is revoked first, so a second request ends the first link (email
-- changes are also held to one in flight by account_tokens_one_email_change_uq).
create or replace function public.issue_account_token(
  p_account uuid, p_user uuid, p_kind text, p_hash text, p_raw text, p_expires_at timestamptz,
  p_new_email text default null, p_old_email text default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_raw is null or p_raw !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'issue_account_token: the raw token is not one newToken() makes' using errcode = '22023';
  end if;
  update public.account_tokens t set revoked_at = now()
   where t.account_id = p_account and t.kind = p_kind and t.used_at is null and t.revoked_at is null;
  insert into public.account_tokens (account_id, user_id, kind, token_hash, new_email, old_email, expires_at)
  values (p_account, p_user, p_kind, p_hash, p_new_email, p_old_email, p_expires_at)
  returning id into v_id;
  update public.account_tokens t
     set link_secret_id = vault.create_secret(p_raw, 'account_link:' || v_id::text, '')
   where t.id = v_id;
  return v_id;
end;
$$;

-- The mailer's one read of a link (CC-28): the raw token and where it goes, after which the secret is
-- gone. Null when the token is used, revoked, expired or already taken. The recipient is the new
-- address for an email_change, the old one for its undo, and the sign-in address otherwise.
create or replace function public.take_account_link(p_token uuid)
returns table (kind text, token text, recipient text)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v public.account_tokens%rowtype;
begin
  select * into v from public.account_tokens t where t.id = p_token for update;
  if not found or v.link_secret_id is null then return; end if;
  if v.used_at is not null or v.revoked_at is not null or v.expires_at <= now() then
    delete from vault.secrets s where s.id = v.link_secret_id;
    update public.account_tokens t set link_secret_id = null where t.id = v.id;
    return;
  end if;
  kind := v.kind;
  select d.decrypted_secret into token from vault.decrypted_secrets d where d.id = v.link_secret_id;
  recipient := case v.kind
                 when 'email_change' then v.new_email
                 when 'email_change_undo' then v.old_email
                 else (select u.email from public.users u where u.id = v.user_id)
               end;
  delete from vault.secrets s where s.id = v.link_secret_id;
  update public.account_tokens t set link_secret_id = null where t.id = v.id;
  return next;
end;
$$;

-- A token row that goes (its account's cascade, or the sweep) takes its unsent secret with it. Definer,
-- because a cascaded delete fires the trigger as the role that deleted the account.
create or replace function public.account_tokens_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.link_secret_id is not null then
    delete from vault.secrets s where s.id = old.link_secret_id;
  end if;
  return old;
end;
$$;
drop trigger if exists account_tokens_drop_secret on public.account_tokens;
create trigger account_tokens_drop_secret after delete on public.account_tokens
  for each row execute function public.account_tokens_drop_secret();

-- Removes the secrets of links that can no longer be used and were never taken. Run by the daily purge.
create or replace function public.sweep_account_links()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v integer;
begin
  with stale as (
    select t.id, t.link_secret_id from public.account_tokens t
     where t.link_secret_id is not null
       and (t.used_at is not null or t.revoked_at is not null or t.expires_at <= now())
       for update
  ), dropped as (
    delete from vault.secrets s using stale where s.id = stale.link_secret_id returning s.id
  ), cleared as (
    update public.account_tokens t set link_secret_id = null from stale where t.id = stale.id returning t.id
  )
  -- A data-modifying CTE runs whether or not the outer query reads it, so `dropped` always runs.
  select count(*) into v from cleared;
  return v;
end;
$$;

revoke all on function public.issue_account_token(uuid, uuid, text, text, text, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.take_account_link(uuid) from public, anon, authenticated;
revoke all on function public.account_tokens_drop_secret() from public, anon, authenticated;
revoke all on function public.sweep_account_links() from public, anon, authenticated;
grant execute on function public.issue_account_token(uuid, uuid, text, text, text, timestamptz, text, text)
  to service_role;
grant execute on function public.take_account_link(uuid) to service_role;
grant execute on function public.sweep_account_links() to service_role;

-- ═══ A: email change (D3) ═════════════════════════════════════════════════════════════════════════

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: deletion, restore, purge and the erasure (D4, D5) ═════════════════════════════════════════

-- The erasure's rules, the in-app deletion's three steps and the purge's queue reads. Functions are
-- owned by postgres, revoked from every client role and granted to service_role (erase_rules and
-- erase_person_refusals to no role: only the functions below call them). Tests:
-- apps/web/__tests__/v2-027b-b-erasure.test.ts, apps/web/__tests__/v2-027b-b-deletion.test.ts and,
-- for the rules carried over from the script, scripts/ops/erase-account.test.ts.

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
-- an id no user has, raises. Returns {userId, emails, accounts, refusals, counts, kept, storage,
-- mintedReports}, the keys scripts/ops/erase-account.ts prints. `emails` is the address given, the
-- user's current ones and users.previous_emails, lower-cased.
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
  v_counts json;
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
  if p_user is not null and v_user is null then
    raise exception 'no user has that id' using errcode = '22023';
  end if;

  select coalesce(array_agg(e order by first_at), '{}') into v_emails
    from (select e, min(i) as first_at
            from unnest(array[v_given]
                        || array(select lower(btrim(a.email)) from auth.users a where a.id = v_user)
                        || array(select lower(btrim(pu.email)) from public.users pu where pu.id = v_user)
                        || array(select lower(btrim(p.e)) from public.users pu, unnest(pu.previous_emails) p(e)
                                  where pu.id = v_user)) with ordinality t(e, i)
           where e is not null and e <> ''
           group by e) s;

  if v_user is not null then
    v_accounts := public.erase_person_accounts(v_user);
    v_refusals := array(select f.message from public.erase_person_refusals(v_user, v_accounts) f);
  end if;
  v_counts := public.erase_person_counts(v_user, v_emails, v_accounts);
  if json_array_length(v_counts->'storage') > 0 then
    -- The rows that name them go with the erasure, after which nothing can list them.
    v_refusals := v_refusals || (json_array_length(v_counts->'storage')::text
      || ' storage objects are still stored; delete them through the Storage API first (docs/ops/erasure.md §4)');
  end if;

  return json_build_object(
    'userId', v_user,
    'emails', to_json(v_emails),
    'accounts', to_json(array(select a::text from unnest(v_accounts) a order by 1)),
    'refusals', to_json(v_refusals),
    'counts', v_counts->'counts',
    'kept', v_counts->'kept',
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
  v_applied jsonb := '{}';
begin
  if p_require_due then
    perform 1 from public.pending_erasures q
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

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: the account's Slack destination (D7) ══════════════════════════════════════════════════════

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════
