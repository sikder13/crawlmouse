-- v2 security (CC-37): internal accounts leave the trial ledger alone, one Agency trial a person,
-- who may publish a client's report, the erasure of a replaced client contact and of the contact's
-- name, and the card's last four read by the owner only. Spec: docs/specs/v2/37-security.md.
--
-- Not additive. Five functions are restated, each from its latest definition, with its owner,
-- security, search_path and grants as they were: trial_ledger_refusals and start_trial_with_ledger
-- (20261108000001, the latter with 20261108000002's search_path), start_agency_trial_account
-- (20261114000001), seat_may (20261114000002) and erase_rules (20261113000001). One column grant is
-- narrowed: authenticated no longer reads accounts.card_last4. erase_rules repeats two existing rows
-- that name tables in `auth`, byte for byte; nothing in `auth` is created, altered or written by this
-- file, and no cascade is added. It reads accounts.internal, which CC-33's 20261115000001 adds; until
-- that file is on main this one adds the column with the same statement (questions Q6), so either
-- order leaves one column. The revert drops it unless the migration history records 20261115000001.
--
-- The statements are re-runnable (the tests apply the file twice).
-- The revert is infra/supabase/rollbacks/20261117000001_v2_037_security.revert.sql.
-- Tests: apps/web/__tests__/v2-037-security.test.ts and, on a real Postgres,
-- scripts/db/agency-trial-repeat-race.test.ts, scripts/db/agency-trial-race.test.ts and
-- scripts/db/trial-race.test.ts.

-- ═══ A: internal accounts and the trial ledger (D3a) ═════════════════════════════════════════════
-- CC-33's statement, word for word (20261115000001 §A): a no-op once that file has run.
alter table public.accounts add column if not exists internal boolean not null default false;

-- The owner's own test accounts are marked internal (CC-33's operator script) so they can be reset
-- and trialled again. An account is marked only after its first login, whose Pro trial wrote ledger
-- rows for the email, the device and the network, and those rows would refuse the next test
-- sign-up. So: a ledger row of an internal account refuses nothing (trial_ledger_refusals), and an
-- internal account's trial takes no hash lock, is refused by no row and writes none
-- (start_trial_with_ledger). The account's own trial_used_at still makes it not_eligible: clearing
-- it is an operator's step this file does not build. Each body is the one it replaces with those
-- lines added.

create or replace function public.trial_ledger_refusals(p_hashes jsonb, p_now timestamptz)
returns text[]
language sql
stable
set search_path = ''
as $$
  with sent as (
    select e ->> 'kind' as kind, e ->> 'value_hash' as value_hash
      from pg_catalog.jsonb_array_elements(p_hashes) as e
  ),
  counted as (
    select s.kind,
           count(*) filter (
             where l.created_at > ((p_now at time zone 'UTC') - interval '12 months') at time zone 'UTC'
           ) as in_year,
           count(*) filter (where l.created_at > p_now - interval '720 hours') as in_recent
      from sent s
      join public.trial_ledger l on l.kind = s.kind and l.value_hash = s.value_hash
      left join public.accounts a on a.id = l.account_id
     -- The widest window is the email rule's; older rows cannot change the answer.
     where s.kind in ('email', 'device', 'ip24')
       -- A row of an internal account is not counted; one whose account went (null) is.
       and a.internal is not true
       and l.created_at > ((p_now at time zone 'UTC') - interval '12 months') at time zone 'UTC'
     group by s.kind
  ),
  n as (
    select coalesce((select in_year from counted where kind = 'email'), 0) as email,
           coalesce((select in_recent from counted where kind = 'device'), 0) as device,
           coalesce((select in_recent from counted where kind = 'ip24'), 0) as ip24
  )
  select pg_catalog.array_remove(array[
           case when n.email >= 1 then 'email' end,
           case when n.device >= 2 then 'device' end,
           case when n.ip24 >= 2 and n.device >= 1 then 'ip24' end
         ]::pg_catalog.text[], null)
    from n
$$;

