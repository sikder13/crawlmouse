-- Revert of infra/supabase/migrations/20261102000001_v2_003_sites_checks.sql.
--
-- ⚠ Drops the tables 003 creates, with their rows, and frontier.check_id /
-- frontier_politeness.check_id. Take a dump first. Revert 007 and 005 before this file: their
-- objects reference these tables, and this file drops nothing with CASCADE, so it fails rather than
-- take them along.
--
-- Every statement is re-runnable (v2-003-check-tables.test.ts, "the revert runs twice").
-- apply_entitlement_transition is restored to its body in
-- 20261101000001_v2_001_entitlement_tables.sql, character for character.

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
      -- Keep the first entry and the most recent 199.
      v_history := jsonb_build_array(v_history -> 0) || (
        select jsonb_agg(e order by i)
          from jsonb_array_elements(v_history) with ordinality as t (e, i)
         where i > jsonb_array_length(v_history) - 199);
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

drop table if exists public.seat_sites;
drop table if exists public.deploy_hooks;
drop table if exists public.api_keys;
drop table if exists public.share_links;
drop table if exists public.report_schedules;
drop table if exists public.reports;
drop table if exists public.alert_events;
drop table if exists public.alert_rules;
drop table if exists public.evidence_blobs;
drop table if exists public.changes;
drop table if exists public.fix_events;
drop table if exists public.site_fixes;
drop table if exists public.access_tests;
drop table if exists public.link_edges;
drop table if exists public.page_results;

alter table public.frontier_politeness drop column if exists check_id;
alter table public.frontier drop column if exists check_id;

drop table if exists public.checks;
drop table if exists public.sites;

drop function if exists public.is_member_for_site(uuid);
drop function if exists public.alert_events_rule_scope();
drop function if exists public.alert_rules_fired_check_scope();
drop function if exists public.alert_rules_entitlement_check();
drop function if exists public.fix_events_references();
drop function if exists public.fix_events_append_only();
drop function if exists public.link_edges_url_hash();
drop function if exists public.page_results_url_hash();

drop index if exists public.seats_id_account_uq;
alter table public.seats drop constraint if exists seats_owner_unscoped;
alter table public.seats drop column if exists client_scope_all;
