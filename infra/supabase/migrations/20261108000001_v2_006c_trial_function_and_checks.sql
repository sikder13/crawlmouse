-- 006c: the no-card trial and its ledger rows in one transaction, and the site_fixes CHECKs the
-- contract now needs. Spec: docs/specs/v2/06c-trial-function.md. Tests:
-- apps/web/__tests__/v2-006c-trial-function.test.ts (PGlite) and scripts/db/trial-race.test.ts (two
-- real transactions, CI's Postgres service).
--
-- Additive: three functions, one CHECK replaced with a wider one, two CHECKs added. Every statement
-- is re-runnable. The revert is infra/supabase/rollbacks/20261108000001_v2_006c_trial_function_and_checks.revert.sql.
--
-- ⚠ Precondition for production: V2_ACCOUNT_DOOR stays unset until this file is applied and
-- verified; the first-login hook calls start_trial_with_ledger and has no other path.

-- ─── trial_ledger_refusals: the ledger rule, its one implementation ──────────────────────────────
-- The kinds that refuse a trial for these hashes at p_now, in the order email, device, ip24:
--   email:  a row of the same kind and hash created after p_now less 12 calendar months, counted
--           in UTC (Postgres clamps 29 February to 28 February);
--   device: 2 or more rows created after p_now less 720 hours (30 days of 24 hours, so a session
--           time zone with a DST change cannot move it);
--   ip24:   2 or more rows in that window, and 1 or more rows of the device hash given.
-- A row exactly at a window's start is outside it. Rows of other kinds are never read. p_now is an
-- argument so the tests can pin each edge; start_trial_with_ledger passes now().

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
     -- The widest window is the email rule's; older rows cannot change the answer.
     where s.kind in ('email', 'device', 'ip24')
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

-- ─── trial_ledger_lock: one advisory lock per hash, in one global order ──────────────────────────
-- A transaction-scoped lock per (kind, value_hash), keyed by the hash's first 32 bits under the
-- class 1728 (0x06C0) in the two-key form, which shares no key with the one-key form scripts/db uses.
-- The hashes are HMACs, so their bits are uniform; two hashes that share a key only wait for each
-- other. Keys are taken in ascending order, so two callers sharing hashes cannot deadlock. Returns
-- the keys in the order they were taken, built inside the locking loop.

create or replace function public.trial_ledger_lock(p_hashes jsonb)
returns integer[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_key integer;
  v_taken integer[] := '{}';
begin
  for v_key in
    select distinct ('x' || pg_catalog.left(e ->> 'value_hash', 8))::bit(32)::integer
      from pg_catalog.jsonb_array_elements(p_hashes) as e
     order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(1728, v_key);
    v_taken := v_taken || v_key;
  end loop;
  return v_taken;
end;
$$;

alter function public.trial_ledger_lock(jsonb) owner to postgres;
revoke all on function public.trial_ledger_lock(jsonb)
  from public, anon, authenticated, service_role;

-- ─── start_trial_with_ledger ──────────────────────────────────────────────────────────────────────
-- In one transaction: validate the input; lock the account FOR UPDATE; return not_eligible unless it
-- is Free and has not used its trial; take the hash locks; read the rule; return refused with the
-- kinds that refused; otherwise apply the trial through apply_entitlement_transition and insert one
-- trial_ledger row per hash. Returns {"outcome": started | refused | not_eligible, "hits": [...]}.
--
-- p_hashes: an array of 1 to 3 objects, each exactly {kind, value_hash}, one per kind, an email row
-- among them; kind in (email, device, ip24); value_hash 64 lowercase hex.
-- p_transition: what apps/web/lib/auth/first-login.ts computes with next() and toTransitionParams for
-- trial_started {variant: no_card}, plus "event": "trial_started": exactly the 16 arguments of
-- apply_entitlement_transition and the event. It must name this account, the pro_trial state, the
-- pro tier and the no_card variant, carry ISO 8601 dates with a trial end after p_at, and leave the
-- subscription, past-due and dispute fields null. This function checks the shape and copies none of
-- the state machine; apply_entitlement_transition refuses a stale version (40001).
-- Anything malformed raises 22023 before any lock is taken.
--
-- The rule is read in a statement after the locks, so under READ COMMITTED it sees every row a
-- previous holder committed. Under REPEATABLE READ or SERIALIZABLE the snapshot would predate the
-- lock, so the function refuses to run there.
--
-- With pg_temp left out of search_path, Postgres searches it first for type names, so a caller's
-- temp domain could stand in for a type named without its schema and run its CHECK as the owner.
-- The bodies write jsonb, text and timestamptz as pg_catalog.*; integer, numeric, bit and interval
-- are keywords the grammar resolves to pg_catalog. v2-006c-trial-function.test.ts makes a temp
-- domain of each of those names and calls the function. lock_timeout bounds the wait for the account row and
-- the hash locks.

create or replace function public.start_trial_with_ledger(
  p_account_id uuid,
  p_hashes jsonb,
  p_transition jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_element pg_catalog.jsonb;
  v_state pg_catalog.text;
  v_trial_used_at pg_catalog.timestamptz;
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
  select a.state, a.trial_used_at into v_state, v_trial_used_at
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

  perform public.trial_ledger_lock(p_hashes);

  v_hits := public.trial_ledger_refusals(p_hashes, pg_catalog.now());
  if pg_catalog.cardinality(v_hits) > 0 then
    return pg_catalog.jsonb_build_object('outcome', 'refused', 'hits', pg_catalog.to_jsonb(v_hits));
  end if;

  perform public.apply_entitlement_transition(
    p_account_id, v_version, 'pro_trial', 'pro', null, null, 'no_card', v_trial_ends_at,
    v_trial_used, null, v_seat_limit, v_site_limit, v_competitor_limit, v_at, null, v_changed_at);

  insert into public.trial_ledger (kind, value_hash, account_id, trial_kind)
  select e ->> 'kind', e ->> 'value_hash', p_account_id, 'pro'
    from pg_catalog.jsonb_array_elements(p_hashes) as e;

  return pg_catalog.jsonb_build_object('outcome', 'started', 'hits', '[]'::pg_catalog.jsonb);
end;
$$;

alter function public.start_trial_with_ledger(uuid, jsonb, jsonb) owner to postgres;
revoke all on function public.start_trial_with_ledger(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.start_trial_with_ledger(uuid, jsonb, jsonb) to service_role;

-- ─── site_fixes.type: the contract's FixTypeSchema ───────────────────────────────────────────────
-- 003 wrote the CHECK inline, so Postgres named it; it is found here by the column it reads, not by
-- that name. Every CHECK on type alone is dropped, the contract's list is added under a fixed name,
-- and the block after raises unless exactly that one remains.

do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.site_fixes'::regclass and c.contype = 'c'
       and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
                              where a.attrelid = 'public.site_fixes'::regclass
                                and a.attname = 'type')]::int2[]
  loop
    execute pg_catalog.format('alter table public.site_fixes drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.site_fixes add constraint site_fixes_type_check check (type in (
  'robots_txt_blocks_crawler', 'edge_rule_blocks_crawler', 'client_rendered_template', 'orphan_pages',
  'quotable_opening', 'generic_anchor_text', 'deep_pages', 'specs_as_images', 'missing_author_date',
  'js_only_navigation', 'redirect_chain', 'duplicate_pagination', 'canonical_mismatch', 'hreflang_gap',
  'missing_schema_description', 'no_question_headings')) not valid;
alter table public.site_fixes validate constraint site_fixes_type_check;

do $$
begin
  if (select pg_catalog.array_agg(c.conname order by c.conname)
        from pg_catalog.pg_constraint c
       where c.conrelid = 'public.site_fixes'::regclass and c.contype = 'c'
         and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
                                where a.attrelid = 'public.site_fixes'::regclass
                                  and a.attname = 'type')]::int2[])
     is distinct from array['site_fixes_type_check']::name[] then
    raise exception '006c: site_fixes.type must have exactly one CHECK, site_fixes_type_check';
  end if;
