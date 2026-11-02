-- v2 migration 001 (ARCH-2 §6.1): the entitlement tables.
--
-- Additive only. It creates accounts, subscriptions, seats, agency_brands and trial_ledger; adds
-- users.email_normalized and users.default_account_id; creates is_member(), member_role(),
-- apply_entitlement_transition() and assert_entitlement_version(); and extends handle_new_user so
-- a sign-up also gets a personal Free account and its owner seat. No existing table, column, policy
-- or grant is changed, dropped or renamed, and v1 reads none of the new objects.
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261101000001_v2_001_entitlement_tables.revert.sql.
--
-- Grants are written out per table, because production's default privileges give anon and
-- authenticated full DML on every new table and EXECUTE on every new function (see the platform shim
-- in apps/web/__tests__/helpers/pglite-migrations.ts). Postures are asserted from the catalog by
-- apps/web/__tests__/v2-001-entitlement-tables.test.ts.

-- ─── accounts ─────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('personal', 'agency')),
  name text,
  state text not null check (state in ('free', 'pro_trial', 'pro', 'agency_trial', 'agency', 'past_due')),
  tier text not null default 'free' check (tier in ('free', 'pro', 'agency')),
  past_due_tier text check (past_due_tier in ('pro', 'agency')),
  past_due_since timestamptz,
  trial_variant text check (trial_variant in ('no_card', 'card_required')),
  disputed_at timestamptz,
  trial_ends_at timestamptz,
  trial_used_at timestamptz,
  stripe_customer_id text unique,
  timezone text not null default 'UTC',
  seat_limit integer not null check (seat_limit >= 1),
  site_limit integer not null check (site_limit between 1 and 50),
  competitor_limit integer not null default 0 check (competitor_limit >= 0),
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  email_change_notes boolean not null default true,
  email_trial_reminder boolean not null default true,
  -- The contract's Account.state_history: oldest first, the last entry is `state`. Bounded to the
  -- most recent 200 entries; apply_entitlement_transition drops the oldest beyond that.
  state_history jsonb not null,
  -- Incremented by every apply_entitlement_transition; the caller passes the version it read.
  entitlement_version integer not null default 0,
  -- The Stripe subscription the entitlement follows (apps/web/lib/billing/state-machine.ts).
  current_subscription_id text check (current_subscription_id ~ '^sub_'),
  -- When the entitlement last changed; a grant stamped earlier is refused as stale.
  entitlement_changed_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint accounts_tier_matches_state check (coalesce(
    case state
      when 'free' then tier = 'free'
      when 'pro_trial' then tier = 'pro'
      when 'pro' then tier = 'pro'
      when 'agency_trial' then tier = 'agency'
      when 'agency' then tier = 'agency'
      when 'past_due' then tier = past_due_tier
    end, false)),
  constraint accounts_trial_ends check ((state in ('pro_trial', 'agency_trial')) = (trial_ends_at is not null)),
  constraint accounts_trial_fields check (
    (state <> 'pro_trial' or trial_variant is not null)
    and (state not in ('pro_trial', 'agency_trial') or trial_used_at is not null)),
  constraint accounts_past_due check (
    (state = 'past_due') = (past_due_tier is not null)
    and (state = 'past_due') = (past_due_since is not null)),
  -- A paid state and a card trial follow a subscription; a no-card trial follows none. A Pro trial
  -- without a variant is accounts_trial_fields' to reject.
  constraint accounts_subscription check (
    case
      when state = 'free' then true
      when state = 'pro_trial' then (trial_variant <> 'no_card') = (current_subscription_id is not null)
      else current_subscription_id is not null
    end),
  constraint accounts_state_history check (coalesce(
    case when jsonb_typeof(state_history) = 'array' then
      jsonb_array_length(state_history) between 1 and 200
      and state_history -> -1 ->> 'state' = state
    end, false))
);

create index if not exists accounts_state_trial_ends_idx on public.accounts (state, trial_ends_at);
create index if not exists accounts_past_due_idx on public.accounts (state, past_due_since)
  where state = 'past_due';

-- ─── subscriptions: the Stripe mirror ─────────────────────────────────────────────────────────────

create table if not exists public.subscriptions (
  id text primary key check (id ~ '^sub_'),
  account_id uuid not null references public.accounts (id) on delete cascade,
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid',
                                         'incomplete', 'incomplete_expired', 'paused')),
  plan text not null check (plan in ('pro', 'agency')),
  interval text not null check (interval in ('month', 'year')),
  seat_quantity integer not null default 0 check (seat_quantity >= 0),
  extra_site_quantity integer not null default 0 check (extra_site_quantity between 0 and 25),
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  price_ids text[] not null default '{}',
  last_event_id text,
  last_event_created timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_extras_agency_only check (
    plan = 'agency' or (seat_quantity = 0 and extra_site_quantity = 0))
);

