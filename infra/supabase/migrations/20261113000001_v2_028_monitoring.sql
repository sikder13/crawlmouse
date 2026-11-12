-- v2 migration 028 (CC-28): the mailer's send ledger and suppressions, the scheduler's clock and
-- claim, the alert and summary records, and their place in the erasure. Spec:
-- docs/specs/v2/28-monitoring.md.
--
-- What changes for existing readers. Three tables are added (email_sends, email_suppressions,
-- slack_sends); no client role holds a privilege on them and service_role may only read them (the
-- functions here write them). Columns are added to seats (email_weekly_summary) and alert_events
-- (reason); authenticated may read each, as it reads the columns beside them (001, 003).
-- sites.next_check_at gains two writers: a trigger on sites and one on accounts (section B). erase_rules (027b) is redefined
-- with two more rules and the accounts rule renumbered after them (section D). No foreign key added
-- here cascades: the new tables name an account with ON DELETE SET NULL, and the erasure deletes
-- their rows before the accounts go.
--
-- Every function is owned by postgres and revoked from every client role; each section names the
-- role it is granted to. Definer functions set search_path = pg_catalog, pg_temp and name every
-- other object with its schema.
--
-- Every statement is re-runnable (the tests apply the file twice). The revert is
-- infra/supabase/rollbacks/20261113000001_v2_028_monitoring.revert.sql.

-- ═══ A: the mailer's ledger and suppressions (D1, D7) ═════════════════════════════════════════════
-- Granted to service_role: claim_email_send, finish_email_send, record_email_suppression,
-- email_address_suppressed, account_link_recipient. Tests: apps/web/__tests__/v2-028-mail.test.ts; the claim race,
-- scripts/db/monitoring-race.test.ts.

-- One row per message the mailer means to send, keyed by the caller's idempotency key. It holds no
-- address and no body: `address_hash` is HMAC-SHA256 of the normalised address under the app's
-- pepper (apps/web/lib/v2/mail/address-hash.ts), which this database never sees.
create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  kind text not null check (kind in ('check_notify', 'fix_to_developer', 'trial_reminder',
                                     'email_change_confirm', 'email_change_notice', 'account_delete',
                                     'alert', 'weekly_summary')),
  address_hash text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid references public.accounts (id) on delete set null,
  status text not null check (status in ('sending', 'sent', 'failed', 'suppressed')),
  attempts smallint not null check (attempts between 0 and 3),
  provider_message_id text check (length(provider_message_id) <= 200),
  error_code text check (error_code ~ '^[a-z0-9_]{1,40}$'),
  claimed_at timestamptz not null,
  sent_at timestamptz,
  updated_at timestamptz not null,
  constraint email_sends_sent check ((status = 'sent') = (sent_at is not null)),
  constraint email_sends_suppressed check ((status = 'suppressed') = (attempts = 0))
);
create index if not exists email_sends_account_idx on public.email_sends (account_id);
create index if not exists email_sends_address_idx on public.email_sends (address_hash);
create index if not exists email_sends_provider_idx on public.email_sends (provider_message_id);
alter table public.email_sends enable row level security;
revoke all on public.email_sends from public, anon, authenticated, service_role;
grant select on public.email_sends to service_role;

-- An address that hard-bounced or complained (the Resend webhook). Mail that is not account mail is
-- not sent to it again.
create table if not exists public.email_suppressions (
  address_hash text primary key check (address_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('hard_bounce', 'complaint')),
  first_at timestamptz not null,
  last_at timestamptz not null,
  constraint email_suppressions_order check (last_at >= first_at)
);
alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from public, anon, authenticated, service_role;
grant select on public.email_suppressions to service_role;

