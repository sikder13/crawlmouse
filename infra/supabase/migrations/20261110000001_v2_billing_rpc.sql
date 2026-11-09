-- v2 billing (CC-03 D4, D5, D13): where a Stripe event's decision is recorded, and
-- apply_stripe_event(), which writes that decision, the entitlement transition and the subscription
-- mirror in one transaction. Spec: docs/specs/v2/03-billing.md ("The webhook"). Tests:
-- apps/web/__tests__/v2-billing-rpc.test.ts (PGlite) and scripts/db/stripe-event-race.test.ts (two
-- real transactions, CI's Postgres service).
--
-- Additive: three nullable columns on stripe_events, null on every existing row and read by nothing
-- in v1, and one function. Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261110000001_v2_billing_rpc.revert.sql.
--
-- Tested by: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-billing-rpc.test.ts

-- ─── stripe_events: the decision ──────────────────────────────────────────────────────────────────
-- handled is null until the event is decided; then true when the entitlement machine applied it and
-- false when it was ignored or only recorded, with handled_reason saying why. An undecided row can
-- carry handled_reason 'livemode_mismatch' from the route's refusal. effects is the plan the
-- decision made (apps/web/lib/billing/effects.ts): sent after this transaction commits, and sent
-- again by a delivery that finds the decision without processed_at.

alter table public.stripe_events add column if not exists handled boolean;
alter table public.stripe_events add column if not exists handled_reason text;
alter table public.stripe_events add column if not exists effects jsonb
  constraint stripe_events_effects_array check (effects is null or jsonb_typeof(effects) = 'array');

-- ─── apply_stripe_event ───────────────────────────────────────────────────────────────────────────
-- p is what apps/web/lib/billing/webhook-db.ts sends, exactly these ten keys:
--   event_id         'evt_…', the ledger row, which must exist (webhook-db.ts begin() inserts it)
--   event_created    ISO 8601, Stripe's event.created
--   account_id       uuid or null (an event no account of ours can be found for)
--   customer_id      'cus_…' to bind to the account where it has none, or null
--   subscription     null, or {id, gated, mirror}: the subscription row to lock; gated says the
--                    out-of-order guard applies; mirror (null, or the row's twelve columns below)
--                    creates the row when missing and is written when the event passes the guard
--   transition       null, or the 16 named arguments of apply_entitlement_transition (commit)
--   expected_version null, or the version an unchanged decision was made on (confirm)
--   handled          true exactly when handled_reason is null; true needs transition or
--                    expected_version, and transition needs true
--   handled_reason   the machine's reason for an ignored event, or why the event was only recorded
--   effects          the plan, an array
-- Anything malformed raises 22023 before any lock is taken.
--
-- In one transaction, taking locks in this order, as every caller does:
--   1. The ledger row FOR UPDATE. Missing raises P0002. Already decided (handled set) or processed
--      returns {"decided": true} with what was recorded, writing nothing: the caller sends those
--      effects, so two deliveries of one event decide it once.
--   2. The subscription row FOR UPDATE, inserted first from the mirror when missing. A row of
--      another account raises 23514. A gated event strictly older than the row's last_event_created
--      writes neither mirror nor transition nor binding: it is recorded handled = false,
--      'older than the subscription''s last event', with no effects. An event that is not gated
--      and is that old still decides, but does not write its mirror over the newer one. A call
--      whose mirror has the subscription live while the row has it ended (canceled or
--      incomplete_expired, which Stripe never leaves) read it before it ended: it writes nothing
--      either, and is recorded 'the subscription had ended', with no effects.
--   3. The account FOR UPDATE when the call has a transition, an expected version or a customer to
--      bind; a call with none of them does not read the account. Missing raises P0002; an expected
--      version that is not the account's raises 40001. The customer is bound where the account has
--      none; another one already bound, or the customer bound to another account (the unique
--      index), raises 23505. Then the transition, through apply_entitlement_transition, which raises
--      40001 on a stale version.
--   4. The mirror columns, when the call carries them, and last_event_created advanced to the
--      later of the stored value and event_created (last_event_id with it).
--   5. account_id, handled, handled_reason and effects on the ledger row.
-- Returns {"decided": false, "handled", "reason", "effects", "version"}: what it recorded, and the
-- account's entitlement_version after the call (null without an account).
--
-- READ COMMITTED only, as start_trial_with_ledger (006c): each statement after a lock must see
-- what the previous holder committed. lock_timeout bounds each lock wait.

create or replace function public.apply_stripe_event(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $$
declare
  c_iso constant text :=
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$';
  c_older constant text := 'older than the subscription''s last event';
  c_ended constant text := 'the subscription had ended';
  v_event_id text;
  v_created timestamptz;
  v_account uuid;
  v_customer text;
  v_sub jsonb;
  v_sub_id text;
  v_gated boolean;
  v_m jsonb;
  v_t jsonb;
  v_expected integer;
  v_handled boolean;
  v_reason text;
  v_effects jsonb;
  -- the mirror
  v_m_status text;
  v_m_plan text;
  v_m_interval text;
  v_m_seats integer;
  v_m_sites integer;
  v_m_period_end timestamptz;
  v_m_trial_end timestamptz;
  v_m_cancel boolean;
  v_m_canceled_at timestamptz;
  v_m_ended_at timestamptz;
  v_m_prices text[];
  -- the transition
  v_t_version integer;
  v_t_state text;
  v_t_tier text;
  v_t_past_due_tier text;
  v_t_past_due_since timestamptz;
  v_t_trial_variant text;
  v_t_trial_ends_at timestamptz;
  v_t_trial_used_at timestamptz;
  v_t_disputed_at timestamptz;
  v_t_seat_limit integer;
  v_t_site_limit integer;
  v_t_competitor_limit integer;
  v_t_at timestamptz;
  v_t_subscription_id text;
  v_t_changed_at timestamptz;
  -- what the locks read
  v_prior_handled boolean;
  v_prior_reason text;
  v_prior_effects jsonb;
  v_prior_processed timestamptz;
  v_sub_found boolean := false;
  v_sub_account uuid;
  v_sub_last timestamptz;
  v_sub_status text;
  v_version integer;
  v_bound text;
begin
  -- Postgres runs READ UNCOMMITTED as READ COMMITTED.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'apply_stripe_event runs only under read committed, not %',
      current_setting('transaction_isolation') using errcode = '0A000';
  end if;

  -- ── p ──
  if p is null or jsonb_typeof(p) <> 'object'
     or not (p ?& array['event_id', 'event_created', 'account_id', 'customer_id', 'subscription',
                        'transition', 'expected_version', 'handled', 'handled_reason', 'effects'])
     or (select count(*) from jsonb_object_keys(p)) <> 10 then
    raise exception 'apply_stripe_event: p must hold exactly its ten keys' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'event_id') <> 'string'
     or (p ->> 'event_id') !~ '^evt_[A-Za-z0-9_]+$'
     or jsonb_typeof(p -> 'event_created') <> 'string'
     or (p ->> 'event_created') !~ c_iso
     or jsonb_typeof(p -> 'account_id') not in ('string', 'null')
     or jsonb_typeof(p -> 'customer_id') not in ('string', 'null')
     or coalesce((p ->> 'customer_id') !~ '^cus_[A-Za-z0-9_]+$', false)
     or jsonb_typeof(p -> 'subscription') not in ('object', 'null')
     or jsonb_typeof(p -> 'transition') not in ('object', 'null')
     or jsonb_typeof(p -> 'expected_version') not in ('number', 'null')
     or jsonb_typeof(p -> 'handled') <> 'boolean'
     or jsonb_typeof(p -> 'handled_reason') not in ('string', 'null')
     or jsonb_typeof(p -> 'effects') <> 'array' then
    raise exception 'apply_stripe_event: a value of p has the wrong type' using errcode = '22023';
  end if;
  v_event_id := p ->> 'event_id';
  v_customer := p ->> 'customer_id';
  v_handled := (p ->> 'handled')::boolean;
  v_reason := p ->> 'handled_reason';
  v_effects := p -> 'effects';
  v_sub := case when jsonb_typeof(p -> 'subscription') = 'object' then p -> 'subscription' end;
  v_t := case when jsonb_typeof(p -> 'transition') = 'object' then p -> 'transition' end;
  -- A number that is not an integer ('1.5') or does not fit one fails its cast, which this block
  -- turns into 22023.
  begin
    v_created := (p ->> 'event_created')::timestamptz;
    v_account := (p ->> 'account_id')::uuid;
    v_expected := (p ->> 'expected_version')::integer;
  exception when others then
    raise exception 'apply_stripe_event: a value of p does not read as its type' using errcode = '22023';
  end;

  if v_account is null
     and (v_customer is not null or v_sub is not null or v_t is not null or v_expected is not null) then
    raise exception 'apply_stripe_event: a binding, subscription or transition needs an account'
      using errcode = '22023';
  end if;
  if v_t is not null and v_expected is not null then
    raise exception 'apply_stripe_event: a transition and an expected version together'
      using errcode = '22023';
  end if;
  if v_handled <> (v_reason is null)
     or (v_t is not null and not v_handled)
     or (v_t is null and v_expected is null and v_handled) then
    raise exception 'apply_stripe_event: handled must be true exactly when the machine applied the event'
      using errcode = '22023';
  end if;

  -- ── p.subscription ──
  if v_sub is not null then
    if not (v_sub ?& array['id', 'gated', 'mirror'])
       or (select count(*) from jsonb_object_keys(v_sub)) <> 3
       or jsonb_typeof(v_sub -> 'id') <> 'string'
       or (v_sub ->> 'id') !~ '^sub_[A-Za-z0-9_]+$'
       or jsonb_typeof(v_sub -> 'gated') <> 'boolean'
       or jsonb_typeof(v_sub -> 'mirror') not in ('object', 'null') then
      raise exception 'apply_stripe_event: p.subscription is not {id, gated, mirror}'
        using errcode = '22023';
    end if;
    v_sub_id := v_sub ->> 'id';
    v_gated := (v_sub ->> 'gated')::boolean;
    v_m := case when jsonb_typeof(v_sub -> 'mirror') = 'object' then v_sub -> 'mirror' end;
  end if;
  if v_m is not null then
    if not (v_m ?& array['id', 'status', 'plan', 'interval', 'seat_quantity', 'extra_site_quantity',
                         'current_period_end', 'trial_end', 'cancel_at_period_end', 'canceled_at',
                         'ended_at', 'price_ids'])
       or (select count(*) from jsonb_object_keys(v_m)) <> 12
       or v_m -> 'id' is distinct from to_jsonb(v_sub_id)
       or jsonb_typeof(v_m -> 'status') <> 'string'
       or jsonb_typeof(v_m -> 'plan') <> 'string'
       or jsonb_typeof(v_m -> 'interval') <> 'string'
       or jsonb_typeof(v_m -> 'seat_quantity') <> 'number'
       or jsonb_typeof(v_m -> 'extra_site_quantity') <> 'number'
       or jsonb_typeof(v_m -> 'cancel_at_period_end') <> 'boolean'
       or jsonb_typeof(v_m -> 'price_ids') <> 'array'
       or exists (select 1 from jsonb_array_elements(v_m -> 'price_ids') as e
                   where jsonb_typeof(e) <> 'string')
       or exists (select 1 from unnest(array['current_period_end', 'trial_end', 'canceled_at', 'ended_at']) as k
                   where jsonb_typeof(v_m -> k) not in ('string', 'null')
                      or coalesce((v_m ->> k) !~ c_iso, false)) then
      raise exception 'apply_stripe_event: p.subscription.mirror is not a subscriptions row'
        using errcode = '22023';
    end if;
    begin
      v_m_status := v_m ->> 'status';
      v_m_plan := v_m ->> 'plan';
      v_m_interval := v_m ->> 'interval';
      v_m_seats := (v_m ->> 'seat_quantity')::integer;
      v_m_sites := (v_m ->> 'extra_site_quantity')::integer;
      v_m_period_end := (v_m ->> 'current_period_end')::timestamptz;
      v_m_trial_end := (v_m ->> 'trial_end')::timestamptz;
      v_m_cancel := (v_m ->> 'cancel_at_period_end')::boolean;
      v_m_canceled_at := (v_m ->> 'canceled_at')::timestamptz;
      v_m_ended_at := (v_m ->> 'ended_at')::timestamptz;
      v_m_prices := array(select jsonb_array_elements_text(v_m -> 'price_ids'));
    exception when others then
      raise exception 'apply_stripe_event: a value of p.subscription.mirror does not read as its type'
        using errcode = '22023';
    end;
  end if;

  -- ── p.transition ──
  if v_t is not null then
    if not (v_t ?& array[
         'p_account_id', 'p_expected_version', 'p_state', 'p_tier', 'p_past_due_tier',
         'p_past_due_since', 'p_trial_variant', 'p_trial_ends_at', 'p_trial_used_at', 'p_disputed_at',
         'p_seat_limit', 'p_site_limit', 'p_competitor_limit', 'p_at', 'p_subscription_id',
         'p_changed_at'])
       or (select count(*) from jsonb_object_keys(v_t)) <> 16
       or v_t -> 'p_account_id' is distinct from to_jsonb(v_account::text)
       or exists (select 1 from unnest(array['p_expected_version', 'p_seat_limit', 'p_site_limit',
                                             'p_competitor_limit']) as k
                   where jsonb_typeof(v_t -> k) <> 'number')
       or jsonb_typeof(v_t -> 'p_state') <> 'string'
       or jsonb_typeof(v_t -> 'p_tier') <> 'string'
       or exists (select 1 from unnest(array['p_past_due_tier', 'p_trial_variant', 'p_subscription_id']) as k
                   where jsonb_typeof(v_t -> k) not in ('string', 'null'))
       or jsonb_typeof(v_t -> 'p_at') <> 'string'
       or exists (select 1 from unnest(array['p_past_due_since', 'p_trial_ends_at', 'p_trial_used_at',
                                             'p_disputed_at', 'p_at', 'p_changed_at']) as k
                   where jsonb_typeof(v_t -> k) not in ('string', 'null')
                      or coalesce((v_t ->> k) !~ c_iso, false)) then
      raise exception 'apply_stripe_event: p.transition is not the arguments of apply_entitlement_transition for this account'
        using errcode = '22023';
    end if;
    begin
      v_t_version := (v_t ->> 'p_expected_version')::integer;
      v_t_state := v_t ->> 'p_state';
      v_t_tier := v_t ->> 'p_tier';
      v_t_past_due_tier := v_t ->> 'p_past_due_tier';
      v_t_past_due_since := (v_t ->> 'p_past_due_since')::timestamptz;
      v_t_trial_variant := v_t ->> 'p_trial_variant';
      v_t_trial_ends_at := (v_t ->> 'p_trial_ends_at')::timestamptz;
      v_t_trial_used_at := (v_t ->> 'p_trial_used_at')::timestamptz;
      v_t_disputed_at := (v_t ->> 'p_disputed_at')::timestamptz;
      v_t_seat_limit := (v_t ->> 'p_seat_limit')::integer;
      v_t_site_limit := (v_t ->> 'p_site_limit')::integer;
      v_t_competitor_limit := (v_t ->> 'p_competitor_limit')::integer;
      v_t_at := (v_t ->> 'p_at')::timestamptz;
      v_t_subscription_id := v_t ->> 'p_subscription_id';
      v_t_changed_at := (v_t ->> 'p_changed_at')::timestamptz;
    exception when others then
      raise exception 'apply_stripe_event: a value of p.transition does not read as its type'
        using errcode = '22023';
    end;
  end if;

  -- ── 1. the ledger row ──
  select e.handled, e.handled_reason, e.effects, e.processed_at
    into v_prior_handled, v_prior_reason, v_prior_effects, v_prior_processed
    from public.stripe_events e
   where e.id = v_event_id
     for update of e;
  if not found then
    raise exception 'apply_stripe_event: stripe event % is not in the ledger', v_event_id
      using errcode = 'P0002';
  end if;
  if v_prior_handled is not null or v_prior_processed is not null then
    return jsonb_build_object(
      'decided', true,
      'handled', v_prior_handled,
      'reason', v_prior_reason,
      'effects', coalesce(v_prior_effects, '[]'::jsonb),
      'version', (select a.entitlement_version from public.accounts a where a.id = v_account));
  end if;

  -- ── 2. the subscription row and the out-of-order guard ──
  if v_sub is not null then
    if v_m is not null then
      insert into public.subscriptions (id, account_id, status, plan, interval, seat_quantity,
                                        extra_site_quantity, current_period_end, trial_end,
                                        cancel_at_period_end, canceled_at, ended_at, price_ids)
      values (v_sub_id, v_account, v_m_status, v_m_plan, v_m_interval, v_m_seats, v_m_sites,
              v_m_period_end, v_m_trial_end, v_m_cancel, v_m_canceled_at, v_m_ended_at, v_m_prices)
      on conflict (id) do nothing;
    end if;
    select s.account_id, s.last_event_created, s.status
      into v_sub_account, v_sub_last, v_sub_status
      from public.subscriptions s
     where s.id = v_sub_id
       for update of s;
    v_sub_found := found;
    if v_sub_found and v_sub_account <> v_account then
      raise exception 'apply_stripe_event: subscription % belongs to another account', v_sub_id
        using errcode = '23514';
    end if;
    if v_sub_found and (
         (v_gated and v_created < v_sub_last)
         or (v_sub_status in ('canceled', 'incomplete_expired')
             and v_m_status not in ('canceled', 'incomplete_expired'))) then
      v_reason := case when v_gated and v_created < v_sub_last then c_older else c_ended end;
      update public.stripe_events
         set account_id = v_account, handled = false, handled_reason = v_reason, effects = '[]'::jsonb
       where id = v_event_id;
      return jsonb_build_object(
        'decided', false,
        'handled', false,
        'reason', v_reason,
        'effects', '[]'::jsonb,
        'version', (select a.entitlement_version from public.accounts a where a.id = v_account));
    end if;
    if v_sub_found and v_created < v_sub_last then
      -- Not gated, and older than the mark: the stored mirror is the newer read.
      v_m := null;
      v_m_status := null; v_m_plan := null; v_m_interval := null; v_m_seats := null;
      v_m_sites := null; v_m_cancel := null; v_m_prices := null;
    end if;
  end if;

  -- ── 3. the account: the version, the binding, the transition ──
  if v_t is not null or v_expected is not null or v_customer is not null then
    select a.entitlement_version, a.stripe_customer_id
      into v_version, v_bound
      from public.accounts a
     where a.id = v_account
       for update of a;
    if not found then
      raise exception 'apply_stripe_event: account % not found', v_account using errcode = 'P0002';
    end if;
    if v_expected is not null and v_version <> v_expected then
      raise exception 'entitlement: account % is at version %, expected %',
        v_account, v_version, v_expected using errcode = '40001';
    end if;
    if v_customer is not null then
      if v_bound is null then
        update public.accounts set stripe_customer_id = v_customer, updated_at = now()
         where id = v_account;
      elsif v_bound <> v_customer then
        raise exception 'apply_stripe_event: account % is bound to another customer', v_account
          using errcode = '23505';
      end if;
    end if;
    if v_t is not null then
      v_version := public.apply_entitlement_transition(
        v_account, v_t_version, v_t_state, v_t_tier, v_t_past_due_tier, v_t_past_due_since,
        v_t_trial_variant, v_t_trial_ends_at, v_t_trial_used_at, v_t_disputed_at, v_t_seat_limit,
        v_t_site_limit, v_t_competitor_limit, v_t_at, v_t_subscription_id, v_t_changed_at);
    end if;
  end if;

  -- ── 4. the mirror and the guard's mark ──
  if v_sub_found then
    update public.subscriptions s
       set status = coalesce(v_m_status, s.status),
           plan = coalesce(v_m_plan, s.plan),
           interval = coalesce(v_m_interval, s.interval),
           seat_quantity = coalesce(v_m_seats, s.seat_quantity),
           extra_site_quantity = coalesce(v_m_sites, s.extra_site_quantity),
           current_period_end = case when v_m is null then s.current_period_end else v_m_period_end end,
           trial_end = case when v_m is null then s.trial_end else v_m_trial_end end,
           cancel_at_period_end = coalesce(v_m_cancel, s.cancel_at_period_end),
           canceled_at = case when v_m is null then s.canceled_at else v_m_canceled_at end,
           ended_at = case when v_m is null then s.ended_at else v_m_ended_at end,
           price_ids = coalesce(v_m_prices, s.price_ids),
           last_event_id = case when s.last_event_created is null or v_created >= s.last_event_created
                                then v_event_id else s.last_event_id end,
           last_event_created = greatest(s.last_event_created, v_created),
           updated_at = now()
     where s.id = v_sub_id;
  end if;

  -- ── 5. the decision ──
  update public.stripe_events
     set account_id = v_account, handled = v_handled, handled_reason = v_reason, effects = v_effects
   where id = v_event_id;
  return jsonb_build_object(
    'decided', false,
    'handled', v_handled,
    'reason', v_reason,
    'effects', v_effects,
    'version', (select a.entitlement_version from public.accounts a where a.id = v_account));
end;
$$;

alter function public.apply_stripe_event(jsonb) owner to postgres;
revoke all on function public.apply_stripe_event(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_stripe_event(jsonb) to service_role;
