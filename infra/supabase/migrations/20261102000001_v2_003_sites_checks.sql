-- v2 migration 003 (ARCH-2 §6.1): the check-data tables.
--
-- Additive only. It creates sites, checks, page_results, link_edges, access_tests, site_fixes,
-- fix_events, changes, evidence_blobs, alert_rules, alert_events, reports, report_schedules,
-- share_links, api_keys, deploy_hooks and seat_sites; adds seats.client_scope_all and
-- frontier.check_id / frontier_politeness.check_id; creates is_member_for_site(); and replaces
-- apply_entitlement_transition() with a body that also applies the site effects. No existing table,
-- column, policy or grant is dropped or renamed. v1 reads none of the new objects.
--
-- Columns follow the v2 contract (packages/types/src/v2): one column per contract field, of the same
-- name, with nested objects as jsonb. Site.schedule is flattened into schedule_* columns,
-- Site.client_report is report_schedules, and Seat.client_scope is seats.client_scope_all with
-- seat_sites. The CHECKs hold the contract's enums and its row-local rules; the contract guard
-- (apps/web/__tests__/v2-contract-guard.test.ts) compares both with the contract.
--
-- Access. RLS is on for every table created here, and each starts with revoke all from public, anon
-- and authenticated, because production's default privileges give both client roles every privilege
-- on a new table. authenticated then reads through is_member_for_site() (site data) or is_member()
-- (account data), per column. site_fixes, fix_events and share_links have no client grant at all.
-- alert_rules is the one table clients write, through its policies and the
-- alert_rules_entitlement_check trigger.
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261102000001_v2_003_sites_checks.revert.sql.

-- ─── seats: the client scope (Seat.client_scope) ──────────────────────────────────────────────────
-- true is the contract's 'all'; false means the sites in seat_sites. Existing seats keep full access.

alter table public.seats add column if not exists client_scope_all boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.seats'::regclass and conname = 'seats_owner_unscoped') then
    alter table public.seats add constraint seats_owner_unscoped check (role <> 'owner' or client_scope_all);
  end if;
end;
$$;

-- Lets a table pair a seat with the account it belongs to (seat_sites, sites, reports).
create unique index if not exists seats_id_account_uq on public.seats (id, account_id);

-- ─── sites ────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  -- Null for an audit nobody has kept.
  account_id uuid references public.accounts (id) on delete cascade,
  host text not null,
  staging_of_site_id uuid,
  client_name text,
  client_contact_name text,
  client_contact_email text,
  schedule_cadence text check (schedule_cadence in ('weekly', 'monthly', 'on_deploy')),
  schedule_iso_weekday smallint,
  schedule_hour_local smallint,
  -- Database only: why a site is paused. Site.paused is derived from it.
  paused_reason text check (paused_reason in ('trial_ended', 'over_limit', 'user')),
  paused boolean generated always as (paused_reason is not null) stored not null,
  competitor_hosts text[] not null default '{}',
  slack_channel text,
  owner_seat_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Database only: removed sites stay, with their history.
  removed_at timestamptz,
  constraint sites_id_account_uq unique (id, account_id),
  constraint sites_staging_of_account_fkey foreign key (staging_of_site_id, account_id)
    references public.sites (id, account_id) on delete cascade,
  constraint sites_owner_seat_account_fkey foreign key (owner_seat_id, account_id)
    references public.seats (id, account_id) on delete set null (owner_seat_id),
  constraint sites_schedule_complete check (
    schedule_cadence is not null or (schedule_iso_weekday is null and schedule_hour_local is null)),
  constraint sites_schedule_timed check (
    schedule_cadence is null or (schedule_cadence <> 'on_deploy') = (schedule_iso_weekday is not null)),
  constraint sites_schedule_pair check ((schedule_iso_weekday is null) = (schedule_hour_local is null)),
  constraint sites_schedule_weekday check (schedule_iso_weekday between 1 and 7),
  constraint sites_schedule_hour check (schedule_hour_local between 0 and 23),
  constraint sites_unkept_audit check (
    account_id is not null or (schedule_cadence is null and owner_seat_id is null)),
  -- The same-account foreign key above is not checked when account_id is null.
  constraint sites_staging_kept check (account_id is not null or staging_of_site_id is null)
);

create unique index if not exists sites_account_host_uq on public.sites (account_id, host)
  where account_id is not null and removed_at is null;
create index if not exists sites_staging_of_idx on public.sites (staging_of_site_id);
create index if not exists sites_owner_seat_idx on public.sites (owner_seat_id);

