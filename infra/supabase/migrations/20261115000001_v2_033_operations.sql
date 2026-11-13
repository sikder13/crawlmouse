-- v2 operations (CC-33): operators and the accounts marked internal, the support console's record of
-- what staff looked at and did, founder notices, and the founder mail kinds.
-- Spec: docs/specs/v2/33-operations.md.
--
-- Nothing in auth is touched and no cascade is added.
--
-- The statements are re-runnable (the tests apply the file twice).
-- The revert is infra/supabase/rollbacks/20261115000001_v2_033_operations.revert.sql.

-- ═══ §A: operators, accounts.internal, operator_actions (workstream A) ═══════════════════════════

-- ─── operators ───────────────────────────────────────────────────────────────────────────────────
-- Staff who may use the support console (/internal). Filled by `pnpm ops:operator add|remove`
-- (scripts/ops/operator.ts) with the service role; no client role holds anything on it. user_id is
-- not a reference to public.users: a reference without a cascade would refuse the deletion of a
-- user who is an operator, and is_operator() keys on auth.uid(), so a row left by a deleted user
-- matches no session.

create table if not exists public.operators (
  user_id uuid primary key,
  added_at timestamptz not null default now()
);

alter table public.operators enable row level security;
revoke all on table public.operators from public, anon, authenticated, service_role;
grant select, insert, delete on table public.operators to service_role;

-- ─── accounts.internal ───────────────────────────────────────────────────────────────────────────
-- Our own test and staff accounts, set by `pnpm ops:internal <account-id> [--off]`
-- (scripts/ops/internal.ts). Clients read accounts through per-column grants, which do not name it;
-- the service role holds every column already.
alter table public.accounts add column if not exists internal boolean not null default false;

-- ─── is_internal_subject ─────────────────────────────────────────────────────────────────────────
-- Whether a server event is about an internal account (D1), for lib/analytics-server.ts: p_kind
-- 'account' asks of the account p_id; 'seat' of the account of the seat p_id; 'any' of an id that may
-- be an account's or a user's, true when it is an internal account, or a user whose active seats or
-- default account include one. Any other p_kind answers false. Security invoker: service_role holds
-- select on the three tables.

