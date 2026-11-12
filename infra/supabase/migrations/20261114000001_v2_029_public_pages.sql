-- v2 public pages (CC-29): the Agency trial's second account, the Agency Plus contact form, and one
-- public report per check. Spec: docs/specs/v2/29-public-pages.md.
--
-- Additive only. Nothing in auth is touched and no cascade is added. The function is security
-- definer, search_path pg_catalog, pg_temp, owned by postgres, and executable by service_role only:
-- the route establishes the caller from their own session before it calls it.
--
-- The statements are re-runnable (the tests apply the file twice).
-- The revert is infra/supabase/rollbacks/20261114000001_v2_029_public_pages.revert.sql.
-- Tests: apps/web/__tests__/v2-029-public-pages.test.ts and, on a real Postgres,
-- scripts/db/agency-trial-race.test.ts.

-- ─── accounts: the open Checkout of an agency trial ──────────────────────────────────────────────
-- The route keeps the Checkout URL it opened and the interval it was opened for, so a second submit
-- on the same interval gets the same session rather than a second one that could also be completed;
-- a submit on the other interval opens a new one. Clients read accounts through per-column grants,
-- which do not name these columns.
alter table public.accounts add column if not exists agency_checkout_url text
  constraint accounts_agency_checkout_url_check check (agency_checkout_url ~ '^https://checkout\.stripe\.com/');
alter table public.accounts add column if not exists agency_checkout_at timestamptz;
alter table public.accounts add column if not exists agency_checkout_interval text
  constraint accounts_agency_checkout_interval_check check (agency_checkout_interval in ('month', 'year'));
-- When the owner last ticked the Agency trial's consent (renewal, EU withdrawal, Terms; FACTS J15/L6).
alter table public.accounts add column if not exists agency_trial_consent_at timestamptz;

-- ─── start_agency_trial_account ──────────────────────────────────────────────────────────────────
-- ARCH-2 §2.4: an agency trial is a second account, whose owner is the person starting it. The call
-- locks the person's users row first, in a statement of its own, so two concurrent calls run one
-- after the other; under READ COMMITTED each later statement of the second call sees what the first
-- committed. Then, in order:
--   trial_used  the person owns an agency account whose trial was used: one agency trial a person;
--   existing    the person owns an agency account still on Free with no trial used and no
--               subscription (an earlier submit, or a Checkout that did not finish): it is returned;
--   created     otherwise a new account, kind 'agency', with Free's limits and the person as owner.
-- The account holds the one first site: stored when it has none, renamed to p_host when it holds one
-- that no check has read yet (a resubmit after a Checkout that did not finish), and left alone once a
-- check has read it. It is stored without a check: its first audit is started from the agency
-- workspace.
-- The route calls it only once the consent box was ticked, so each call stamps the account's
-- agency_trial_consent_at.
-- p_host is the host the route admitted (lib/v2/account/sites.ts admittedHost); the function checks
-- only its shape. p_name is the agency name shown on client reports.

create or replace function public.start_agency_trial_account(p_user uuid, p_name text, p_host text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account uuid;
  v_seat uuid;
  v_site uuid;
  v_outcome text;
begin
  if p_user is null
     or p_name is null or pg_catalog.length(pg_catalog.btrim(p_name)) not between 1 and 120
     or p_host is null or p_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     or pg_catalog.length(p_host) > 253 then
    raise exception 'start_agency_trial_account: p_user, p_name or p_host is not what the route sends'
      using errcode = '22023';
  end if;

  perform 1 from public.users u where u.id = p_user for update;
  if not found then
    raise exception 'start_agency_trial_account: no user %', p_user using errcode = 'P0002';
  end if;

  perform 1
    from public.accounts a
    join public.seats s on s.account_id = a.id
   where s.user_id = p_user and s.role = 'owner' and s.status = 'active'
     and a.kind = 'agency' and a.trial_used_at is not null;
  if found then
    return pg_catalog.jsonb_build_object('outcome', 'trial_used');
  end if;

  select a.id, s.id into v_account, v_seat
    from public.accounts a
    join public.seats s on s.account_id = a.id
   where s.user_id = p_user and s.role = 'owner' and s.status = 'active'
     and a.kind = 'agency' and a.state = 'free' and a.trial_used_at is null
     and a.current_subscription_id is null and a.deleted_at is null
   order by a.created_at
   limit 1;

  if found then
    v_outcome := 'existing';
  else
    insert into public.accounts (kind, name, state, tier, seat_limit, site_limit, competitor_limit,
                                 state_history)
    values ('agency', pg_catalog.btrim(p_name), 'free', 'free', 1, 1, 0,
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'state', 'free',
              'since', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
    returning id into v_account;

    insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
    select v_account, u.id, u.email, 'owner', 'active', pg_catalog.now()
      from public.users u where u.id = p_user
    returning id into v_seat;
    v_outcome := 'created';
  end if;

  update public.accounts set agency_trial_consent_at = pg_catalog.now() where id = v_account;

  select s.id into v_site
    from public.sites s
   where s.account_id = v_account and s.removed_at is null
   order by s.created_at
   limit 1
     for update;
  if not found then
    insert into public.sites (account_id, host, owner_seat_id)
    values (v_account, p_host, v_seat)
    returning id into v_site;
  elsif not exists (select 1 from public.checks c where c.site_id = v_site) then
    update public.sites set host = p_host, updated_at = pg_catalog.now()
     where id = v_site and host <> p_host;
  end if;

  return pg_catalog.jsonb_build_object('outcome', v_outcome, 'account_id', v_account,
                                       'site_id', v_site);
end;
$$;

alter function public.start_agency_trial_account(uuid, text, text) owner to postgres;
revoke all on function public.start_agency_trial_account(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_agency_trial_account(uuid, text, text) to service_role;

-- ─── contact_requests ────────────────────────────────────────────────────────────────────────────
-- The Agency Plus form (FACTS A3: a contact form only). The route writes a row with the service role
-- and sends email.requested naming the row, never the address (as fix_email_requests). The row holds
-- an address and no user id; its retention is set with the mail template (CC-28).

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'agency_plus' check (kind in ('agency_plus')),
  email text not null check (pg_catalog.length(email) between 3 and 320 and email ~ '^[^@\s]+@[^@\s]+$'),
  sites integer check (sites between 1 and 100000),
  note text check (pg_catalog.length(note) <= 2000),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.contact_requests enable row level security;
revoke all on table public.contact_requests from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.contact_requests to service_role;

-- ─── public_reports: one report per check ────────────────────────────────────────────────────────
-- v1 holds one report per audit through audit_id's unique constraint; this is its v2 counterpart, so
-- a double submit returns the first report.
create unique index if not exists public_reports_check_uq on public.public_reports (check_id)
  where check_id is not null;