alter function public.trial_ledger_refusals(jsonb, timestamptz) owner to postgres;
revoke all on function public.trial_ledger_refusals(jsonb, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.start_trial_with_ledger(
  p_account_id uuid,
  p_hashes jsonb,
  p_transition jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
set lock_timeout = '3s'
as $$
declare
  v_element pg_catalog.jsonb;
  v_state pg_catalog.text;
  v_trial_used_at pg_catalog.timestamptz;
  v_internal pg_catalog.bool;
  v_hits pg_catalog.text[];
  v_version integer;
  v_seat_limit integer;
  v_site_limit integer;
  v_competitor_limit integer;
  v_trial_ends_at pg_catalog.timestamptz;
  v_trial_used pg_catalog.timestamptz;
  v_at pg_catalog.timestamptz;
  v_changed_at pg_catalog.timestamptz;
begin
  -- Postgres runs READ UNCOMMITTED as READ COMMITTED.
  if pg_catalog.current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'start_trial_with_ledger runs only under read committed, not %',
      pg_catalog.current_setting('transaction_isolation') using errcode = '0A000';
  end if;

  -- p_hashes
  if p_account_id is null or p_hashes is null or pg_catalog.jsonb_typeof(p_hashes) <> 'array'
     or pg_catalog.jsonb_array_length(p_hashes) not between 1 and 3 then
    raise exception 'start_trial_with_ledger: p_hashes must be an array of 1 to 3 rows'
      using errcode = '22023';
  end if;
  for v_element in select e from pg_catalog.jsonb_array_elements(p_hashes) as e loop
    if pg_catalog.jsonb_typeof(v_element) <> 'object'
       or not (v_element ?& array['kind', 'value_hash'])
       or (select count(*) from pg_catalog.jsonb_object_keys(v_element)) <> 2
       or pg_catalog.jsonb_typeof(v_element -> 'kind') <> 'string'
       or pg_catalog.jsonb_typeof(v_element -> 'value_hash') <> 'string'
       or (v_element ->> 'kind') not in ('email', 'device', 'ip24')
       or (v_element ->> 'value_hash') !~ '^[0-9a-f]{64}$' then
      raise exception 'start_trial_with_ledger: a p_hashes row is not {kind, value_hash}'
        using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct e ->> 'kind') from pg_catalog.jsonb_array_elements(p_hashes) as e)
       <> pg_catalog.jsonb_array_length(p_hashes) then
    raise exception 'start_trial_with_ledger: p_hashes holds a kind twice' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(p_hashes) as e
                  where e ->> 'kind' = 'email') then
    raise exception 'start_trial_with_ledger: p_hashes has no email row' using errcode = '22023';
  end if;

  -- p_transition
  if p_transition is null or pg_catalog.jsonb_typeof(p_transition) <> 'object'
     or not (p_transition ?& array[
       'event', 'p_account_id', 'p_expected_version', 'p_state', 'p_tier', 'p_past_due_tier',
       'p_past_due_since', 'p_trial_variant', 'p_trial_ends_at', 'p_trial_used_at', 'p_disputed_at',
       'p_seat_limit', 'p_site_limit', 'p_competitor_limit', 'p_at', 'p_subscription_id',
       'p_changed_at'])
     or (select count(*) from pg_catalog.jsonb_object_keys(p_transition)) <> 17
     or p_transition -> 'event' is distinct from '"trial_started"'::pg_catalog.jsonb
     or p_transition -> 'p_account_id' is distinct from pg_catalog.to_jsonb(p_account_id::pg_catalog.text)
     or p_transition -> 'p_state' is distinct from '"pro_trial"'::pg_catalog.jsonb
     or p_transition -> 'p_tier' is distinct from '"pro"'::pg_catalog.jsonb
     or p_transition -> 'p_trial_variant' is distinct from '"no_card"'::pg_catalog.jsonb
     or p_transition -> 'p_subscription_id' is distinct from 'null'::pg_catalog.jsonb
     or p_transition -> 'p_past_due_tier' is distinct from 'null'::pg_catalog.jsonb
     or p_transition -> 'p_past_due_since' is distinct from 'null'::pg_catalog.jsonb
     or p_transition -> 'p_disputed_at' is distinct from 'null'::pg_catalog.jsonb
     or pg_catalog.jsonb_typeof(p_transition -> 'p_trial_ends_at') <> 'string'
     or pg_catalog.jsonb_typeof(p_transition -> 'p_trial_used_at') <> 'string'
     or pg_catalog.jsonb_typeof(p_transition -> 'p_at') <> 'string'
     or pg_catalog.jsonb_typeof(p_transition -> 'p_changed_at') not in ('string', 'null')
     or pg_catalog.jsonb_typeof(p_transition -> 'p_expected_version') <> 'number'
     or pg_catalog.jsonb_typeof(p_transition -> 'p_seat_limit') <> 'number'
     or pg_catalog.jsonb_typeof(p_transition -> 'p_site_limit') <> 'number'
     or pg_catalog.jsonb_typeof(p_transition -> 'p_competitor_limit') <> 'number'
     -- ISO 8601 with an offset, as toISOString writes: no 'infinity', 'epoch' or 'now'.
     or (p_transition ->> 'p_trial_ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
     or (p_transition ->> 'p_trial_used_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
     or (p_transition ->> 'p_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
     or (p_transition ->> 'p_changed_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'start_trial_with_ledger: p_transition is not a no-card trial start for this account'
      using errcode = '22023';
  end if;
  -- A number that is not an integer ('1.5') or does not fit one fails its cast, which this block
  -- turns into 22023.
  begin
    v_version := (p_transition ->> 'p_expected_version')::integer;
    v_seat_limit := (p_transition ->> 'p_seat_limit')::integer;
    v_site_limit := (p_transition ->> 'p_site_limit')::integer;
    v_competitor_limit := (p_transition ->> 'p_competitor_limit')::integer;
    v_trial_ends_at := (p_transition ->> 'p_trial_ends_at')::pg_catalog.timestamptz;
    v_trial_used := (p_transition ->> 'p_trial_used_at')::pg_catalog.timestamptz;
    v_at := (p_transition ->> 'p_at')::pg_catalog.timestamptz;
    v_changed_at := (p_transition ->> 'p_changed_at')::pg_catalog.timestamptz;
  exception when others then
    raise exception 'start_trial_with_ledger: a p_transition value does not read as its type'
      using errcode = '22023';
  end;
  if v_trial_ends_at <= v_at then
    raise exception 'start_trial_with_ledger: the trial ends before it starts' using errcode = '22023';
  end if;

  -- The account, then the hash locks: every caller takes them in this order.
  select a.state, a.trial_used_at, a.internal into v_state, v_trial_used_at, v_internal
    from public.accounts a
   where a.id = p_account_id and a.deleted_at is null
     for update;
  if not found then
    raise exception 'start_trial_with_ledger: account % not found', p_account_id
      using errcode = 'P0002';
  end if;
  if v_state <> 'free' or v_trial_used_at is not null then
    return pg_catalog.jsonb_build_object('outcome', 'not_eligible', 'hits', '[]'::pg_catalog.jsonb);
  end if;

  -- An internal account (20261115000001) takes no hash lock, is refused by no row, and writes none.
  if not v_internal then
    perform public.trial_ledger_lock(p_hashes);

    v_hits := public.trial_ledger_refusals(p_hashes, pg_catalog.now());
    if pg_catalog.cardinality(v_hits) > 0 then
      return pg_catalog.jsonb_build_object('outcome', 'refused', 'hits', pg_catalog.to_jsonb(v_hits));
    end if;
  end if;

  perform public.apply_entitlement_transition(
    p_account_id, v_version, 'pro_trial', 'pro', null, null, 'no_card', v_trial_ends_at,
    v_trial_used, null, v_seat_limit, v_site_limit, v_competitor_limit, v_at, null, v_changed_at);

  if not v_internal then
    insert into public.trial_ledger (kind, value_hash, account_id, trial_kind)
    select e ->> 'kind', e ->> 'value_hash', p_account_id, 'pro'
      from pg_catalog.jsonb_array_elements(p_hashes) as e;
  end if;

  return pg_catalog.jsonb_build_object('outcome', 'started', 'hits', '[]'::pg_catalog.jsonb);
end;
$$;

alter function public.start_trial_with_ledger(uuid, jsonb, jsonb) owner to postgres;
revoke all on function public.start_trial_with_ledger(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.start_trial_with_ledger(uuid, jsonb, jsonb) to service_role;

-- ═══ end A ═══════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: one Agency trial a person (D3b), with A's internal accounts ══════════════════════════════
-- A person who has owned an agency account whose trial was used is refused `trial_used`, whatever
-- their seat's status now (before, only an active seat counted, so an owner who removed themself
-- could start a second trial). The seat must be an owner's: a person who was only ever an account
-- manager or a developer on such an account is not refused. An internal account's trial does not
-- count (section A). The route answers trial_used as before (app/api/agency-trial/_lib/start.ts), and
-- lib/v2/pricing/used-trial.ts reads the same rule for the Agency trial page and Pricing.

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

  -- An owner seat of any status: a removed seat, or one on a deleted account, still counts. An
  -- internal account's trial does not.
  perform 1
    from public.accounts a
    join public.seats s on s.account_id = a.id
   where s.user_id = p_user and s.role = 'owner'
     and a.kind = 'agency' and a.trial_used_at is not null and not a.internal;
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

-- ═══ end B ═══════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: who may publish a client's report (D5, Q16) ══════════════════════════════════════════════
-- `mint_report`: publishing a v2 site's report as a public page (app/api/reports/mint/route.ts asks
-- it, as the caller). The owner and an account manager may; a developer may not. The TypeScript list
-- is SEAT_ACTIONS in apps/web/lib/v2/agency/guard.ts. The body is 20261114000002's with two rows.

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
      ('owner', 'mint_report'),
      ('account_manager', 'export_report'),
      ('account_manager', 'share_report'),
      ('account_manager', 'schedule_report'),
      ('account_manager', 'add_site'),
      ('account_manager', 'edit_site'),
      ('account_manager', 'remove_site'),
      ('account_manager', 'edit_account_alerts'),
      ('account_manager', 'mint_report'),
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

-- ═══ end C ═══════════════════════════════════════════════════════════════════════════════════════

-- ═══ D: the erasure reaches a replaced contact and the contact's name (D5, Q43) ══════════════════
-- erase_rules as 20261113000001 defines it, with two rules added before rule 30 (the contact's
-- address nulled). Rule 18 takes the person's entries out of sites.report_refusals on sites outside
-- their accounts. The triggers that did this (20261114000002: sites_contact_changed,
-- reports_recipient_erased) reach the contact a site holds when the erasure blanks it and a report's
-- recipient, so a contact who declined, was never sent a report and was then replaced kept an
-- entry. Rule 19 nulls sites.client_contact_name beside the address rule 30 nulls. Both run before
-- rules 29 and 30, whose triggers would otherwise take entries or addresses this plan counted, and
-- the apply refuses a rule whose change differs from its count. Every other row is unchanged.

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
      -- CC-37: a client contact's record on sites outside the person's own accounts (theirs go with
      -- the accounts). What a recipient refused is keyed by the address's report_refusal_key; the
      -- entries of each address are taken out, the contact the site holds now or one it held before
      -- (set_client keeps them when the account changes its contact). The name goes where rule 30
      -- blanks the address, so it runs first.
      (18, 'change', 'sites.report_refusals pruned', 'public.sites x',
       $p$report_refusals = (select coalesce(pg_catalog.jsonb_agg(e.v order by e.n), '[]'::jsonb)
                               from pg_catalog.jsonb_array_elements(x.report_refusals)
                                    with ordinality as e(v, n)
                              where (e.v ->> 'a') is null
                                 or (e.v ->> 'a') <> all (array(select public.report_refusal_key(m)
                                                                  from unnest($2) m)))$p$,
       $p$not (x.account_id = any($3))
          and exists (select 1
                        from pg_catalog.jsonb_array_elements(x.report_refusals) e(v), unnest($2) m
                       where e.v ->> 'a' = public.report_refusal_key(m))$p$),
      (19, 'change', 'sites.client_contact_name nulled', 'public.sites x',
       'client_contact_name = null',
       $p$lower(x.client_contact_email) = any($2) and x.client_contact_name is not null
          and not (x.account_id = any($3))$p$),
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
      -- CC-28: the ledgers' rows of the person's accounts (their account reference is set null when the
      -- account goes, so they are deleted before it).
      (32, 'change', 'email_sends deleted (accounts)', 'public.email_sends x', null,
       'x.account_id = any($3)'),
      (33, 'change', 'slack_sends deleted (accounts)', 'public.slack_sends x', null,
       'x.account_id = any($3)'),
      (35, 'change', 'accounts deleted', 'public.accounts x', null, 'x.id = any($3)'),
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

revoke all on function public.erase_rules() from public, anon, authenticated, service_role;

-- ═══ end D ═══════════════════════════════════════════════════════════════════════════════════════

-- ═══ E: the card's last four, for the owner only (D5, Q25) ═══════════════════════════════════════
-- 20261101000001 granted authenticated this column with the rest of the row, so any member, a
-- developer too, could read it through their own session. It is read with the service role, after
-- the caller's role on the account is found to be the owner's. Nothing else in the grant changes.
revoke select (card_last4) on public.accounts from authenticated;

-- ═══ end E ═══════════════════════════════════════════════════════════════════════════════════════