create or replace function public.is_internal_subject(p_kind text, p_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select case p_kind
    when 'account' then exists (
      select 1 from public.accounts a where a.id = p_id and a.internal)
    when 'seat' then exists (
      select 1 from public.seats s join public.accounts a on a.id = s.account_id
       where s.id = p_id and a.internal)
    when 'any' then exists (
      select 1 from public.accounts a
       where a.internal
         and (a.id = p_id
              or a.id in (select s.account_id from public.seats s
                           where s.user_id = p_id and s.status = 'active')
              or a.id in (select u.default_account_id from public.users u where u.id = p_id)))
    else false
  end;
$$;

revoke all on function public.is_internal_subject(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.is_internal_subject(text, uuid) to service_role;

-- ─── is_operator ─────────────────────────────────────────────────────────────────────────────────
-- Whether the caller's own session is an operator's. The console asks it with the caller's client
-- (apps/web/lib/v2/ops/operator.ts) before it constructs a service-role client.

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (select 1 from public.operators o where o.user_id = auth.uid());
$$;

alter function public.is_operator() owner to postgres;
revoke all on function public.is_operator() from public, anon, authenticated, service_role;
grant execute on function public.is_operator() to authenticated, service_role;

-- ─── operator_account_ids_by_email, user_id_by_email ─────────────────────────────────────────────
-- An address is looked up through these, as an rpc: PostgREST takes an rpc's arguments in the POST
-- body, which the gateway does not log, where a filter (`users?email=eq.<address>`) is in the logged
-- query string. operator_account_ids_by_email answers the default account of the user whose address
-- equals p_email as written, and the accounts that user holds a seat on, without repeats (the support
-- console's search, apps/web/lib/v2/ops/console-store.ts). user_id_by_email answers that user's id,
-- or null (scripts/ops/operator.ts). Security invoker: service_role holds select on users and seats.

create or replace function public.operator_account_ids_by_email(p_email text)
returns table (account_id uuid)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select u.default_account_id from public.users u
   where u.email = p_email and u.default_account_id is not null
  union
  select s.account_id from public.seats s join public.users u on u.id = s.user_id
   where u.email = p_email
  order by 1;
$$;

revoke all on function public.operator_account_ids_by_email(text)
  from public, anon, authenticated, service_role;
grant execute on function public.operator_account_ids_by_email(text) to service_role;

create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select u.id from public.users u where u.email = p_email;
$$;

revoke all on function public.user_id_by_email(text) from public, anon, authenticated, service_role;
grant execute on function public.user_id_by_email(text) to service_role;

-- ─── operator_account_counts ─────────────────────────────────────────────────────────────────────
-- How many rows each section of the console's account page has, so a page that shows a bounded list
-- says how many it left out (apps/web/lib/v2/ops/console-store.ts `dossier`): the account's seats,
-- sites, mail ledger rows and alert rules; the checks and open or reopened fixes of the sites in
-- p_sites, and the alert events of the rules in p_rules (the sites and rules the page shows), counted
-- where the site or rule is the account's. Security invoker: service_role holds select on these
-- tables.

create or replace function public.operator_account_counts(
  p_account uuid,
  p_sites uuid[],
  p_rules uuid[]
)
returns table (
  seats integer,
  sites integer,
  checks integer,
  mail integer,
  rules integer,
  alerts integer,
  fixes integer
)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select
    (select count(*)::integer from public.seats s where s.account_id = p_account),
    (select count(*)::integer from public.sites s where s.account_id = p_account),
    (select count(*)::integer from public.checks c join public.sites s on s.id = c.site_id
      where s.account_id = p_account and c.site_id = any(p_sites)),
    (select count(*)::integer from public.email_sends e where e.account_id = p_account),
    (select count(*)::integer from public.alert_rules r where r.account_id = p_account),
    (select count(*)::integer from public.alert_events e join public.alert_rules r on r.id = e.rule_id
      where r.account_id = p_account and e.rule_id = any(p_rules)),
    (select count(*)::integer from public.site_fixes f join public.sites s on s.id = f.site_id
      where s.account_id = p_account and f.site_id = any(p_sites)
        and f.status in ('open', 'reopened'));
$$;

revoke all on function public.operator_account_counts(uuid, uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.operator_account_counts(uuid, uuid[], uuid[]) to service_role;

-- ─── operator_actions ────────────────────────────────────────────────────────────────────────────
-- The console's record: who (operator_id), what (action), whose account (account_id), on what
-- (target), why (reason), with what result (outcome), when (created_at). account_id is not a
-- reference, so the record outlives a purged account. The service role may read and add rows and
-- holds no update or delete; operator_finish below sets a re-send's outcome once. No text column
-- holds an '@', so no address is written into a record that outlives the account it names.

create table if not exists public.operator_actions (
  id bigint generated by default as identity primary key,
  operator_id uuid not null,
  action text not null
    constraint operator_actions_action_check
    check (action in ('search', 'list_accounts', 'view_account', 'rerun_check', 'resend_sign_in')),
  account_id uuid,
  target text
    constraint operator_actions_target_check
    check (pg_catalog.length(target) <= 200 and pg_catalog.strpos(target, '@') = 0),
  reason text
    constraint operator_actions_reason_check
    check (pg_catalog.length(reason) between 1 and 500 and pg_catalog.strpos(reason, '@') = 0),
  outcome text
    constraint operator_actions_outcome_check
    check (pg_catalog.length(outcome) <= 64 and pg_catalog.strpos(outcome, '@') = 0),
  created_at timestamptz not null default now()
);

create index if not exists operator_actions_account_idx
  on public.operator_actions (account_id, created_at desc);

alter table public.operator_actions enable row level security;
revoke all on table public.operator_actions from public, anon, authenticated, service_role;
grant select, insert on table public.operator_actions to service_role;

-- ─── operator_log ────────────────────────────────────────────────────────────────────────────────
-- Writes one search, list_accounts, view_account or resend_sign_in row and answers its id
-- (list_accounts: a row for an account a search listing shows, written before the listing reads it).
-- p_outcome is known when the row is written for a search (how many accounts it found) and null
-- otherwise; a re-send's is set afterwards by operator_finish. p_operator must be in operators
-- (42501 otherwise). A queued or capped re-run is recorded by operator_request_check, in the call
-- that queues it; a re-run the console's route refuses before that call is recorded here, as a
-- rerun_check row with a reason and one of the route's refusals as its outcome (crawl_paused,
-- unavailable, not_failed, site_removed, site_paused). Any other rerun_check row is refused (22023). Security
-- invoker: service_role holds the insert.

create or replace function public.operator_log(
  p_operator uuid,
  p_action text,
  p_account uuid,
  p_target text,
  p_reason text,
  p_outcome text
)
returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_action = 'rerun_check'
     and (p_reason is null
          or p_outcome is null
          or p_outcome not in ('crawl_paused', 'unavailable', 'not_failed', 'site_removed', 'site_paused'))
  then
    raise exception 'operator_log: a re-run is recorded by operator_request_check'
      using errcode = '22023';
  end if;
  perform 1 from public.operators o where o.user_id = p_operator;
  if not found then
    raise exception 'operator_log: % is not an operator', p_operator using errcode = '42501';
  end if;
  insert into public.operator_actions (operator_id, action, account_id, target, reason, outcome)
  values (p_operator, p_action, p_account, p_target, p_reason, p_outcome)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.operator_log(uuid, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.operator_log(uuid, text, uuid, text, text, text) to service_role;

-- ─── operator_request_check ──────────────────────────────────────────────────────────────────────
-- An operator's re-run of a failed check: in one call, request_capped_check(p_row, p_cap, p_global)
-- (20261112000001) and the rerun_check row, whose outcome is that answer's outcome in the route's words
-- (request_capped_check's paused and removed are recorded as site_paused and site_removed, so a site's
-- state is not read as a crawl pause), whose target is
-- the failed check p_target and whose account is the site's. Refused before either, with nothing
-- written: a p_operator not in operators (42501), and a p_target that is not a failed check of
-- p_row's site (22023). A call that request_capped_check raises in writes neither. Answers
-- request_capped_check's answer. Security invoker: service_role holds the insert and executes
-- request_capped_check.

create or replace function public.operator_request_check(
  p_operator uuid,
  p_target uuid,
  p_reason text,
  p_row jsonb,
  p_cap integer,
  p_global jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_site uuid;
  v_account uuid;
  v_answer jsonb;
begin
  perform 1 from public.operators o where o.user_id = p_operator;
  if not found then
    raise exception 'operator_request_check: % is not an operator', p_operator
      using errcode = '42501';
  end if;
  v_site := (p_row ->> 'site_id')::uuid;
  perform 1 from public.checks c
   where c.id = p_target and c.site_id = v_site and c.status = 'failed';
  if not found then
    raise exception 'operator_request_check: % is not a failed check of this site', p_target
      using errcode = '22023';
  end if;
  v_answer := public.request_capped_check(p_row, p_cap, p_global);
  select s.account_id into v_account from public.sites s where s.id = v_site;
  insert into public.operator_actions (operator_id, action, account_id, target, reason, outcome)
  values (p_operator, 'rerun_check', v_account, p_target::text, p_reason,
          case v_answer ->> 'outcome'
            when 'paused' then 'site_paused'
            when 'removed' then 'site_removed'
            else v_answer ->> 'outcome'
          end);
  return v_answer;
end;
$$;

revoke all on function public.operator_request_check(uuid, uuid, text, jsonb, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.operator_request_check(uuid, uuid, text, jsonb, integer, jsonb)
  to service_role;

-- ─── operator_finish ─────────────────────────────────────────────────────────────────────────────
-- A sign-in re-send is recorded before the call to Supabase Auth, which no transaction can hold
-- (questions.md Q9); this sets that row's outcome afterwards. It changes a resend_sign_in row whose
-- outcome is null, and nothing else, and answers whether it did. p_outcome is one of sent, refused,
-- rate_limited and failed (22023 otherwise). Security definer, since service_role holds no update
-- on operator_actions: this is the one change a row can take.

create or replace function public.operator_finish(p_id bigint, p_outcome text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_outcome is null or p_outcome not in ('sent', 'refused', 'rate_limited', 'failed') then
    raise exception 'operator_finish: % is not an outcome of a re-send', p_outcome
      using errcode = '22023';
  end if;
  update public.operator_actions
     set outcome = p_outcome
   where id = p_id and action = 'resend_sign_in' and outcome is null;
  return found;
end;
$$;

alter function public.operator_finish(bigint, text) owner to postgres;
revoke all on function public.operator_finish(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.operator_finish(bigint, text) to service_role;

-- ═══ end §A ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §C: founder notices (workstream C) ══════════════════════════════════════════════════════════
-- One row per founder notice (D3): an event the founder is told of, keyed by the event, with the
-- decision made for it. A row holds the account id, the plan and Stripe's amount, never an address
-- or a card detail; the notice reads the rest when it is sent. No foreign key on account_id, so the
-- digest's counts outlive a deleted account. Tests: apps/web/__tests__/v2-033-founder.test.ts; the
-- concurrent claims, scripts/db/founder-notice-race.test.ts.
--   send     mailed (the mail ledger, email_sends, records whether it went)
--   held     over the hour's bound; the next digest tick reports it in one "N more" notice
--   skipped  FOUNDER_NOTIFY_TO was not set when the event was first claimed
create table if not exists public.founder_notices (
  event_key text primary key check (pg_catalog.char_length(event_key) between 1 and 186),
  kind text not null check (kind in ('signup', 'trial_started', 'payment', 'payment_failed',
                                     'cancellation', 'agency_created')),
  account_id uuid,
  internal boolean not null default false,
  occurred_at timestamptz not null,
  facts jsonb not null default '{}' check (pg_catalog.jsonb_typeof(facts) = 'object'),
  state text not null check (state in ('send', 'held', 'skipped')),
  -- The "N more" notice that took this held row: 'overflow:<hour>'.
  overflow_key text check (overflow_key ~ '^overflow:'),
  created_at timestamptz not null default now(),
  constraint founder_notices_overflow_held check (overflow_key is null or state = 'held')
);
create index if not exists founder_notices_created_idx on public.founder_notices (created_at);
create index if not exists founder_notices_held_idx on public.founder_notices (overflow_key)
  where state = 'held';
alter table public.founder_notices enable row level security;
revoke all on public.founder_notices from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.founder_notices to service_role;

-- The claim, made before a notice is mailed. Answers the row's state: for a new key the decision
-- made now, for a key already claimed the decision stored then, so a retried event sends what the
-- first claim decided and the mail ledger's key stops a second send. Decided, in order:
--   skipped  p_configured is false;
--   send     fewer than p_limit rows of the same internal flag were `send` in the hour before p_now
--            (internal accounts and the rest each have their own bound);
--   held     otherwise.
-- created_at is p_now. Production passes the current time, never the event's. The advisory lock
-- makes concurrent claims count one after the other.
create or replace function public.claim_founder_notice(p_key text, p_kind text, p_account uuid,
                                                       p_internal boolean, p_occurred timestamptz,
                                                       p_facts jsonb, p_now timestamptz,
                                                       p_limit integer, p_configured boolean)
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v public.founder_notices%rowtype;
  v_state text;
begin
  if p_key is null or p_kind is null or p_internal is null or p_occurred is null or p_now is null
     or p_limit is null or p_limit < 1 or p_configured is null then
    raise exception 'claim_founder_notice: key, kind, internal, times, limit and configured are required'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder_notices', 0));
  select * into v from public.founder_notices n where n.event_key = p_key;
  if found then
    if v.kind <> p_kind then
      raise exception 'claim_founder_notice: key % names a % notice', p_key, v.kind using errcode = '22023';
    end if;
    return v.state;
  end if;
  if not p_configured then
    v_state := 'skipped';
  elsif (select pg_catalog.count(*) from public.founder_notices n
          where n.state = 'send' and n.internal = p_internal
            and n.created_at > p_now - interval '1 hour') < p_limit then
    v_state := 'send';
  else
    v_state := 'held';
  end if;
  insert into public.founder_notices (event_key, kind, account_id, internal, occurred_at, facts,
                                      state, created_at)
  values (p_key, p_kind, p_account, p_internal, p_occurred, coalesce(p_facts, '{}'::jsonb), v_state,
          p_now);
  return v_state;
end;
$$;

-- The held rows one "N more" notice reports, under its key p_key ('overflow:<hour>', the hour as
-- 'YYYY-MM-DDTHH' in UTC). A first call for a key is one where no row carries the key and no mail was
-- claimed under it (no email_sends row keyed 'founder_event:<p_key>'). It writes the key onto every
-- held row no notice has taken, and onto the rows taken by an earlier notice whose mail's ledger row
-- (key 'founder_event:<its key>') is `failed` and either
--   has 3 attempts, claim_email_send's bound, so that notice is not sent again (review C6), or
--   is under an earlier hour's key than p_key, whatever its attempts (review N1). `send` records
--   `failed` after one attempt both for a provider answer it does not retry and for an attempt that
--   threw while its run has retries left.
-- Both keys must be hour keys for the second; they compare as text in the "C" collation, which for
-- that fixed-width shape is the hours' order. Any other call takes nothing new and answers the rows
-- carrying p_key: a retried notice reports the rows it took, or none when a later hour's notice has
-- re-taken them, so a retry does not mail rows held since under the key its mail was claimed with
-- (review M2). Rows taken by a notice whose run ended before its mail was claimed keep that notice's
-- key and are not reported again. apps/web/__tests__/v2-033-founder.test.ts: "review C6, N1" holds
-- rows under keys whose mails ended each way and takes an hour key after them; "review M2" retries an
-- earlier hour's take after a later hour re-took its rows; "review T2" takes under a key that is not an
-- hour's. Answers {"total": n, "rows": [...]}, rows oldest first, at most p_rows of them; a row's
-- `invoice` is its facts' (null when it has none), so the notice can tell a paid payment from a plan
-- start.
create or replace function public.take_founder_overflow(p_key text, p_rows integer)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_key is null or p_key !~ '^overflow:' or p_rows is null or p_rows < 1 then
    raise exception 'take_founder_overflow: an overflow key and a row bound are required'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder_notices', 0));
  if not exists (select 1 from public.founder_notices n where n.overflow_key = p_key)
     and not exists (select 1 from public.email_sends e
                      where e.idempotency_key = 'founder_event:' || p_key) then
    update public.founder_notices n set overflow_key = p_key
     where n.state = 'held'
       and (n.overflow_key is null
            or exists (select 1 from public.email_sends e
                        where e.idempotency_key = 'founder_event:' || n.overflow_key
                          and e.status = 'failed'
                          and (e.attempts >= 3
                               or (n.overflow_key ~ '^overflow:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$'
                                   and p_key ~ '^overflow:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$'
                                   and n.overflow_key collate "C" < p_key collate "C"))));
  end if;
  return (
    select pg_catalog.jsonb_build_object(
      'total', (select pg_catalog.count(*) from public.founder_notices n where n.overflow_key = p_key),
      'rows', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'kind', r.kind, 'account_id', r.account_id, 'internal', r.internal,
                 'occurred_at', r.occurred_at, 'invoice', r.invoice)
                 order by r.occurred_at, r.event_key)
          from (select n.kind, n.account_id, n.internal, n.occurred_at, n.event_key,
                       n.facts ->> 'invoice' as invoice
                  from public.founder_notices n
                 where n.overflow_key = p_key
                 order by n.occurred_at, n.event_key
                 limit p_rows) r), '[]'::jsonb)));
end;
$$;

-- The founder digest's numbers for [p_from, p_to), internal accounts left out where an account is
-- known. Each key names what it counts:
--   signups_confirmed            signup notices recorded (the sweep records one once the address is
--                                confirmed)
--   trials_started               trial_started notices recorded
--   trials_ended                 accounts.state_history entries whose previous entry is a trial
--                                state, by the entry's `since`
--   payments_paid                payment notices whose facts record Stripe's invoice as `paid`, as
--                                read when the plan changed (first and returning; a recovery from
--                                past_due has a notice only when it is a first payment, founder.ts;
--                                a card trial's conversion, charged about an hour after the change,
--                                is recorded unpaid and counted in plans_started_unpaid)
--   plans_started_unpaid         payment notices whose facts record anything else: an invoice not
--                                yet paid, not given or not read (review N4)
--   payments_failed              payment_failed notices recorded
--   cancellations                cancellation notices recorded
--   checks_run_all               checks queued; a check of a site no account keeps is counted
--   checks_failed_all            checks failed, by finished_at; the same sites
--   mail_bounce_events           email_events of type bounced (v1 mail and the sign-in mail)
--   mail_suppressions_new        addresses first suppressed (v2 mail: hard bounces and complaints)
--   mail_send_failures           v2 ledger rows (email_sends) whose last attempt failed, by updated_at;
--                                an internal account's and the founder kinds' own left out
-- The two bounce figures are keyed by address (email_events by address, email_suppressions by its
-- hash) and name no account, so they include internal accounts' mail (questions Q14).
create or replace function public.founder_digest_counts(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'founder_digest_counts: a window with p_from before p_to is required'
      using errcode = '22023';
  end if;
  with notices as (
    select n.kind, (n.kind = 'payment' and n.facts ->> 'invoice' is not distinct from 'paid') as paid,
           pg_catalog.count(*) as c
      from public.founder_notices n
     where not n.internal and n.created_at >= p_from and n.created_at < p_to
     group by 1, 2
  ),
  run as (
    select c.status, c.queued_at, c.finished_at from public.checks c
      left join public.sites s on s.id = c.site_id
      left join public.accounts a on a.id = s.account_id
     where coalesce(a.internal, false) = false
  )
  select pg_catalog.jsonb_build_object(
    'signups_confirmed', coalesce((select c from notices where kind = 'signup'), 0),
    'trials_started', coalesce((select c from notices where kind = 'trial_started'), 0),
    'trials_ended', (
      select pg_catalog.count(*) from public.accounts a
       cross join lateral pg_catalog.jsonb_array_elements(a.state_history) with ordinality h(e, i)
       where not a.internal and h.i > 1
         and a.state_history -> (h.i::int - 2) ->> 'state' in ('pro_trial', 'agency_trial')
         and (h.e ->> 'since')::timestamptz >= p_from and (h.e ->> 'since')::timestamptz < p_to),
    'payments_paid', coalesce((select c from notices where kind = 'payment' and paid), 0),
    'plans_started_unpaid', coalesce((select c from notices where kind = 'payment' and not paid), 0),
    'payments_failed', coalesce((select c from notices where kind = 'payment_failed'), 0),
    'cancellations', coalesce((select c from notices where kind = 'cancellation'), 0),
    'checks_run_all', (select pg_catalog.count(*) from run
                        where run.queued_at >= p_from and run.queued_at < p_to),
    'checks_failed_all', (select pg_catalog.count(*) from run
                           where run.status = 'failed'
                             and run.finished_at >= p_from and run.finished_at < p_to),
    'mail_bounce_events', (select pg_catalog.count(*) from public.email_events e
                            where e.event_type = 'bounced'
                              and e.created_at >= p_from and e.created_at < p_to),
    'mail_suppressions_new', (select pg_catalog.count(*) from public.email_suppressions s
                               where s.first_at >= p_from and s.first_at < p_to),
    'mail_send_failures', (select pg_catalog.count(*) from public.email_sends e
                             left join public.accounts a on a.id = e.account_id
                            where e.status = 'failed'
                              and coalesce(a.internal, false) = false
                              and e.kind not in ('founder_event', 'founder_digest')
                              and e.updated_at >= p_from and e.updated_at < p_to))
    into v;
  return v;
end;
$$;

-- The founder sweep's sign-ups (plan-review M8): users created at or after p_since whose sign-up is
-- not yet announced, at most p_limit, with their default account, taken in a rotation: of the n such
-- users ordered oldest first, the p_limit from position (p_turn * p_limit) mod n on, wrapping to the
-- oldest. The sweep passes its five-minute tick as p_turn, so consecutive runs start p_limit places
-- apart, and users found unconfirmed do not keep the first p_limit places from one run to the next
-- (review C8). Not yet announced:
-- no signup notice, or a signup notice decided `send` whose mail (the ledger key
-- `founder_event:signup:<user>`) has no email_sends row, or one that is neither sent nor suppressed
-- and has fewer than 3 attempts (claim_email_send's bound). So a notice whose send failed is offered
-- again on the next run and the ledger's key stops a second mail; a `held` or `skipped` notice is not
-- offered again. The sweep announces each once Supabase Auth shows its address confirmed; one still
-- unconfirmed when it falls out of the window is never announced.
create or replace function public.founder_signups_unannounced(p_since timestamptz, p_limit integer,
                                                              p_turn bigint)
returns table (user_id uuid, account_id uuid, created_at timestamptz)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_since is null or p_limit is null or p_limit < 1 or p_turn is null or p_turn < 0 then
    raise exception 'founder_signups_unannounced: a time, a positive limit and a turn of 0 or more are required'
      using errcode = '22023';
  end if;
  return query
    with w as (
      select u.id, u.default_account_id, u.created_at,
             pg_catalog.row_number() over (order by u.created_at, u.id) - 1 as pos,
             pg_catalog.count(*) over () as total
        from public.users u
        left join public.founder_notices n on n.event_key = 'signup:' || u.id::text
        left join public.email_sends e on e.idempotency_key = 'founder_event:signup:' || u.id::text
       where u.created_at >= p_since
         and (n.event_key is null
              or (n.state = 'send'
                  and (e.id is null or (e.status not in ('sent', 'suppressed') and e.attempts < 3))))
    )
    select w.id, w.default_account_id, w.created_at from w
     order by (w.pos - ((p_turn % w.total) * p_limit) % w.total + w.total) % w.total
     limit p_limit;
end;
$$;

-- The sign-in canary's look (D6, inngest/signin-canary.ts; review Q17): whether Resend's webhook
-- recorded a delivery to p_address, compared lower-cased, of a mail from p_sender, created at or after
-- p_since less a minute. The webhook stores Resend's event whole in `payload`
-- (app/api/webhooks/resend/route.ts):
--   sender     `data.from`'s address: the part inside a trailing `<…>` when there is one, else the whole
--              value, trimmed and lower-cased, as isV2MailEvent (lib/v2/mail/suppression.ts) reads it;
--   mail time  `data.created_at`, "when the email was created" in Resend's webhook reference
--              (resend.com/docs/webhooks/emails/delivered), not the row's created_at, which is when the
--              webhook arrived: so the run before's mail, created about ten minutes earlier and
--              delivered after this request, does not count. The minute allows for a difference
--              between our clock and Resend's. An event with no `data.created_at`, or one not shaped as
--              a time, is not counted, so the canary raises its signal rather than pass.
create or replace function public.signin_delivery_seen(p_address text, p_sender text,
                                                       p_since timestamptz)
returns boolean
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_address is null or p_sender is null or p_since is null then
    raise exception 'signin_delivery_seen: an address, a sender and a time are required'
      using errcode = '22023';
  end if;
  return exists (
    select 1 from public.email_events e
     cross join lateral (select e.payload -> 'data' ->> 'from' as f,
                                e.payload -> 'data' ->> 'created_at' as at) d
     where e.event_type = 'delivered'
       and pg_catalog.lower(e.email_address) = pg_catalog.lower(p_address)
       and pg_catalog.lower(pg_catalog.btrim(coalesce(pg_catalog.substring(d.f, '<([^<>]*)>\s*$'), d.f)))
             = pg_catalog.lower(pg_catalog.btrim(p_sender))
       -- The case reads the time only once its shape is checked; `and` sets no order.
       and (case when d.at ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$'
                 then d.at::timestamptz end) >= p_since - interval '1 minute');
end;
$$;

revoke all on function public.claim_founder_notice(text, text, uuid, boolean, timestamptz, jsonb,
                                                   timestamptz, integer, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.take_founder_overflow(text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.founder_digest_counts(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.signin_delivery_seen(text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.founder_signups_unannounced(timestamptz, integer, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_founder_notice(text, text, uuid, boolean, timestamptz, jsonb,
                                                      timestamptz, integer, boolean) to service_role;
grant execute on function public.take_founder_overflow(text, integer) to service_role;
grant execute on function public.founder_digest_counts(timestamptz, timestamptz) to service_role;
grant execute on function public.signin_delivery_seen(text, text, timestamptz) to service_role;
grant execute on function public.founder_signups_unannounced(timestamptz, integer, bigint) to service_role;
-- ═══ end §C ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §K: email_sends.kind, the founder kinds (written by the lead once CC-31 is on main) ══════════

-- ═══ end §K ══════════════════════════════════════════════════════════════════════════════════════