-- ─── checks ───────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.checks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  previous_check_id uuid,
  status text not null check (status in ('queued', 'running', 'finished', 'partial', 'failed', 'deferred')),
  trigger text not null check (trigger in ('first_audit', 'manual', 'scheduled', 'deploy', 'fix_recheck')),
  grade_version text not null,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  tested_at timestamptz,
  expires_at timestamptz,
  deferred_until timestamptz,
  failure_reason text,
  result_email jsonb,
  coverage jsonb,
  technical_seo jsonb,
  ai_readability jsonb,
  structure jsonb,
  without_js jsonb,
  content jsonb,
  signals jsonb not null default '[]',
  crawlers jsonb not null default '[]',
  stack jsonb,
  competitors jsonb not null default '[]',
  progress jsonb,
  constraint checks_id_site_uq unique (id, site_id),
  constraint checks_previous_check_site_fkey foreign key (previous_check_id, site_id)
    references public.checks (id, site_id) on delete set null (previous_check_id),
  constraint checks_grade_version check (grade_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  -- The contract's Check rules.
  constraint checks_progress check ((status = 'running') = (progress is not null)),
  constraint checks_not_started check (status not in ('queued', 'deferred') or started_at is null),
  constraint checks_started check (
    status not in ('running', 'finished', 'partial', 'failed') or started_at is not null),
  constraint checks_finished_at check (
    (status in ('finished', 'partial', 'failed')) = (finished_at is not null)),
  constraint checks_deferred_until check ((status = 'deferred') = (deferred_until is not null)),
  constraint checks_failure_reason check ((status = 'failed') = (failure_reason is not null)),
  constraint checks_coverage check ((status in ('finished', 'partial')) = (coverage is not null)),
  constraint checks_both_grades check (
    status <> 'finished' or (technical_seo is not null and ai_readability is not null)),
  constraint checks_grades_when_ended check (
    status in ('finished', 'partial') or (technical_seo is null and ai_readability is null))
);

create index if not exists checks_site_queued_idx on public.checks (site_id, queued_at desc);
create index if not exists checks_previous_idx on public.checks (previous_check_id);
create index if not exists checks_active_idx on public.checks (status) where status in ('queued', 'running');
create index if not exists checks_expires_idx on public.checks (expires_at) where expires_at is not null;

-- ─── page_results and link_edges ──────────────────────────────────────────────────────────────────
-- Keyed by sha256 hex of the UTF-8 URL, as frontier.url_hash, set by a trigger because the
-- text-to-bytes conversion is not immutable and so cannot be a generated column.

create table if not exists public.page_results (
  check_id uuid not null references public.checks (id) on delete cascade,
  url text not null,
  url_hash text not null,
  template_key text not null,
  kind text not null check (kind in ('content', 'auth', 'search', 'pagination', 'archive', 'feed',
                                     'status', 'utility', 'duplicate', 'thin')),
  status_code smallint not null,
  depth integer,
  links_in integer not null,
  links_out integer not null,
  pagerank_share double precision,
  is_orphan boolean not null,
  js_only boolean not null,
  found_via text not null check (found_via in ('link', 'sitemap', 'javascript')),
  sitemap_lastmod date,
  suggested_parent_url text,
  sampled boolean not null,
  without_js jsonb,
  crawlers_reached integer,
  crawlers_reading_text integer,
  content_failures text[] check (content_failures <@ array['direct_answer_150', 'question_headings',
                                 'schema_with_description', 'author_and_date', 'specs_as_text']),
  primary key (check_id, url_hash)
);

create index if not exists page_results_template_idx on public.page_results (check_id, template_key);
create index if not exists page_results_orphan_idx on public.page_results (check_id) where is_orphan;

create table if not exists public.link_edges (
  check_id uuid not null references public.checks (id) on delete cascade,
  from_url text not null,
  to_url text not null,
  from_hash text not null,
  to_hash text not null,
  anchor_text text not null,
  is_generic_anchor boolean not null,
  js_only boolean not null,
  primary key (check_id, from_hash, to_hash)
);

create index if not exists link_edges_to_idx on public.link_edges (check_id, to_hash);

create or replace function public.page_results_url_hash()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.url_hash := encode(sha256(convert_to(new.url, 'UTF8')), 'hex');
  return new;
end;
$$;

create or replace function public.link_edges_url_hash()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.from_hash := encode(sha256(convert_to(new.from_url, 'UTF8')), 'hex');
  new.to_hash := encode(sha256(convert_to(new.to_url, 'UTF8')), 'hex');
  return new;
end;
$$;

revoke all on function public.page_results_url_hash() from public, anon, authenticated, service_role;
revoke all on function public.link_edges_url_hash() from public, anon, authenticated, service_role;

drop trigger if exists page_results_url_hash on public.page_results;
create trigger page_results_url_hash before insert or update on public.page_results
  for each row execute function public.page_results_url_hash();
drop trigger if exists link_edges_url_hash on public.link_edges;
create trigger link_edges_url_hash before insert or update on public.link_edges
  for each row execute function public.link_edges_url_hash();

-- ─── access_tests ─────────────────────────────────────────────────────────────────────────────────