end;
$$;

-- ─── site_fixes.effect: CC-17's two rules (packages/types/src/v2/fix.ts) ─────────────────────────
-- effect_seo_pending: a Technical SEO effect is estimated, or it is null and says what it waits on;
-- the shape of site_fixes_effect_pending (003).
alter table public.site_fixes drop constraint if exists site_fixes_effect_seo_pending;
alter table public.site_fixes add constraint site_fixes_effect_seo_pending check (
  (coalesce(effect -> 'technical_seo', 'null') = 'null')
    = (jsonb_array_length(coalesce(effect -> 'technical_seo_pending_on', '[]')) > 0)) not valid;
alter table public.site_fixes validate constraint site_fixes_effect_seo_pending;

-- effect_absorbed: a fix absorbed by a higher-ranked one has no positive effect left.
alter table public.site_fixes drop constraint if exists site_fixes_effect_absorbed;
alter table public.site_fixes add constraint site_fixes_effect_absorbed check (
  not (coalesce(effect -> 'absorbed_by', 'null') <> 'null'
       and coalesce(case when jsonb_typeof(effect -> 'technical_seo') = 'number'
                         then (effect ->> 'technical_seo')::numeric end, 0)
           + coalesce(case when jsonb_typeof(effect -> 'ai_readability') = 'number'
                           then (effect ->> 'ai_readability')::numeric end, 0) > 0)) not valid;
alter table public.site_fixes validate constraint site_fixes_effect_absorbed;