-- The kinds a suppression stops: everything but account mail (D7).
create or replace function public.email_kind_suppressible(p_kind text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_kind in ('check_notify', 'fix_to_developer', 'alert', 'weekly_summary');
$$;

-- The claim, made before the send. Answers, as jsonb:
--   {"outcome": "go", "attempt": n}  send now; this is attempt n (1 to 3)
--   {"outcome": "done"}              the key was sent
--   {"outcome": "busy"}              another worker claimed it under 2 minutes ago
--   {"outcome": "suppressed"}        the address is suppressed for this kind; recorded, never sent.
--                                    Read on every claim of a key not yet sent, so a retry after a
--                                    bounce recorded since the first attempt is not sent either; the
--                                    row is then `failed` with error_code `suppressed`.
--   {"outcome": "exhausted"}         three attempts failed; nothing more is tried
-- A row whose claim is older than 2 minutes and still `sending` is taken to be a worker that died
-- mid-send and may be claimed again; the transport sends the key as Resend's Idempotency-Key, so a
-- send that did go out is not repeated within Resend's 24 hours. Two calls with one key in two
-- transactions: the second waits on the first's insert and then answers busy or done.
create or replace function public.claim_email_send(p_key text, p_kind text, p_hash text,
                                                   p_account uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v public.email_sends%rowtype;
begin
  if p_key is null or p_kind is null or p_hash is null or p_now is null then
    raise exception 'claim_email_send: key, kind, hash and time are required' using errcode = '22023';
  end if;
  if public.email_kind_suppressible(p_kind)
     and exists (select 1 from public.email_suppressions s where s.address_hash = p_hash) then
    insert into public.email_sends (idempotency_key, kind, address_hash, account_id, status, attempts,
                                    claimed_at, updated_at)
    values (p_key, p_kind, p_hash, p_account, 'suppressed', 0, p_now, p_now)
    on conflict (idempotency_key) do nothing;
    if found then
      return pg_catalog.jsonb_build_object('outcome', 'suppressed');
    end if;
  else
    insert into public.email_sends (idempotency_key, kind, address_hash, account_id, status, attempts,
                                    claimed_at, updated_at)
    values (p_key, p_kind, p_hash, p_account, 'sending', 1, p_now, p_now)
    on conflict (idempotency_key) do nothing;
    if found then
      return pg_catalog.jsonb_build_object('outcome', 'go', 'attempt', 1);
    end if;
  end if;

  select * into v from public.email_sends e where e.idempotency_key = p_key for update;
  if v.kind <> p_kind then
    raise exception 'claim_email_send: key % names a % message', p_key, v.kind using errcode = '22023';
  end if;
  if v.status = 'sent' then
    return pg_catalog.jsonb_build_object('outcome', 'done');
  elsif v.status = 'suppressed' then
    return pg_catalog.jsonb_build_object('outcome', 'suppressed');
  elsif v.status = 'sending' and v.claimed_at > p_now - interval '2 minutes' then
    return pg_catalog.jsonb_build_object('outcome', 'busy');
  elsif public.email_kind_suppressible(v.kind)
        and exists (select 1 from public.email_suppressions s where s.address_hash = p_hash) then
    update public.email_sends e set status = 'failed', error_code = 'suppressed', updated_at = p_now
     where e.id = v.id;
    return pg_catalog.jsonb_build_object('outcome', 'suppressed');
  elsif v.attempts >= 3 then
    update public.email_sends e set status = 'failed', updated_at = p_now
     where e.id = v.id and e.status <> 'failed';
    return pg_catalog.jsonb_build_object('outcome', 'exhausted');
  end if;
  update public.email_sends e
     set status = 'sending', attempts = e.attempts + 1, claimed_at = p_now, error_code = null,
         updated_at = p_now
   where e.id = v.id;
  return pg_catalog.jsonb_build_object('outcome', 'go', 'attempt', v.attempts + 1);
end;
$$;

-- The send's result, for a key that is `sending`. True when it recorded it.
create or replace function public.finish_email_send(p_key text, p_status text, p_provider_id text,
                                                    p_error text, p_now timestamptz)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_status not in ('sent', 'failed') or p_now is null then
    raise exception 'finish_email_send: status is sent or failed' using errcode = '22023';
  end if;
  update public.email_sends e
     set status = p_status,
         provider_message_id = case when p_status = 'sent' then p_provider_id else e.provider_message_id end,
         error_code = case when p_status = 'failed' then p_error else null end,
         sent_at = case when p_status = 'sent' then p_now else null end,
         updated_at = p_now
   where e.idempotency_key = p_key and e.status = 'sending';
  return found;
end;
$$;

-- A hard bounce or a complaint. A complaint outranks a bounce; the first time stays.
create or replace function public.record_email_suppression(p_hash text, p_reason text, p_now timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_reason not in ('hard_bounce', 'complaint') or p_now is null then
    raise exception 'record_email_suppression: reason is hard_bounce or complaint' using errcode = '22023';
  end if;
  insert into public.email_suppressions as s (address_hash, reason, first_at, last_at)
  values (p_hash, p_reason, p_now, p_now)
  on conflict (address_hash) do update
    set reason = case when s.reason = 'complaint' or excluded.reason = 'complaint' then 'complaint'
                      else 'hard_bounce' end,
        last_at = greatest(s.last_at, excluded.last_at);
end;
$$;

-- What Settings shows: whether mail to this address hash is suppressed, and why.
create or replace function public.email_address_suppressed(p_hash text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select s.reason from public.email_suppressions s where s.address_hash = p_hash;
$$;

-- Who an account email goes to, read without minting its link (027b's issue_account_link mints, and a
-- second mint replaces the first token). The mailer claims on this recipient's hash and mints only
-- after the claim answers go, so a replayed event cannot invalidate a link already delivered. A row
-- that is expired, used or revoked answers no row, as issue_account_link does.
create or replace function public.account_link_recipient(p_token uuid)
returns table (kind text, recipient text)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select t.kind,
         case t.kind when 'email_change' then t.new_email
                     when 'email_change_undo' then t.old_email
                     else t.recipient end
    from public.account_tokens t
   where t.id = p_token and t.used_at is null and t.revoked_at is null
     and t.expires_at > pg_catalog.now();
$$;

revoke all on function public.email_kind_suppressible(text) from public, anon, authenticated;
revoke all on function public.account_link_recipient(uuid) from public, anon, authenticated;
revoke all on function public.claim_email_send(text, text, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.finish_email_send(text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.record_email_suppression(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.email_address_suppressed(text) from public, anon, authenticated;
grant execute on function public.email_kind_suppressible(text) to service_role;
grant execute on function public.claim_email_send(text, text, text, uuid, timestamptz) to service_role;
grant execute on function public.finish_email_send(text, text, text, text, timestamptz) to service_role;
grant execute on function public.record_email_suppression(text, text, timestamptz) to service_role;
grant execute on function public.email_address_suppressed(text) to service_role;
grant execute on function public.account_link_recipient(uuid) to service_role;

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: the scheduler (D4) ════════════════════════════════════════════════════════════════════════
-- Granted to service_role: account_effective_tier, next_check_after, claim_due_sites,
-- release_scheduled_claim. The trigger
-- functions to no role. Tests: apps/web/__tests__/v2-028-schedule.test.ts; two ticks racing,
-- scripts/db/monitoring-race.test.ts.

-- The tier an account has at p_now, as effectiveTier() in apps/web/lib/entitlement-v2.ts computes it
-- (and alert_rules_entitlement_check, 003, inline): a no-card Pro trial is Free from trial_ends_at,
-- and past_due keeps past_due_tier for 168 hours from past_due_since. Null for no such account.
create or replace function public.account_effective_tier(p_account uuid, p_now timestamptz)
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case
           when a.state = 'pro_trial' and a.trial_variant = 'no_card'
             then case when p_now < a.trial_ends_at then a.tier else 'free' end
           when a.state = 'past_due'
             then case when p_now < a.past_due_since + interval '168 hours' then a.past_due_tier else 'free' end
           else a.tier
         end
    from public.accounts a
   where a.id = p_account;
$$;

-- The first time after p_after that a schedule falls due, in zone p_tz (UTC when Postgres does not
-- know the name). weekly: the next p_weekday (ISO, 1 = Monday) at p_hour:p_offset local. monthly: the
-- first p_weekday of a month at that time (types: Site.schedule, "monthly, first Mon"). Null for
-- on_deploy, an incomplete schedule, or a weekday, hour or minute out of range (the sites CHECKs then
-- refuse the row). A local time the clocks skip (the spring gap) is read as Postgres reads it, an
-- hour later; a local time that occurs twice (the autumn repeat) is read as its later instant. Both
-- are pinned for America/New_York and Europe/London in apps/web/__tests__/v2-028-schedule.test.ts.
create or replace function public.next_check_after(p_cadence text, p_weekday smallint, p_hour smallint,
                                                   p_offset smallint, p_tz text, p_after timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tz text := coalesce(p_tz, 'UTC');
  v_local timestamp;
  v_day date;
  v_month date;
  v_at interval;
  v_candidate timestamptz;
  i integer;
begin
  if p_cadence is null or p_cadence not in ('weekly', 'monthly') or p_weekday is null or p_hour is null
     or p_after is null or p_weekday not between 1 and 7 or p_hour not between 0 and 23
     or coalesce(p_offset, 0) not between 0 and 59 then
    return null;
  end if;
  begin
    v_local := p_after at time zone v_tz;
  exception when invalid_parameter_value then
    v_tz := 'UTC';
    v_local := p_after at time zone v_tz;
  end;
  v_at := pg_catalog.make_interval(hours => p_hour, mins => coalesce(p_offset, 0));
  if p_cadence = 'weekly' then
    -- Today counts when the time is still ahead; eight days covers today's time having passed.
    for i in 0..7 loop
      v_day := v_local::date + i;
      continue when extract(isodow from v_day) <> p_weekday;
      v_candidate := (v_day + v_at) at time zone v_tz;
      if v_candidate > p_after then
        return v_candidate;
      end if;
    end loop;
  else
    v_month := pg_catalog.date_trunc('month', v_local)::date;
    for i in 0..2 loop
      v_day := (v_month + pg_catalog.make_interval(months => i))::date;
      v_day := v_day + ((p_weekday - extract(isodow from v_day)::integer + 7) % 7);
      v_candidate := (v_day + v_at) at time zone v_tz;
      if v_candidate > p_after then
        return v_candidate;
      end if;
    end loop;
  end if;
  raise exception 'next_check_after: no time found' using errcode = 'P0001';
end;
$$;

-- A kept site's next scheduled check, set whenever what it depends on changes, by every writer.
-- Cleared for an unkept, removed or on_deploy site and a site with no schedule. An update that
-- changes none of the schedule, account_id or removed_at leaves next_check_at as the writer set it,
-- which is how claim_due_sites advances it. A missing schedule_offset_min is filled from the site id
-- (0–59), so a site's checks keep one minute of the hour.
create or replace function public.sites_schedule_next()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.schedule_cadence is not distinct from old.schedule_cadence
     and new.schedule_iso_weekday is not distinct from old.schedule_iso_weekday
     and new.schedule_hour_local is not distinct from old.schedule_hour_local
     and new.schedule_offset_min is not distinct from old.schedule_offset_min
     and new.account_id is not distinct from old.account_id
     and new.removed_at is not distinct from old.removed_at then
    return new;
  end if;
  if new.account_id is null or new.removed_at is not null or new.schedule_cadence is null
     or new.schedule_cadence = 'on_deploy' then
    new.next_check_at := null;
    return new;
  end if;
  if new.schedule_offset_min is null then
    new.schedule_offset_min := (('x' || substr(md5(new.id::text), 1, 8))::bit(32)::bigint % 60)::smallint;
  end if;
  new.next_check_at := public.next_check_after(
    new.schedule_cadence, new.schedule_iso_weekday, new.schedule_hour_local, new.schedule_offset_min,
    (select a.timezone from public.accounts a where a.id = new.account_id), pg_catalog.now());
  return new;
end;
$$;
drop trigger if exists sites_schedule_next on public.sites;
create trigger sites_schedule_next before insert or update on public.sites
  for each row execute function public.sites_schedule_next();

-- An account's zone moves its sites' next checks.
create or replace function public.accounts_timezone_reschedule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  update public.sites s
     set next_check_at = public.next_check_after(s.schedule_cadence, s.schedule_iso_weekday,
                                                 s.schedule_hour_local, s.schedule_offset_min,
                                                 new.timezone, pg_catalog.now())
   where s.account_id = new.id and s.next_check_at is not null;
  return null;
end;
$$;
drop trigger if exists accounts_timezone_reschedule on public.accounts;
create trigger accounts_timezone_reschedule after update of timezone on public.accounts
  for each row when (old.timezone is distinct from new.timezone)
  execute function public.accounts_timezone_reschedule();

-- The sites due at p_now, claimed. Due: kept, not removed, not paused, cadence weekly or monthly,
-- next_check_at at or before p_now; the account neither deleted nor marked for deletion; and the
-- account's tier at p_now allows it: a paid tier, any of its sites; Free, its first live primary site
-- in apply_entitlement_transition's order (003: created_at to the millisecond, then id), checked
-- monthly whatever its saved cadence (questions Q4). The transition already pauses a downgraded
-- account's other sites and moves the first to monthly; this filter holds without it.
-- At most p_limit sites, oldest due first, rows another transaction holds skipped. For each, a slot of
-- the platform's daily ceiling is taken (p_global, as take_rate_slot takes it) in a block rolled back
-- when refused; a refused slot ends the claim, leaving that site and the rest due. A claimed site's
-- next_check_at moves past p_now in the same statement. Returns each claimed site with the slot it
-- was due at, which keys its request (apps/web/lib/v2/pipeline/ids.ts).
create or replace function public.claim_due_sites(p_now timestamptz, p_limit integer, p_global jsonb)
returns table (site_id uuid, account_id uuid, slot timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v record;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'claim_due_sites: p_now and a p_limit of 1 to 500 are required' using errcode = '22023';
  end if;
  for v in
    select s.id, s.account_id, s.next_check_at, s.schedule_cadence, s.schedule_iso_weekday,
           s.schedule_hour_local, s.schedule_offset_min, a.timezone,
           public.account_effective_tier(a.id, p_now) as tier
      from public.sites s
      join public.accounts a on a.id = s.account_id
     where s.next_check_at <= p_now
       and s.removed_at is null
       and s.paused_reason is null
       and s.schedule_cadence in ('weekly', 'monthly')
       and a.deleted_at is null
       and a.deletion_confirmed_at is null
       and (public.account_effective_tier(a.id, p_now) in ('pro', 'agency')
            or s.id = (select f.id from public.sites f
                        where f.account_id = a.id and f.removed_at is null
                          and f.staging_of_site_id is null
                        order by pg_catalog.date_trunc('milliseconds', f.created_at), f.id
                        limit 1))
     order by s.next_check_at, s.id
     limit p_limit
       for update of s skip locked
  loop
    begin
      if not public.take_rate_slot(p_global) then
        raise exception 'claim_due_sites: the daily ceiling is reached' using errcode = 'CMCAP';
      end if;
    exception when sqlstate 'CMCAP' then
      return;
    end;
    update public.sites s
       set next_check_at = public.next_check_after(
             case when v.tier in ('pro', 'agency') then v.schedule_cadence else 'monthly' end,
             v.schedule_iso_weekday, v.schedule_hour_local, v.schedule_offset_min, v.timezone,
             greatest(v.next_check_at, p_now))
     where s.id = v.id;
    site_id := v.id;
    account_id := v.account_id;
    slot := v.next_check_at;
    return next;
  end loop;
end;
$$;

-- Undoes one claim whose request never reached the pipeline (owner ruling Q9): the scheduler's
-- onFailure calls it when the request step has failed every retry. In one transaction, with the site
-- row locked: when next_check_at is still past p_slot (the claim's advance, not a later save that
-- moved it back, and not an earlier call of this function), it is set back to p_slot, so the next tick
-- claims the site again; and in that case only, the slot the claim took is given back, when p_global's
-- window (24 hours from its window_start, the global:audits:day bucket) has not ended at p_now. The
-- give-back takes one from that bucket row, never below zero. Calling it twice gives back one slot.
-- Returns {"restored": bool, "slot_released": bool}.
create or replace function public.release_scheduled_claim(p_site uuid, p_slot timestamptz, p_global jsonb,
                                                          p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_next timestamptz;
  v_window timestamptz;
  v_released boolean := false;
begin
  if p_site is null or p_slot is null or p_now is null
     or pg_catalog.jsonb_typeof(p_global -> 'bucket') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_global -> 'window_start') is distinct from 'string' then
    raise exception 'release_scheduled_claim: site, slot, time and a {bucket, window_start} are required'
      using errcode = '22023';
  end if;
  select s.next_check_at into v_next from public.sites s where s.id = p_site for update;
  if v_next is null or v_next <= p_slot then
    return pg_catalog.jsonb_build_object('restored', false, 'slot_released', false);
  end if;
  update public.sites s set next_check_at = p_slot where s.id = p_site;
  v_window := (p_global ->> 'window_start')::timestamptz;
  if p_now < v_window + interval '24 hours' then
    update public.rate_limits r set request_count = r.request_count - 1
     where r.bucket_key = p_global ->> 'bucket' and r.window_start = v_window and r.request_count > 0;
    v_released := found;
  end if;
  return pg_catalog.jsonb_build_object('restored', true, 'slot_released', v_released);
end;
$$;

revoke all on function public.account_effective_tier(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.release_scheduled_claim(uuid, timestamptz, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.next_check_after(text, smallint, smallint, smallint, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.sites_schedule_next() from public, anon, authenticated, service_role;
revoke all on function public.accounts_timezone_reschedule() from public, anon, authenticated, service_role;
revoke all on function public.claim_due_sites(timestamptz, integer, jsonb) from public, anon, authenticated;
grant execute on function public.account_effective_tier(uuid, timestamptz) to service_role;
grant execute on function public.next_check_after(text, smallint, smallint, smallint, text, timestamptz)
  to service_role;
grant execute on function public.claim_due_sites(timestamptz, integer, jsonb) to service_role;
grant execute on function public.release_scheduled_claim(uuid, timestamptz, jsonb, timestamptz) to service_role;

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ C: alerts, Slack and the weekly summary (D5, D6, D7) ═════════════════════════════════════════
-- Granted to service_role: claim_slack_send, finish_slack_send, account_slack_webhook_url,
-- seed_default_alert_rules, alert_email_recipients, summary_recipients, record_alert_delivery,
-- due_summary_accounts, unsubscribe_seat. Tests: apps/web/__tests__/v2-028-alerts.test.ts.

-- A seat's weekly summary switch (D6, D7); the unsubscribe link turns it off.
alter table public.seats add column if not exists email_weekly_summary boolean not null default true;
grant select (email_weekly_summary) on public.seats to authenticated;

-- Why an alert was not sent on a channel; null when it was.
alter table public.alert_events add column if not exists reason text;
grant select (reason) on public.alert_events to authenticated;
alter table public.alert_events drop constraint if exists alert_events_reason;
alter table public.alert_events add constraint alert_events_reason check (
  (status = 'sent') = (reason is null) and (reason is null or reason ~ '^[a-z0-9_]{1,40}$'));

-- The Slack side of the ledger: one row per Slack message, with the email ledger's claim rule (2
-- minutes, three attempts). Slack's incoming webhooks take no idempotency key, so a worker that dies
-- between the POST and finish_slack_send can repeat that one message when the claim is retaken.
create table if not exists public.slack_sends (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  account_id uuid references public.accounts (id) on delete set null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  attempts smallint not null check (attempts between 1 and 3),
  error_code text check (error_code ~ '^[a-z0-9_]{1,40}$'),
  claimed_at timestamptz not null,
  sent_at timestamptz,
  updated_at timestamptz not null,
  constraint slack_sends_sent check ((status = 'sent') = (sent_at is not null))
);
create index if not exists slack_sends_account_idx on public.slack_sends (account_id);
alter table public.slack_sends enable row level security;
revoke all on public.slack_sends from public, anon, authenticated, service_role;
grant select on public.slack_sends to service_role;

create or replace function public.claim_slack_send(p_key text, p_account uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v public.slack_sends%rowtype;
begin
  if p_key is null or p_now is null then
    raise exception 'claim_slack_send: key and time are required' using errcode = '22023';
  end if;
  insert into public.slack_sends (idempotency_key, account_id, status, attempts, claimed_at, updated_at)
  values (p_key, p_account, 'sending', 1, p_now, p_now)
  on conflict (idempotency_key) do nothing;
  if found then
    return pg_catalog.jsonb_build_object('outcome', 'go', 'attempt', 1);
  end if;
  select * into v from public.slack_sends e where e.idempotency_key = p_key for update;
  if v.status = 'sent' then
    return pg_catalog.jsonb_build_object('outcome', 'done');
  elsif v.status = 'sending' and v.claimed_at > p_now - interval '2 minutes' then
    return pg_catalog.jsonb_build_object('outcome', 'busy');
  elsif v.attempts >= 3 then
    update public.slack_sends e set status = 'failed', updated_at = p_now
     where e.id = v.id and e.status <> 'failed';
    return pg_catalog.jsonb_build_object('outcome', 'exhausted');
  end if;
  update public.slack_sends e
     set status = 'sending', attempts = e.attempts + 1, claimed_at = p_now, error_code = null,
         updated_at = p_now
   where e.id = v.id;
  return pg_catalog.jsonb_build_object('outcome', 'go', 'attempt', v.attempts + 1);
end;
$$;

create or replace function public.finish_slack_send(p_key text, p_status text, p_error text,
                                                    p_now timestamptz)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_status not in ('sent', 'failed') or p_now is null then
    raise exception 'finish_slack_send: status is sent or failed' using errcode = '22023';
  end if;
  update public.slack_sends e
     set status = p_status,
         error_code = case when p_status = 'failed' then p_error else null end,
         sent_at = case when p_status = 'sent' then p_now else null end,
         updated_at = p_now
   where e.idempotency_key = p_key and e.status = 'sending';
  return found;
end;
$$;

-- The account's Slack incoming-webhook URL (027b's Vault secret), for the alert being sent and for
-- nothing else; null when none is set or the account's tier at p_now has no Slack. Read here, at
-- send time, so a downgrade stops Slack without touching the rules (003's note on alertFn).
create or replace function public.account_slack_webhook_url(p_account uuid, p_now timestamptz)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select s.decrypted_secret
    from public.account_slack_destinations d
    join vault.decrypted_secrets s on s.id = d.vault_secret_id
   where d.account_id = p_account
     and public.account_effective_tier(p_account, p_now) in ('pro', 'agency');
$$;

-- Who receives an account's alert email: each active seat with a user whose alert_channels hold
-- email, while the account's change notes are on and it is not deleted or marked for deletion.
create or replace function public.alert_email_recipients(p_account uuid)
returns table (seat_id uuid, email text)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select st.id, u.email
    from public.seats st
    join public.users u on u.id = st.user_id
    join public.accounts a on a.id = st.account_id
   where st.account_id = p_account and st.status = 'active' and 'email' = any (st.alert_channels)
     and a.email_change_notes and a.deleted_at is null and a.deletion_confirmed_at is null
   order by st.created_at, st.id;
$$;

-- Who receives an account's weekly summary: each active seat with a user and the summary on.
create or replace function public.summary_recipients(p_account uuid)
returns table (seat_id uuid, email text)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select st.id, u.email
    from public.seats st
    join public.users u on u.id = st.user_id
    join public.accounts a on a.id = st.account_id
   where st.account_id = p_account and st.status = 'active' and st.email_weekly_summary
     and a.deleted_at is null and a.deletion_confirmed_at is null
   order by st.created_at, st.id;
$$;

-- One channel's outcome for one check's alert, in one transaction (a retry replaces the row, on 003's alert_events_rule_check_channel_uq). p: exactly the keys check_id,
-- site_id, channel, status, reason, destination_hash, provider_message_id, slack_channel, sent_at and
-- rules, an array of {rule_id, change_ids}. Every change named must be one of the check's changes, and
-- every rule one of the site's account's rules for that site or the whole account; otherwise 22023
-- and nothing is written. Writes one alert_events row per rule (a retry replaces it). When the status
-- is sent: each rule's last_fired_* moves to this check unless it already names a later send, and each
-- change's `notified` gains the channel ({channels, slack_channel, sent_at}, the shape the Alerts and
-- Changes views read; the first sent_at stays).
create or replace function public.record_alert_delivery(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_keys constant text[] := array['check_id', 'site_id', 'channel', 'status', 'reason',
                                  'destination_hash', 'provider_message_id', 'slack_channel', 'sent_at',
                                  'rules'];
  v_given text[];
  v_check uuid;
  v_site uuid;
  v_account uuid;
  v_channel text;
  v_status text;
  v_at timestamptz;
  v_rule jsonb;
  v_changes uuid[];
  v_all uuid[] := '{}';
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object' then
    raise exception 'record_alert_delivery: p is not an object' using errcode = '22023';
  end if;
  v_given := array(select pg_catalog.jsonb_object_keys(p));
  if not (v_given @> v_keys and v_given <@ v_keys)
     or pg_catalog.jsonb_typeof(p -> 'rules') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p -> 'rules') = 0 then
    raise exception 'record_alert_delivery: p is not a delivery' using errcode = '22023';
  end if;
  v_check := (p ->> 'check_id')::uuid;
  v_site := (p ->> 'site_id')::uuid;
  v_channel := p ->> 'channel';
  v_status := p ->> 'status';
  v_at := (p ->> 'sent_at')::timestamptz;
  select s.account_id into v_account from public.sites s where s.id = v_site;
  if v_account is null
     or not exists (select 1 from public.checks c where c.id = v_check and c.site_id = v_site) then
    raise exception 'record_alert_delivery: no check % of a kept site %', v_check, v_site
      using errcode = '22023';
  end if;

  for v_rule in select * from pg_catalog.jsonb_array_elements(p -> 'rules') loop
    v_changes := array(select pg_catalog.jsonb_array_elements_text(v_rule -> 'change_ids')::uuid);
    if not exists (select 1 from public.alert_rules r
                    where r.id = (v_rule ->> 'rule_id')::uuid and r.account_id = v_account
                      and (r.site_id is null or r.site_id = v_site))
       or exists (select 1 from unnest(v_changes) c(id)
                   where not exists (select 1 from public.changes x
                                      where x.id = c.id and x.check_id = v_check and x.site_id = v_site)) then
      raise exception 'record_alert_delivery: a rule or change is not this check''s' using errcode = '22023';
    end if;
    insert into public.alert_events as e (rule_id, site_id, check_id, change_ids, channel,
                                          destination_hash, provider_message_id, status, reason, sent_at)
    values ((v_rule ->> 'rule_id')::uuid, v_site, v_check, v_changes, v_channel,
            p ->> 'destination_hash', p ->> 'provider_message_id', v_status, p ->> 'reason', v_at)
    on conflict (check_id, rule_id, channel) do update
      set change_ids = excluded.change_ids, destination_hash = excluded.destination_hash,
          provider_message_id = excluded.provider_message_id, status = excluded.status,
          reason = excluded.reason, sent_at = excluded.sent_at;
    v_all := v_all || v_changes;
  end loop;

  if v_status = 'sent' then
    update public.alert_rules r
       set last_fired_at = v_at, last_fired_check_id = v_check
     where r.id in (select (x ->> 'rule_id')::uuid from pg_catalog.jsonb_array_elements(p -> 'rules') x)
       and (r.last_fired_at is null or r.last_fired_at <= v_at);
    update public.changes c
       set notified = pg_catalog.jsonb_build_object(
             'channels', (select pg_catalog.jsonb_agg(ch order by ch)
                            from (select distinct ch
                                    from pg_catalog.jsonb_array_elements_text(
                                           coalesce(c.notified -> 'channels', '[]'::jsonb)
                                           || pg_catalog.to_jsonb(v_channel)) ch) d),
             'slack_channel', coalesce(nullif(c.notified -> 'slack_channel', 'null'::jsonb),
                                       case when v_channel = 'slack' then p -> 'slack_channel' end,
                                       'null'::jsonb),
             'sent_at', coalesce(c.notified -> 'sent_at', pg_catalog.to_jsonb(
                          pg_catalog.to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
     where c.id = any (v_all) and c.check_id = v_check;
  end if;
end;
$$;

-- The accounts whose weekly summary is due in the hour holding p_now: a paid tier at p_now, not
-- deleted or marked, and Monday 08:00–08:59 in the account's zone. week_key names the ISO week in
-- that zone ("2026-W46"), which keys the summary's sends; week_start is that Monday 00:00 local.
create or replace function public.due_summary_accounts(p_now timestamptz)
returns table (account_id uuid, week_key text, week_start timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select a.id,
         pg_catalog.to_char(p_now at time zone z.tz, 'IYYY-"W"IW'),
         (pg_catalog.date_trunc('week', p_now at time zone z.tz)) at time zone z.tz
    from public.accounts a
    cross join lateral (
      select coalesce((select n.name from pg_catalog.pg_timezone_names n where n.name = a.timezone limit 1),
                      'UTC') as tz) z
   where a.deleted_at is null and a.deletion_confirmed_at is null
     and public.account_effective_tier(a.id, p_now) in ('pro', 'agency')
     and extract(isodow from p_now at time zone z.tz) = 1
     and extract(hour from p_now at time zone z.tz) = 8;
$$;

-- An unsubscribe link's change (D7): `alerts` takes email out of the seat's alert channels,
-- `summary` turns the seat's weekly summary off. Nothing else about the seat or the account changes.
-- True when the seat exists.
create or replace function public.unsubscribe_seat(p_seat uuid, p_kind text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_kind = 'alerts' then
    update public.seats s set alert_channels = pg_catalog.array_remove(s.alert_channels, 'email')
     where s.id = p_seat;
  elsif p_kind = 'summary' then
    update public.seats s set email_weekly_summary = false where s.id = p_seat;
  else
    raise exception 'unsubscribe_seat: kind is alerts or summary' using errcode = '22023';
  end if;
  return found;
end;
$$;

-- Every account starts with the alert rules the product describes (questions Q13): the five that tell
-- you something broke, on, by email; "any change" off; the text drop at 10 points. Email only, because
-- Slack needs a paid tier and a destination, and alert_rules_entitlement_check refuses it on Free. A
-- rule the account already holds of a kind is left as it is (alert_rules_scope_kind_uq), so this can
-- run again. Existing accounts get them from the backfill below; after that, alertFn seeds an
-- account's rules before it reads them, and so does the Alerts page (apps/web/lib/v2/monitor/
-- alerts-store.ts, apps/web/app/alerts/page.tsx). Not a trigger on accounts: a trigger would put rows
-- under every account the signup path makes, before any product step asks for them.
create or replace function public.seed_default_alert_rules(p_account uuid)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
  insert into public.alert_rules (account_id, site_id, kind, enabled, threshold_points, channels)
  select p_account, null, d.kind, d.enabled, d.threshold, array['email']
    from (values ('crawler_blocked', true, null::double precision),
                 ('text_drop', true, 10::double precision),
                 ('grade_letter_moved', true, null::double precision),
                 ('new_orphans', true, null::double precision),
                 ('fix_regressed', true, null::double precision),
                 ('any_change', false, null::double precision)) d(kind, enabled, threshold)
  on conflict do nothing;
$$;

select public.seed_default_alert_rules(a.id)
  from public.accounts a
 where not exists (select 1 from public.alert_rules r where r.account_id = a.id);

revoke all on function public.claim_slack_send(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.seed_default_alert_rules(uuid) from public, anon, authenticated;
revoke all on function public.finish_slack_send(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.account_slack_webhook_url(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.alert_email_recipients(uuid) from public, anon, authenticated;
revoke all on function public.summary_recipients(uuid) from public, anon, authenticated;
revoke all on function public.record_alert_delivery(jsonb) from public, anon, authenticated;
revoke all on function public.due_summary_accounts(timestamptz) from public, anon, authenticated;
revoke all on function public.unsubscribe_seat(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_slack_send(text, uuid, timestamptz) to service_role;
grant execute on function public.seed_default_alert_rules(uuid) to service_role;
grant execute on function public.finish_slack_send(text, text, text, timestamptz) to service_role;
grant execute on function public.account_slack_webhook_url(uuid, timestamptz) to service_role;
grant execute on function public.alert_email_recipients(uuid) to service_role;
grant execute on function public.summary_recipients(uuid) to service_role;
grant execute on function public.record_alert_delivery(jsonb) to service_role;
grant execute on function public.due_summary_accounts(timestamptz) to service_role;
grant execute on function public.unsubscribe_seat(uuid, text) to service_role;

-- ═══ end C ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ D: the erasure (D9) ══════════════════════════════════════════════════════════════════════════
-- erase_rules as 027b defines it, with two rules added before `accounts deleted` (which moves from
-- 32 to 35): the ledgers' rows that name one of the person's accounts. Their account reference is set
-- null when an account goes, so they are deleted first. Rows that name the person only by an address
-- hash are not reachable from SQL (the pepper is the app's); erase_mail_records takes the hashes the
-- app computes (apps/web/lib/v2/account/erase.ts). Suppressions are kept (questions Q2): they are
-- what stops the address being mailed again, and hold a peppered hash only.
-- Granted: erase_mail_records to service_role.

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

-- The rows that name the person by an address hash: the sends to it, counted, and deleted when
-- p_apply; and the suppressions on it, counted and kept. Returns {"email_sends": n,
-- "email_suppressions_kept": m}. Hashes are 64 lower-case hex characters; anything else raises 22023.
create or replace function public.erase_mail_records(p_hashes text[], p_apply boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_sends integer;
  v_kept integer;
begin
  if p_hashes is null or p_apply is null
     or exists (select 1 from unnest(p_hashes) h where h is null or h !~ '^[0-9a-f]{64}$') then
    raise exception 'erase_mail_records: hashes are 64 hex characters' using errcode = '22023';
  end if;
  if p_apply then
    delete from public.email_sends e where e.address_hash = any (p_hashes);
    get diagnostics v_sends = row_count;
  else
    select pg_catalog.count(*)::integer into v_sends
      from public.email_sends e where e.address_hash = any (p_hashes);
  end if;
  select pg_catalog.count(*)::integer into v_kept
    from public.email_suppressions s where s.address_hash = any (p_hashes);
  return pg_catalog.jsonb_build_object('email_sends', v_sends, 'email_suppressions_kept', v_kept);
end;
$$;
revoke all on function public.erase_mail_records(text[], boolean) from public, anon, authenticated;
grant execute on function public.erase_mail_records(text[], boolean) to service_role;

-- ═══ end D ════════════════════════════════════════════════════════════════════════════════════════