create table if not exists public.access_tests (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.checks (id) on delete cascade,
  ua text,
  page_url text not null,
  template_key text not null,
  tested_at timestamptz not null,
  verdict text not null check (verdict in ('allowed', 'allowed_thin', 'disallowed_by_robots',
                                           'blocked_by_ua_rule', 'challenged_ua', 'refused_unverified',
                                           'rate_limited', 'payment_required', 'edge_blocks_automation',
                                           'redirected_away', 'not_measured')),
  evidence_class text not null check (evidence_class in ('declared', 'simulated', 'observed')),
  identity_sent text not null,
  source_ip_class text not null check (source_ip_class in ('fly_egress', 'browser_rendering', 'owner_logs')),
  limitations text[] not null default '{}',
  cause text check (cause in ('cloudflare_1020', 'bot_fight_mode', 'client_rendered_template',
                              'robots_txt_disallow', 'automation_challenge', 'rate_limit_429',
                              'pay_per_crawl_402', 'cross_host_redirect', 'verified_bot_only')),
  request_headers jsonb not null default '[]',
  raw_status smallint,
  final_url text,
  headers jsonb not null default '[]',
  byte_count bigint,
  word_count integer,
  body_excerpt text,
  constraint access_tests_observed_owner_logs check (
    (evidence_class = 'observed') = (source_ip_class = 'owner_logs'))
);

create index if not exists access_tests_check_idx on public.access_tests (check_id);

-- ─── site_fixes (the contract's Fix; `fixes` is v1's table until 009) ─────────────────────────────

create table if not exists public.site_fixes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  fingerprint text not null,
  number integer not null,
  type text not null check (type in ('robots_txt_blocks_crawler', 'edge_rule_blocks_crawler',
                                     'client_rendered_template', 'orphan_pages', 'quotable_opening',
                                     'generic_anchor_text', 'deep_pages', 'specs_as_images',
                                     'missing_author_date', 'js_only_navigation', 'redirect_chain',
                                     'duplicate_pagination', 'canonical_mismatch', 'hreflang_gap')),
  section text not null check (section in ('crawler_access', 'without_js', 'structure', 'content')),
  title text not null,
  detail text,
  recommendation_class text not null check (recommendation_class in ('confirmed_defect',
                                     'documented_requirement', 'best_practice', 'experimental')),
  status text not null check (status in ('open', 'marked_done', 'verified_resolved', 'unable_to_verify',
                                         'reopened')),
  last_state text not null check (last_state in ('detected', 'not_detected', 'indeterminate')),
  last_measured_check_id uuid not null,
  first_seen_check_id uuid not null,
  confidence text not null check (confidence in ('confirmed', 'likely', 'inconclusive')),
  affected_pages integer not null,
  template_key text,
  crawler_uas text[] not null default '{}',
  rank integer,
  effect jsonb not null,
  effort jsonb,
  before_after jsonb not null default '[]',
  packet jsonb,
  constraint site_fixes_id_site_uq unique (id, site_id),
  constraint site_fixes_site_fingerprint_uq unique (site_id, fingerprint),
  constraint site_fixes_last_measured_check_fkey foreign key (last_measured_check_id, site_id)
    references public.checks (id, site_id),
  constraint site_fixes_first_seen_check_fkey foreign key (first_seen_check_id, site_id)
    references public.checks (id, site_id),
  -- The contract's Fix rules (LAST_STATE_FOR_STATUS, fix_rank, packet_framework, effect_pending).
  constraint site_fixes_last_state check (case status
    when 'open' then last_state = 'detected'
    when 'reopened' then last_state = 'detected'
    when 'verified_resolved' then last_state = 'not_detected'
    when 'unable_to_verify' then last_state = 'indeterminate'
    else true end),
  constraint site_fixes_rank check ((status = 'verified_resolved') = (rank is null)),
  constraint site_fixes_packet_framework check (
    packet is null or (packet -> 'frameworks') @> jsonb_build_array(packet -> 'framework')),
  constraint site_fixes_effect_pending check (
    (coalesce(effect -> 'ai_readability', 'null') = 'null')
      = (jsonb_array_length(coalesce(effect -> 'ai_readability_pending_on', '[]')) > 0))
);

create index if not exists site_fixes_site_status_rank_idx on public.site_fixes (site_id, status, rank);
create index if not exists site_fixes_last_measured_idx on public.site_fixes (last_measured_check_id, site_id);
create index if not exists site_fixes_first_seen_idx on public.site_fixes (first_seen_check_id, site_id);

-- ─── fix_events: append-only ──────────────────────────────────────────────────────────────────────

create table if not exists public.fix_events (
  id uuid primary key default gen_random_uuid(),
  fix_id uuid not null references public.site_fixes (id) on delete cascade,
  at timestamptz not null,
  kind text not null check (kind in ('marked_done', 'verified', 'unable_to_verify', 'reopened')),
  by_seat_id uuid references public.seats (id) on delete set null,
  check_id uuid references public.checks (id),
  -- marked_done records who; the other kinds record the check that measured the fix.
  constraint fix_events_kind_fields check (case
    when kind = 'marked_done' then check_id is null
    else check_id is not null and by_seat_id is null end)
);

create index if not exists fix_events_fix_at_idx on public.fix_events (fix_id, at);
create index if not exists fix_events_check_idx on public.fix_events (check_id);
create index if not exists fix_events_seat_idx on public.fix_events (by_seat_id);