create index if not exists subscriptions_account_status_idx on public.subscriptions (account_id, status);

-- ─── seats: who is a member of which account ──────────────────────────────────────────────────────

create table if not exists public.seats (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  invited_email text not null,
  name text,
  role text not null check (role in ('owner', 'account_manager', 'developer')),
  status text not null check (status in ('invited', 'active', 'removed')),
  invite_token_hash text,
  alert_channels text[] not null default '{email}' check (alert_channels <@ array['email', 'slack']),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  constraint seats_active_is_accepted check (
    status <> 'active' or (user_id is not null and accepted_at is not null)),
  constraint seats_removed_at check ((status = 'removed') = (removed_at is not null))
);

create unique index if not exists seats_account_user_uq on public.seats (account_id, user_id)
  where user_id is not null;
create unique index if not exists seats_account_invited_email_uq on public.seats (account_id, lower(invited_email))
  where status = 'invited';
create unique index if not exists seats_one_active_owner_uq on public.seats (account_id)
  where role = 'owner' and status = 'active';
create index if not exists seats_user_status_idx on public.seats (user_id, status);
create index if not exists seats_account_idx on public.seats (account_id);

-- ─── agency_brands ────────────────────────────────────────────────────────────────────────────────

create table if not exists public.agency_brands (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  agency_name text not null check (length(agency_name) >= 1),
  logo_path text,
  accent_hex text check (accent_hex ~ '^#[0-9A-Fa-f]{6}$'),
  portal_domain text unique check (portal_domain = lower(portal_domain)),
  portal_domain_status text not null default 'unverified'
    check (portal_domain_status in ('unverified', 'txt_verified', 'pending', 'verified', 'error')),
  portal_txt_token text,
  portal_txt_verified_at timestamptz,
  portal_cname_found boolean,
  portal_certificate_issued_at timestamptz,
  portal_slug text unique,
  vercel_domain_added_at timestamptz,
  sender_domain text,
  sender_from text,
  resend_domain_id text,
  sender_domain_status text not null default 'not_started'
    check (sender_domain_status in ('not_started', 'pending', 'verified', 'failed')),
  spf_passes boolean,
  dkim_passes boolean,
  dmarc_policy text,
  open_tracking_default boolean not null default false,
  postal_address text check (length(postal_address) >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The contract's AgencyBranding rules branding_dns, branding_email_auth and branding_postal.
  constraint agency_brands_dns check ((portal_domain is null) = (portal_cname_found is null)),
  constraint agency_brands_email_auth check (
    (sender_from is null) = (spf_passes is null) and (sender_from is null) = (dkim_passes is null)),
  constraint agency_brands_postal check (sender_from is null or postal_address is not null)
);

-- ─── trial_ledger: append-only; the rules that read it are CC-04 ──────────────────────────────────

create table if not exists public.trial_ledger (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email', 'hostname', 'card_fingerprint', 'device', 'ip24')),
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  -- Kept when the account is deleted, so deleting an account does not clear its trial history.
  account_id uuid references public.accounts (id) on delete set null,
  trial_kind text not null check (trial_kind in ('pro', 'agency')),
  created_at timestamptz not null default now()
);

create index if not exists trial_ledger_lookup_idx on public.trial_ledger (kind, value_hash, created_at desc);
create index if not exists trial_ledger_account_idx on public.trial_ledger (account_id);

-- ─── users: two new columns ───────────────────────────────────────────────────────────────────────

-- Nullable until CC-04 defines the normaliser and CC-05 backfills the existing rows.
alter table public.users add column if not exists email_normalized text;
alter table public.users add column if not exists default_account_id uuid
  references public.accounts (id) on delete set null;
create index if not exists users_email_normalized_idx on public.users (email_normalized);
create index if not exists users_default_account_idx on public.users (default_account_id);

-- ─── Membership helpers ───────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so the policies on seats can call them without recursing into seats' own policy.

create or replace function public.is_member(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from public.seats s
      join public.accounts a on a.id = s.account_id
     where s.account_id = p_account
       and s.user_id = auth.uid()
       and s.status = 'active'
       and a.deleted_at is null
  );
$$;

create or replace function public.member_role(p_account uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select s.role
    from public.seats s
    join public.accounts a on a.id = s.account_id
   where s.account_id = p_account
     and s.user_id = auth.uid()
     and s.status = 'active'
     and a.deleted_at is null
   limit 1;
$$;

revoke all on function public.is_member(uuid) from public, anon, authenticated;
revoke all on function public.member_role(uuid) from public, anon, authenticated;
grant execute on function public.is_member(uuid) to authenticated, service_role;
grant execute on function public.member_role(uuid) to authenticated, service_role;

-- ─── apply_entitlement_transition ─────────────────────────────────────────────────────────────────
-- Writes one transition computed by next() in apps/web/lib/billing/state-machine.ts, in one
-- transaction: the account row, its history, and the removal of active seats beyond the new seat
-- limit. Site effects (pause, resume, page cap) join this function when the sites table exists (003).
-- trial_used_at and disputed_at are only ever set here, never cleared.

create or replace function public.apply_entitlement_transition(
  p_account_id uuid,
  p_expected_version integer,
  p_state text,
  p_tier text,
  p_past_due_tier text,
  p_past_due_since timestamptz,
  p_trial_variant text,
  p_trial_ends_at timestamptz,
  p_trial_used_at timestamptz,
  p_disputed_at timestamptz,
  p_seat_limit integer,
  p_site_limit integer,
  p_competitor_limit integer,
  p_at timestamptz,
  p_subscription_id text,
  p_changed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.accounts%rowtype;
  v_history jsonb;
  v_since timestamptz;
  v_owner_seats integer;
begin
  if p_account_id is null or p_expected_version is null or p_state is null or p_tier is null
     or p_seat_limit is null or p_site_limit is null or p_competitor_limit is null or p_at is null then
    raise exception 'entitlement: a required argument is null' using errcode = '22004';
  end if;
  select * into v_account from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'entitlement: account % not found', p_account_id using errcode = 'P0002';
  end if;
  if v_account.entitlement_version <> p_expected_version then
    raise exception 'entitlement: account % is at version %, expected %',
      p_account_id, v_account.entitlement_version, p_expected_version using errcode = '40001';
  end if;

  v_history := v_account.state_history;
  if p_state <> v_account.state then
    -- The contract orders history strictly by time, compared in milliseconds. Entries are stamped
    -- to the millisecond, and one that would not come after the previous entry is recorded one
    -- millisecond after it.
    v_since := greatest(date_trunc('milliseconds', p_at),
                        (v_history -> -1 ->> 'since')::timestamptz + interval '1 millisecond');
    v_history := v_history || jsonb_build_array(jsonb_build_object(
      'state', p_state,
      'since', to_char(v_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    if jsonb_array_length(v_history) > 200 then
      v_history := (
        select jsonb_agg(e order by i)
          from jsonb_array_elements(v_history) with ordinality as t (e, i)
         where i > jsonb_array_length(v_history) - 200);
    end if;
  end if;

  update public.accounts
     set state = p_state,
         tier = p_tier,
         past_due_tier = p_past_due_tier,
         past_due_since = p_past_due_since,
         trial_variant = p_trial_variant,
         trial_ends_at = p_trial_ends_at,
         trial_used_at = coalesce(trial_used_at, p_trial_used_at),
         disputed_at = coalesce(disputed_at, p_disputed_at),
         seat_limit = p_seat_limit,
         site_limit = p_site_limit,
         competitor_limit = p_competitor_limit,
         current_subscription_id = p_subscription_id,
         entitlement_changed_at = greatest(entitlement_changed_at, p_changed_at),
         state_history = v_history,
         entitlement_version = entitlement_version + 1,
         updated_at = now()
   where id = p_account_id;

  -- The newest active non-owner seats beyond the limit are removed. Invited seats are not counted:
  -- the invite step (a later CC) checks the limit when a seat is accepted.
  select count(*) into v_owner_seats
    from public.seats
   where account_id = p_account_id and status = 'active' and role = 'owner';
  update public.seats
     set status = 'removed', removed_at = p_at
   where id in (
     select id
       from public.seats
      where account_id = p_account_id and status = 'active' and role <> 'owner'
      order by accepted_at, created_at, id
     offset greatest(p_seat_limit - v_owner_seats, 0));

  return v_account.entitlement_version + 1;
end;
$$;

revoke all on function public.apply_entitlement_transition(
  uuid, integer, text, text, text, timestamptz, text, timestamptz, timestamptz, timestamptz,
  integer, integer, integer, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_entitlement_transition(
  uuid, integer, text, text, text, timestamptz, text, timestamptz, timestamptz, timestamptz,
  integer, integer, integer, timestamptz, text, timestamptz) to service_role;

-- ─── assert_entitlement_version ───────────────────────────────────────────────────────────────────
-- For an event next() ignores: nothing is written, but the decision was made on a read, so it
-- stands only if the account has not changed since.

create or replace function public.assert_entitlement_version(
  p_account_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_version integer;
begin
  select entitlement_version into v_version from public.accounts where id = p_account_id;
  if not found then
    raise exception 'entitlement: account % not found', p_account_id using errcode = 'P0002';
  end if;
  if v_version is distinct from p_expected_version then
    raise exception 'entitlement: account % is at version %, expected %',
      p_account_id, v_version, p_expected_version using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.assert_entitlement_version(uuid, integer) from public, anon, authenticated;
grant execute on function public.assert_entitlement_version(uuid, integer) to service_role;

-- ─── RLS and grants ───────────────────────────────────────────────────────────────────────────────
-- Members read their accounts' rows; nobody writes through PostgREST. trial_ledger is service-role
-- only. SELECT is granted per column, so a column added later is hidden until it is granted;
-- stripe_customer_id and invite_token_hash are left out.

alter table public.accounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.seats enable row level security;
alter table public.agency_brands enable row level security;
alter table public.trial_ledger enable row level security;

drop policy if exists accounts_member_read on public.accounts;
create policy accounts_member_read on public.accounts
  for select to authenticated using (public.is_member(id));

drop policy if exists subscriptions_member_read on public.subscriptions;
create policy subscriptions_member_read on public.subscriptions
  for select to authenticated using (public.is_member(account_id));

drop policy if exists seats_member_read on public.seats;
create policy seats_member_read on public.seats
  for select to authenticated using (public.is_member(account_id));

drop policy if exists agency_brands_member_read on public.agency_brands;
create policy agency_brands_member_read on public.agency_brands
  for select to authenticated using (public.is_member(account_id));

revoke all on table public.accounts from public, anon, authenticated;
revoke all on table public.subscriptions from public, anon, authenticated;
revoke all on table public.seats from public, anon, authenticated;
revoke all on table public.agency_brands from public, anon, authenticated;
revoke all on table public.trial_ledger from public, anon, authenticated;

grant select (
  id, kind, name, state, tier, past_due_tier, past_due_since, trial_variant, disputed_at,
  trial_ends_at, trial_used_at, timezone, seat_limit, site_limit, competitor_limit, card_last4,
  email_change_notes, email_trial_reminder, state_history, entitlement_version,
  current_subscription_id, entitlement_changed_at, last_active_at,
  created_at, updated_at, deleted_at
) on public.accounts to authenticated;
grant select (
  id, account_id, status, plan, interval, seat_quantity, extra_site_quantity, current_period_end,
  trial_end, cancel_at_period_end, canceled_at, ended_at, price_ids, last_event_id,
  last_event_created, created_at, updated_at
) on public.subscriptions to authenticated;
grant select (
  id, account_id, user_id, invited_email, name, role, status, alert_channels, theme, created_at,
  accepted_at, removed_at
) on public.seats to authenticated;
grant select (
  account_id, agency_name, logo_path, accent_hex, portal_domain, portal_domain_status,
  portal_txt_token, portal_txt_verified_at, portal_cname_found, portal_certificate_issued_at,
  portal_slug, vercel_domain_added_at, sender_domain, sender_from, resend_domain_id,
  sender_domain_status, spf_passes, dkim_passes, dmarc_policy, open_tracking_default,
  postal_address, created_at, updated_at
) on public.agency_brands to authenticated;

grant all on table public.accounts to service_role;
grant all on table public.subscriptions to service_role;
grant all on table public.seats to service_role;
grant all on table public.agency_brands to service_role;
grant all on table public.trial_ledger to service_role;

-- ─── handle_new_user: user → account → seat → default account ─────────────────────────────────────
-- The users insert is v1's, unchanged. The rest runs in the same transaction as the auth.users
-- insert, so a sign-up either gets all four rows or fails. A users row that already has a default
-- account is left alone.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  perform 1 from public.users where id = new.id and default_account_id is null for update;
  if found then
    insert into public.accounts (kind, state, tier, seat_limit, site_limit, competitor_limit, state_history)
    values ('personal', 'free', 'free', 1, 1, 0,
            jsonb_build_array(jsonb_build_object(
              'state', 'free',
              'since', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
    returning id into v_account_id;

    insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
    values (v_account_id, new.id, new.email, 'owner', 'active', now());

    update public.users set default_account_id = v_account_id where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