-- Refuses UPDATE, DELETE and TRUNCATE, for every role. Two writes are let through, both made by a
-- foreign-key action and checked here by what they leave behind: the delete of an event whose fix no
-- longer exists, and the clearing of by_seat_id once its seat no longer exists. SECURITY DEFINER, so
-- the cascade a user deletion starts can read site_fixes and seats whatever role started it.
create or replace function public.fix_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.site_fixes f where f.id = old.fix_id) then
      return old;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.by_seat_id is not null and new.by_seat_id is null
       and (new.id, new.fix_id, new.at, new.kind, new.check_id)
           is not distinct from (old.id, old.fix_id, old.at, old.kind, old.check_id)
       and not exists (select 1 from public.seats s where s.id = old.by_seat_id) then
      return new;
    end if;
  end if;
  raise exception 'fix_events is append-only' using errcode = '55000';
end;
$$;

revoke all on function public.fix_events_append_only() from public, anon, authenticated, service_role;

drop trigger if exists fix_events_append_only on public.fix_events;
create trigger fix_events_append_only before update or delete on public.fix_events
  for each row execute function public.fix_events_append_only();
drop trigger if exists fix_events_no_truncate on public.fix_events;
create trigger fix_events_no_truncate before truncate on public.fix_events
  for each statement execute function public.fix_events_append_only();

-- ─── changes ──────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.changes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  check_id uuid not null,
  previous_check_id uuid,
  detected_at timestamptz not null,
  kind text not null check (kind in ('opened', 'resolved', 'changed')),
  subject text not null check (subject in ('crawler_access', 'text_without_js', 'grade', 'orphans',
                                           'content', 'structure', 'deploy')),
  summary text not null,
  "where" text not null,
  pages_affected integer not null,
  ua text,
  grade_deltas jsonb not null default '[]',
  cause jsonb,
  fix_id uuid,
  notified jsonb,
  constraint changes_check_site_fkey foreign key (check_id, site_id)
    references public.checks (id, site_id) on delete cascade,
  constraint changes_previous_check_site_fkey foreign key (previous_check_id, site_id)
    references public.checks (id, site_id) on delete set null (previous_check_id),
  constraint changes_fix_site_fkey foreign key (fix_id, site_id)
    references public.site_fixes (id, site_id) on delete set null (fix_id)
);

-- A retried diff cannot write the same change twice.
create unique index if not exists changes_idempotency_uq
  on public.changes (check_id, kind, subject, "where", ua) nulls not distinct;
create index if not exists changes_site_detected_idx on public.changes (site_id, detected_at desc);
create index if not exists changes_previous_idx on public.changes (previous_check_id, site_id);
create index if not exists changes_fix_idx on public.changes (fix_id, site_id);

-- ─── evidence_blobs ───────────────────────────────────────────────────────────────────────────────

create table if not exists public.evidence_blobs (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.checks (id) on delete cascade,
  storage_path text not null,
  version smallint not null,
  bytes bigint not null,
  sha256 text not null,
  contents jsonb not null default '{}',
  created_at timestamptz not null default now(),
  -- A re-run finalize cannot write a second blob of the same version.
  constraint evidence_blobs_check_version_uq unique (check_id, version),
  constraint evidence_blobs_version check (version >= 1),
  constraint evidence_blobs_sha256 check (sha256 ~ '^[0-9a-f]{64}$')
);

-- ─── alert_rules and alert_events ─────────────────────────────────────────────────────────────────

create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- Null for an account-wide rule; otherwise a per-site override.
  site_id uuid,
  kind text not null check (kind in ('crawler_blocked', 'text_drop', 'grade_letter_moved', 'new_orphans',
                                     'fix_regressed', 'any_change')),
  enabled boolean not null default true,
  threshold_points double precision,
  channels text[] not null default '{email}' check (channels <@ array['email', 'slack']),
  last_fired_at timestamptz,
  last_fired_check_id uuid references public.checks (id),
  constraint alert_rules_site_account_fkey foreign key (site_id, account_id)
    references public.sites (id, account_id) on delete cascade,
  constraint alert_rules_threshold check ((kind = 'text_drop') = (threshold_points is not null)),
  constraint alert_rules_fired_pair check ((last_fired_at is null) = (last_fired_check_id is null))
);

create unique index if not exists alert_rules_scope_kind_uq
  on public.alert_rules (account_id, site_id, kind) nulls not distinct;
create index if not exists alert_rules_site_idx on public.alert_rules (site_id, account_id);
create index if not exists alert_rules_last_fired_idx on public.alert_rules (last_fired_check_id);

-- Slack is a paid-plan channel (GATES in apps/web/lib/entitlement-v2.ts). The tier is the account's
-- effective tier, as effectiveTier() there computes it: a no-card Pro trial is Free from
-- trial_ends_at, and past_due keeps past_due_tier for 7 days from past_due_since. It runs for every
-- writer, the service role included.
create or replace function public.alert_rules_entitlement_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tier text;
begin
  if 'slack' = any (new.channels) then
    select case
             when a.state = 'pro_trial' and a.trial_variant = 'no_card'
               then case when now() < a.trial_ends_at then a.tier else 'free' end
             when a.state = 'past_due'
               then case when now() < a.past_due_since + interval '7 days' then a.past_due_tier else 'free' end
             else a.tier
           end
      into v_tier
      from public.accounts a
     where a.id = new.account_id;
    if v_tier is null or v_tier not in ('pro', 'agency') then
      raise exception 'alert_rules: Slack alerts need a paid plan' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.alert_rules_entitlement_check() from public, anon, authenticated, service_role;

drop trigger if exists alert_rules_entitlement_check on public.alert_rules;
create trigger alert_rules_entitlement_check before insert or update on public.alert_rules
  for each row execute function public.alert_rules_entitlement_check();

create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.alert_rules (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  check_id uuid not null,
  change_ids uuid[] not null default '{}',
  channel text not null check (channel in ('email', 'slack')),
  destination_hash text not null,
  provider_message_id text,
  status text not null check (status in ('sent', 'failed', 'suppressed')),
  sent_at timestamptz not null default now(),
  constraint alert_events_check_site_fkey foreign key (check_id, site_id)
    references public.checks (id, site_id) on delete cascade
);

-- alertFn's idempotency key: one message per rule, check and channel.
create unique index if not exists alert_events_rule_check_channel_uq
  on public.alert_events (rule_id, check_id, channel);
create index if not exists alert_events_site_idx on public.alert_events (site_id);
create index if not exists alert_events_check_idx on public.alert_events (check_id, site_id);

-- ─── reports, report_schedules, share_links ───────────────────────────────────────────────────────

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  site_id uuid not null,
  kind text not null check (kind in ('audit_pdf', 'compare', 'raw_export', 'public_link', 'client_report',
                                     'prospect_one_pager')),
  format text not null check (format in ('pdf', 'csv', 'json', 'edge_list', 'html')),
  status text not null check (status in ('ready', 'scheduled', 'held', 'sent')),
  made_by text not null check (made_by in ('user', 'scheduled_check', 'report_schedule')),
  created_at timestamptz not null default now(),
  covers_check_ids uuid[] not null,
  byte_count bigint,
  share_expires_at timestamptz,
  public_slug text unique,
  scheduled_for timestamptz,
  sent_at timestamptz,
  recipient_email text,
  owner_seat_id uuid,
  headline text,
  open_tracking boolean not null default false,
  opened_at timestamptz,
  -- Database only: the file in the private reports bucket, when there is one.
  storage_path text,
  constraint reports_site_account_fkey foreign key (site_id, account_id)
    references public.sites (id, account_id) on delete cascade,
  constraint reports_owner_seat_account_fkey foreign key (owner_seat_id, account_id)
    references public.seats (id, account_id) on delete set null (owner_seat_id),
  constraint reports_covers_checks check (cardinality(covers_check_ids) >= 1),
  -- The contract's Report rules.
  constraint reports_sent check ((status = 'sent') = (sent_at is not null)),
  constraint reports_send_time check (status not in ('scheduled', 'held') or scheduled_for is not null),
  constraint reports_slug check ((kind = 'public_link') = (public_slug is not null)),
  constraint reports_open_tracking check (opened_at is null or open_tracking)
);

create index if not exists reports_account_created_idx on public.reports (account_id, created_at desc);
create index if not exists reports_site_idx on public.reports (site_id, account_id);
create index if not exists reports_owner_seat_idx on public.reports (owner_seat_id, account_id);

-- The contract's Site.client_report: one row per site.
create table if not exists public.report_schedules (
  site_id uuid primary key,
  account_id uuid not null,
  cadence text not null check (cadence in ('weekly', 'monthly', 'on_deploy')),
  iso_weekday smallint not null,
  time_local text not null,
  timezone text not null,
  send_when_unchanged boolean not null default false,
  open_tracking boolean not null default false,
  page_slug text not null,
  paused_by_recipient_at timestamptz,
  -- Database only: when the schedule runs next and last ran.
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_schedules_site_account_fkey foreign key (site_id, account_id)
    references public.sites (id, account_id) on delete cascade,
  constraint report_schedules_client_report_cadence check (cadence <> 'on_deploy'),
  constraint report_schedules_weekday check (iso_weekday between 1 and 7),
  constraint report_schedules_time_local check (time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint report_schedules_page_slug check (page_slug ~ '^[a-z0-9-]+$')
);

create index if not exists report_schedules_account_idx on public.report_schedules (account_id);
create index if not exists report_schedules_next_run_idx on public.report_schedules (next_run_at)
  where paused_by_recipient_at is null;

-- A share link is a bearer token for a report file; only its sha256 is stored.
create table if not exists public.share_links (
  token_hash text primary key,
  report_id uuid not null references public.reports (id) on delete cascade,
  expires_at timestamptz not null,
  created_by uuid references public.users (id) on delete set null,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint share_links_token_hash check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists share_links_report_idx on public.share_links (report_id);
create index if not exists share_links_expires_idx on public.share_links (expires_at);
create index if not exists share_links_created_by_idx on public.share_links (created_by);

-- ─── api_keys and deploy_hooks ────────────────────────────────────────────────────────────────────
-- Both store only the sha256 of their secret, and neither hash is granted to any client role.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{read:checks}'
    check (scopes <@ array['read:checks', 'read:fixes', 'read:changes']),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint api_keys_key_hash check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint api_keys_scopes_nonempty check (cardinality(scopes) >= 1)
);

create index if not exists api_keys_account_idx on public.api_keys (account_id);
create index if not exists api_keys_created_by_idx on public.api_keys (created_by);

create table if not exists public.deploy_hooks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  token_hash text not null unique,
  provider text not null check (provider in ('vercel', 'generic')),
  last_fired_at timestamptz,
  fire_count integer not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint deploy_hooks_token_hash check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists deploy_hooks_site_idx on public.deploy_hooks (site_id);

-- ─── seat_sites: the sites a scoped seat sees ─────────────────────────────────────────────────────

create table if not exists public.seat_sites (
  seat_id uuid not null,
  site_id uuid not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  primary key (seat_id, site_id),
  constraint seat_sites_seat_account_fkey foreign key (seat_id, account_id)
    references public.seats (id, account_id) on delete cascade,
  constraint seat_sites_site_account_fkey foreign key (site_id, account_id)
    references public.sites (id, account_id) on delete cascade
);

create index if not exists seat_sites_site_idx on public.seat_sites (site_id, account_id);
create index if not exists seat_sites_account_idx on public.seat_sites (account_id);

-- ─── frontier: check_id beside audit_id ───────────────────────────────────────────────────────────
-- audit_id stays NOT NULL and in the primary key until 009, so a v2 row cannot be written here yet.

alter table public.frontier add column if not exists check_id uuid
  references public.checks (id) on delete cascade;
alter table public.frontier_politeness add column if not exists check_id uuid
  references public.checks (id) on delete cascade;
create index if not exists frontier_check_idx on public.frontier (check_id);
create index if not exists frontier_politeness_check_idx on public.frontier_politeness (check_id);

-- ─── is_member_for_site ───────────────────────────────────────────────────────────────────────────
-- True when the caller holds an active seat on the site's live account and that seat covers the site:
-- client_scope_all, or a seat_sites row for the site or for the production site it stages.
-- SECURITY DEFINER for the same reason as is_member: policies on these tables call it.

create or replace function public.is_member_for_site(p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
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
       and (s.client_scope_all
            or exists (select 1
                         from public.seat_sites ss
                        where ss.seat_id = s.id
                          and ss.site_id in (st.id, st.staging_of_site_id)))
  );
$$;

revoke all on function public.is_member_for_site(uuid) from public, anon, authenticated;
grant execute on function public.is_member_for_site(uuid) to authenticated, service_role;

-- ─── RLS ──────────────────────────────────────────────────────────────────────────────────────────

alter table public.sites enable row level security;
alter table public.checks enable row level security;
alter table public.page_results enable row level security;
alter table public.link_edges enable row level security;
alter table public.access_tests enable row level security;
alter table public.site_fixes enable row level security;
alter table public.fix_events enable row level security;
alter table public.changes enable row level security;
alter table public.evidence_blobs enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alert_events enable row level security;
alter table public.reports enable row level security;
alter table public.report_schedules enable row level security;
alter table public.share_links enable row level security;
alter table public.api_keys enable row level security;
alter table public.deploy_hooks enable row level security;
alter table public.seat_sites enable row level security;

drop policy if exists sites_member_read on public.sites;
create policy sites_member_read on public.sites
  for select to authenticated using (public.is_member_for_site(id));

drop policy if exists checks_member_read on public.checks;
create policy checks_member_read on public.checks
  for select to authenticated using (public.is_member_for_site(site_id));

drop policy if exists page_results_member_read on public.page_results;
create policy page_results_member_read on public.page_results
  for select to authenticated using (exists (
    select 1 from public.checks c where c.id = page_results.check_id and public.is_member_for_site(c.site_id)));

drop policy if exists link_edges_member_read on public.link_edges;
create policy link_edges_member_read on public.link_edges
  for select to authenticated using (exists (
    select 1 from public.checks c where c.id = link_edges.check_id and public.is_member_for_site(c.site_id)));

drop policy if exists access_tests_member_read on public.access_tests;
create policy access_tests_member_read on public.access_tests
  for select to authenticated using (exists (
    select 1 from public.checks c where c.id = access_tests.check_id and public.is_member_for_site(c.site_id)));

drop policy if exists evidence_blobs_member_read on public.evidence_blobs;
create policy evidence_blobs_member_read on public.evidence_blobs
  for select to authenticated using (exists (
    select 1 from public.checks c where c.id = evidence_blobs.check_id and public.is_member_for_site(c.site_id)));

drop policy if exists changes_member_read on public.changes;
create policy changes_member_read on public.changes
  for select to authenticated using (public.is_member_for_site(site_id));

drop policy if exists alert_events_member_read on public.alert_events;
create policy alert_events_member_read on public.alert_events
  for select to authenticated using (public.is_member_for_site(site_id));

drop policy if exists reports_member_read on public.reports;
create policy reports_member_read on public.reports
  for select to authenticated using (public.is_member_for_site(site_id));

drop policy if exists report_schedules_member_read on public.report_schedules;
create policy report_schedules_member_read on public.report_schedules
  for select to authenticated using (public.is_member_for_site(site_id));

drop policy if exists deploy_hooks_member_read on public.deploy_hooks;
create policy deploy_hooks_member_read on public.deploy_hooks
  for select to authenticated using (public.is_member_for_site(site_id));

drop policy if exists api_keys_member_read on public.api_keys;
create policy api_keys_member_read on public.api_keys
  for select to authenticated
  using (public.is_member(account_id) and public.member_role(account_id) in ('owner', 'account_manager'));

drop policy if exists seat_sites_member_read on public.seat_sites;
create policy seat_sites_member_read on public.seat_sites
  for select to authenticated using (public.is_member(account_id));

-- alert_rules: a site rule is read and written by the seats that cover the site; an account-wide
-- rule is read by any member and written by the owner (an owner seat is never scoped).
drop policy if exists alert_rules_member_read on public.alert_rules;
create policy alert_rules_member_read on public.alert_rules
  for select to authenticated using (case when site_id is null then public.is_member(account_id)
                                          else public.is_member_for_site(site_id) end);

drop policy if exists alert_rules_member_insert on public.alert_rules;
create policy alert_rules_member_insert on public.alert_rules
  for insert to authenticated with check (case when site_id is null
                                               then public.member_role(account_id) = 'owner'
                                               else public.is_member_for_site(site_id) end);

drop policy if exists alert_rules_member_update on public.alert_rules;
create policy alert_rules_member_update on public.alert_rules
  for update to authenticated
  using (case when site_id is null then public.member_role(account_id) = 'owner'
              else public.is_member_for_site(site_id) end)
  with check (case when site_id is null then public.member_role(account_id) = 'owner'
                   else public.is_member_for_site(site_id) end);

drop policy if exists alert_rules_member_delete on public.alert_rules;
create policy alert_rules_member_delete on public.alert_rules
  for delete to authenticated using (case when site_id is null then public.member_role(account_id) = 'owner'
                                          else public.is_member_for_site(site_id) end);

-- ─── Grants ───────────────────────────────────────────────────────────────────────────────────────
-- SELECT is granted per column, so a column added later is hidden until it is granted. Left out:
-- changes.fix_id and changes.subject (J10), reports.storage_path, api_keys.key_hash and
-- deploy_hooks.token_hash.

revoke all on table public.sites, public.checks, public.page_results, public.link_edges,
  public.access_tests, public.site_fixes, public.fix_events, public.changes, public.evidence_blobs,
  public.alert_rules, public.alert_events, public.reports, public.report_schedules, public.share_links,
  public.api_keys, public.deploy_hooks, public.seat_sites
  from public, anon, authenticated;

grant all on table public.sites, public.checks, public.page_results, public.link_edges,
  public.access_tests, public.site_fixes, public.fix_events, public.changes, public.evidence_blobs,
  public.alert_rules, public.alert_events, public.reports, public.report_schedules, public.share_links,
  public.api_keys, public.deploy_hooks, public.seat_sites
  to service_role;

grant select (client_scope_all) on public.seats to authenticated;

grant select (
  id, account_id, host, staging_of_site_id, client_name, client_contact_name, client_contact_email,
  schedule_cadence, schedule_iso_weekday, schedule_hour_local, paused_reason, paused, competitor_hosts,
  slack_channel, owner_seat_id, created_at, updated_at, removed_at
) on public.sites to authenticated;
grant select (
  id, site_id, previous_check_id, status, trigger, grade_version, queued_at, started_at, finished_at,
  tested_at, expires_at, deferred_until, failure_reason, result_email, coverage, technical_seo,
  ai_readability, structure, without_js, content, signals, crawlers, stack, competitors, progress
) on public.checks to authenticated;
grant select (
  check_id, url, url_hash, template_key, kind, status_code, depth, links_in, links_out, pagerank_share,
  is_orphan, js_only, found_via, sitemap_lastmod, suggested_parent_url, sampled, without_js,
  crawlers_reached, crawlers_reading_text, content_failures
) on public.page_results to authenticated;
grant select (
  check_id, from_url, to_url, from_hash, to_hash, anchor_text, is_generic_anchor, js_only
) on public.link_edges to authenticated;
grant select (
  id, check_id, ua, page_url, template_key, tested_at, verdict, evidence_class, identity_sent,
  source_ip_class, limitations, cause, request_headers, raw_status, final_url, headers, byte_count,
  word_count, body_excerpt
) on public.access_tests to authenticated;
grant select (
  id, site_id, check_id, previous_check_id, detected_at, kind, summary, "where", pages_affected, ua,
  grade_deltas, cause, notified
) on public.changes to authenticated;
grant select (
  id, check_id, storage_path, version, bytes, sha256, contents, created_at
) on public.evidence_blobs to authenticated;
grant select (
  id, account_id, site_id, kind, enabled, threshold_points, channels, last_fired_at, last_fired_check_id
) on public.alert_rules to authenticated;
grant insert (account_id, site_id, kind, enabled, threshold_points, channels)
  on public.alert_rules to authenticated;
grant update (enabled, threshold_points, channels) on public.alert_rules to authenticated;
grant delete on public.alert_rules to authenticated;
grant select (
  id, rule_id, site_id, check_id, change_ids, channel, destination_hash, provider_message_id, status,
  sent_at
) on public.alert_events to authenticated;
grant select (
  id, account_id, site_id, kind, format, status, made_by, created_at, covers_check_ids, byte_count,
  share_expires_at, public_slug, scheduled_for, sent_at, recipient_email, owner_seat_id, headline,
  open_tracking, opened_at
) on public.reports to authenticated;
grant select (
  site_id, account_id, cadence, iso_weekday, time_local, timezone, send_when_unchanged, open_tracking,
  page_slug, paused_by_recipient_at, next_run_at, last_run_at, created_at, updated_at
) on public.report_schedules to authenticated;
grant select (
  id, account_id, name, prefix, scopes, created_by, created_at, last_used_at, revoked_at
) on public.api_keys to authenticated;
grant select (
  id, site_id, provider, last_fired_at, fire_count, created_at, revoked_at
) on public.deploy_hooks to authenticated;
grant select (seat_id, site_id, account_id) on public.seat_sites to authenticated;

-- ─── apply_entitlement_transition: now with the site effects ──────────────────────────────────────
-- 001's body, unchanged up to the seat removal, then the site effects of CC-02's planSites
-- (apps/web/lib/billing/state-machine-sites.ts), decided the way next() decides them
-- (apps/web/lib/billing/state-machine.ts): pause_others on a move to Free from a paid tier;
-- otherwise pause_over_limit when the site limit falls, resume when it rises.
--
-- They apply to the account's primary sites (not staging, not removed), oldest first by created_at
-- then id; a site the user paused is not changed but keeps its place in that order. A pause records
-- paused_reason and keeps the schedule; a resume clears it and sets the tier's cadence (Free:
-- monthly, paid: weekly). A site given a cadence without a weekday or hour gets the weekday it was
-- created on, in the account's time zone, at 06:00.

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
  v_effect text;
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

  if p_tier = 'free' and v_account.tier <> 'free' then
    v_effect := 'pause_others';
  elsif p_site_limit < v_account.site_limit then
    v_effect := 'pause_over_limit';
  elsif p_site_limit > v_account.site_limit then
    v_effect := 'resume';
  end if;

  if v_effect is not null then
    with ordered as (
      select s.id, s.schedule_cadence, s.paused_reason,
             row_number() over (order by s.created_at, s.id) - 1 as place,
             extract(isodow from s.created_at at time zone a.timezone)::smallint as created_weekday
        from public.sites s
        join public.accounts a on a.id = s.account_id
       where s.account_id = p_account_id
         and s.staging_of_site_id is null
         and s.removed_at is null
    ), target as (
      select o.id, o.created_weekday,
             case
               when v_effect = 'pause_others' and o.place = 0 then 'monthly'
               when v_effect = 'resume' and o.place < p_site_limit
                 then case when p_tier = 'free' then 'monthly' else 'weekly' end
               else o.schedule_cadence
             end as cadence,
             case
               when v_effect = 'pause_others' then case when o.place = 0 then null else 'trial_ended' end
               when v_effect = 'pause_over_limit' and o.place >= p_site_limit
                    and o.paused_reason is null and o.schedule_cadence is not null then 'over_limit'
               when v_effect = 'resume' and o.place < p_site_limit then null
               else o.paused_reason
             end as reason
        from ordered o
       where o.paused_reason is distinct from 'user'
    )
    update public.sites s
       set schedule_cadence = t.cadence,
           schedule_iso_weekday = case when t.cadence is null then s.schedule_iso_weekday
                                       else coalesce(s.schedule_iso_weekday, t.created_weekday) end,
           schedule_hour_local = case when t.cadence is null then s.schedule_hour_local
                                      else coalesce(s.schedule_hour_local, 6) end,
           paused_reason = t.reason,
           updated_at = now()
      from target t
     where s.id = t.id
       and (s.schedule_cadence is distinct from t.cadence or s.paused_reason is distinct from t.reason);
  end if;

  return v_account.entitlement_version + 1;
end;
$$;

revoke all on function public.apply_entitlement_transition(
  uuid, integer, text, text, text, timestamptz, text, timestamptz, timestamptz, timestamptz,
  integer, integer, integer, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_entitlement_transition(
  uuid, integer, text, text, text, timestamptz, text, timestamptz, timestamptz, timestamptz,
  integer, integer, integer, timestamptz, text, timestamptz) to service_role;
