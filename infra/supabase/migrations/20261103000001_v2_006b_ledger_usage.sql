-- v2 migration 006b (CC-06b, docs/specs/v2/06b-data-foundations.md): the research ledger and usage
-- metering.
--
-- Additive only. It creates the schema `research` with check_runs and crawler_observations, the role
-- research_retention, public.check_ledger_links and public.usage_events. No existing table, column,
-- policy or grant is dropped or changed. v1 reads none of the new objects.
--
-- The ledger. research holds what a check observed about a site, de-identified: no account, seat,
-- user, email, check, URL or path, and no time finer than the month. A site is known by site_key, a
-- keyed HMAC of its registrable domain whose key (RESEARCH_SITE_KEY) is held by the server and never
-- stored in the database. A customer's check reaches its ledger rows only through
-- public.check_ledger_links, which is deleted with the check. No client role may use the schema;
-- service_role reads and inserts. Rows are never updated: a correction is a new check_runs row that
-- supersedes the old one. Only research_retention may delete, and only rows (the ledger keeps no
-- expiry; deletion is for an opt-out or a legal erasure).
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261103000001_v2_006b_ledger_usage.revert.sql.
-- Tested by: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-006b-data-foundations.test.ts

-- ─── The schema and the retention role ────────────────────────────────────────────────────────────

create schema if not exists research;
revoke all on schema research from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'research_retention') then
    create role research_retention nologin noinherit;
  end if;
end;
$$;

grant usage on schema research to service_role, research_retention;

-- ─── research.check_runs: one row per check run per site ──────────────────────────────────────────

create table if not exists research.check_runs (
  id uuid not null default gen_random_uuid(),
  -- The first day of the UTC month the check ran in: the ledger's only time.
  observed_month date not null,
  site_key text not null,
  site_key_version smallint not null,
  lineage_id uuid not null references public.measurement_lineages (id),
  -- The run this one corrects, if any.
  supersedes_id uuid,
  supersedes_month date,
  cms text check (cms in ('shopify', 'wordpress', 'webflow', 'wix', 'squarespace', 'framer', 'ghost',
                          'custom')),
  frontend_framework text check (frontend_framework in ('nextjs', 'shopify_liquid', 'shopify_hydrogen',
                                                        'wordpress', 'webflow', 'generic')),
  edge_vendor text,
  without_js_state text check (without_js_state in ('readable', 'partial', 'empty_shell')),
  -- Share of the pages crawled in each status class, to two decimals: a share, not a count, so a run
  -- cannot be matched to a check by its page counts.
  share_2xx numeric(3, 2) not null,
  share_3xx numeric(3, 2) not null,
  share_4xx numeric(3, 2) not null,
  share_5xx numeric(3, 2) not null,
  share_unanswered numeric(3, 2) not null,
  -- Declarations found (SignalKind), and those whose presence could not be decided.
  signals_detected text[] not null default '{}'
    check (signals_detected <@ array['schema_org', 'content_signals', 'web_bot_auth', 'llms_txt',
                                     'mcp_server_card', 'markdown_negotiation', 'agent_skills_index']),
  signals_indeterminate text[] not null default '{}'
    check (signals_indeterminate <@ array['schema_org', 'content_signals', 'web_bot_auth', 'llms_txt',
                                          'mcp_server_card', 'markdown_negotiation', 'agent_skills_index']),
  primary key (id, observed_month),
  constraint check_runs_supersedes_fkey foreign key (supersedes_id, supersedes_month)
    references research.check_runs (id, observed_month),
  constraint check_runs_observed_month check (extract(day from observed_month) = 1),
  constraint check_runs_site_key check (site_key ~ '^[0-9a-f]{64}$'),
  constraint check_runs_site_key_version check (site_key_version >= 1),
  constraint check_runs_supersedes_pair check ((supersedes_id is null) = (supersedes_month is null)),
  constraint check_runs_edge_vendor check (edge_vendor ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  constraint check_runs_shares check (
    share_2xx between 0 and 1 and share_3xx between 0 and 1 and share_4xx between 0 and 1
    and share_5xx between 0 and 1 and share_unanswered between 0 and 1),
  constraint check_runs_signals_ndims check (
    array_ndims(signals_detected) is not distinct from 1 or cardinality(signals_detected) = 0),
  constraint check_runs_signals_indeterminate_ndims check (
    array_ndims(signals_indeterminate) is not distinct from 1 or cardinality(signals_indeterminate) = 0),
  constraint check_runs_signals_disjoint check (not (signals_detected && signals_indeterminate))
) partition by range (observed_month);

create index if not exists check_runs_site_key_idx on research.check_runs (site_key, observed_month);
create index if not exists check_runs_supersedes_idx on research.check_runs (supersedes_id, supersedes_month);

-- ─── research.crawler_observations: one row per crawler per run ───────────────────────────────────

create table if not exists research.crawler_observations (
  run_id uuid not null,
  observed_month date not null,
  -- The crawler's registry token, e.g. GPTBot.
  crawler text not null,
  verdict text not null check (verdict in ('allowed', 'allowed_thin', 'disallowed_by_robots',
                                           'blocked_by_ua_rule', 'challenged_ua', 'refused_unverified',
                                           'rate_limited', 'payment_required', 'edge_blocks_automation',
                                           'redirected_away', 'not_measured')),
  -- verdictStatus in packages/types/src/v2/measurement.ts, as access_tests.measurement_status.
  measurement_status text generated always as (case verdict
    when 'not_measured' then 'unevaluable'
    when 'edge_blocks_automation' then 'not_measurable'
    else 'measured' end) stored not null
    check (measurement_status in ('measured', 'not_measurable', 'unevaluable', 'withheld')),
  cause text check (cause in ('cloudflare_1020', 'bot_fight_mode', 'client_rendered_template',
                              'robots_txt_disallow', 'automation_challenge', 'rate_limit_429',
                              'pay_per_crawl_402', 'cross_host_redirect', 'verified_bot_only')),
  -- The robots.txt rule for this crawler's token: which group applies (one naming the token, or the
  -- wildcard) and what it does to the site; no_group when none applies; not_read when robots.txt
  -- could not be read.
  robots_rule text not null check (robots_rule in ('named_allow_all', 'named_disallow_all',
                                                   'named_partial', 'wildcard_allow_all',
                                                   'wildcard_disallow_all', 'wildcard_partial',
                                                   'no_group', 'not_read')),
  primary key (run_id, crawler, observed_month),
  constraint crawler_observations_run_fkey foreign key (run_id, observed_month)
    references research.check_runs (id, observed_month),
  constraint crawler_observations_crawler check (crawler ~ '^[A-Za-z][A-Za-z0-9._-]{0,63}$')
) partition by range (observed_month);

-- ─── Append-only, and a correction stays on its own site ──────────────────────────────────────────
-- SECURITY INVOKER, so current_user is the role that wrote. research_retention may delete; nothing
-- may update or truncate, the table owner included.

create or replace function research.ledger_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' and current_user = 'research_retention' then
    return old;
  end if;
  raise exception 'research.%: the ledger is append-only; a correction is a new row that supersedes it',
    tg_table_name using errcode = '55000';
end;
$$;

-- A run supersedes a run of the same site, under the same site key version. A half-set pair is
-- check_runs_supersedes_pair's to refuse.
create or replace function research.check_runs_supersedes_same_site()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.supersedes_id is not null and new.supersedes_month is not null and not exists (
       select 1 from research.check_runs r
        where r.id = new.supersedes_id and r.observed_month = new.supersedes_month
          and r.site_key = new.site_key and r.site_key_version = new.site_key_version) then
    raise exception 'research.check_runs: a run supersedes a run of the same site' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function research.ledger_append_only() from public, anon, authenticated;
revoke all on function research.check_runs_supersedes_same_site() from public, anon, authenticated;

drop trigger if exists check_runs_append_only on research.check_runs;
create trigger check_runs_append_only before update or delete on research.check_runs
  for each row execute function research.ledger_append_only();
drop trigger if exists check_runs_no_truncate on research.check_runs;
create trigger check_runs_no_truncate before truncate on research.check_runs
  for each statement execute function research.ledger_append_only();
drop trigger if exists check_runs_supersedes_same_site on research.check_runs;
create trigger check_runs_supersedes_same_site before insert on research.check_runs
  for each row execute function research.check_runs_supersedes_same_site();

drop trigger if exists crawler_observations_append_only on research.crawler_observations;
create trigger crawler_observations_append_only before update or delete on research.crawler_observations
  for each row execute function research.ledger_append_only();
drop trigger if exists crawler_observations_no_truncate on research.crawler_observations;
create trigger crawler_observations_no_truncate before truncate on research.crawler_observations
  for each statement execute function research.ledger_append_only();

-- ─── Ledger access ────────────────────────────────────────────────────────────────────────────────

alter table research.check_runs enable row level security;
alter table research.crawler_observations enable row level security;

drop policy if exists check_runs_retention on research.check_runs;
create policy check_runs_retention on research.check_runs
  for all to research_retention using (true);
drop policy if exists crawler_observations_retention on research.crawler_observations;
create policy crawler_observations_retention on research.crawler_observations
  for all to research_retention using (true);

revoke all on table research.check_runs, research.crawler_observations
  from public, anon, authenticated, service_role, research_retention;
grant select, insert on table research.check_runs, research.crawler_observations to service_role;
grant select, delete on table research.check_runs, research.crawler_observations to research_retention;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'crawl_worker') then
    revoke all on schema research from crawl_worker;
    revoke all on table research.check_runs, research.crawler_observations from crawl_worker;
  end if;
end;
$$;

-- ─── public.check_ledger_links: the one path from a check to its ledger rows ──────────────────────
-- Deleted with the check (and so with the site and the account); the ledger rows it named stay,
-- reachable from nothing that names a customer.

create table if not exists public.check_ledger_links (
  check_id uuid not null references public.checks (id) on delete cascade,
  run_id uuid not null,
  observed_month date not null,
  primary key (check_id, run_id),
  constraint check_ledger_links_run_fkey foreign key (run_id, observed_month)
    references research.check_runs (id, observed_month) on delete cascade
);

create index if not exists check_ledger_links_run_idx on public.check_ledger_links (run_id, observed_month);

alter table public.check_ledger_links enable row level security;
revoke all on table public.check_ledger_links from public, anon, authenticated;
grant all on table public.check_ledger_links to service_role;

-- ─── public.usage_events: one row per delivered result ────────────────────────────────────────────

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null check (kind in ('check_finished', 'export', 'api_call')),
  check_id uuid references public.checks (id) on delete set null,
  report_id uuid references public.reports (id) on delete set null,
  -- Database only: the key an API call came in with.
  api_key_id uuid references public.api_keys (id) on delete set null,
  result text not null check (result in ('delivered', 'refused', 'withheld', 'failed')),
  billable boolean not null,
  compute_seconds double precision not null,
  request_count integer not null,
  occurred_at timestamptz not null default now(),
  -- Database only: what makes a retried write land once.
  idempotency_key text not null unique,
  constraint usage_events_billable check (not billable or result = 'delivered'),
  -- Finite, as the contract's number: NaN sorts above Infinity in Postgres, so this refuses both.
  constraint usage_events_compute_seconds check (compute_seconds >= 0 and compute_seconds < 'Infinity'),
  constraint usage_events_request_count check (request_count >= 0),
  constraint usage_events_idempotency_key check (idempotency_key ~ '^[!-~]{1,200}$')
);

create index if not exists usage_events_account_occurred_idx on public.usage_events (account_id, occurred_at desc);
create index if not exists usage_events_check_idx on public.usage_events (check_id);
create index if not exists usage_events_report_idx on public.usage_events (report_id);
create index if not exists usage_events_api_key_idx on public.usage_events (api_key_id);

-- An event's check, report and key belong to its account. Checked when the row is written.
create or replace function public.usage_events_references()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.check_id is not null and not exists (
       select 1 from public.checks c join public.sites s on s.id = c.site_id
        where c.id = new.check_id and s.account_id = new.account_id) then
    raise exception 'usage_events: check_id must be a check of the event''s account' using errcode = '23503';
  end if;
  if new.report_id is not null and not exists (
       select 1 from public.reports r where r.id = new.report_id and r.account_id = new.account_id) then
    raise exception 'usage_events: report_id must be a report of the event''s account' using errcode = '23503';
  end if;
  if new.api_key_id is not null and not exists (
       select 1 from public.api_keys k where k.id = new.api_key_id and k.account_id = new.account_id) then
    raise exception 'usage_events: api_key_id must be a key of the event''s account' using errcode = '23503';
  end if;
  return new;
end;
$$;

-- Refuses UPDATE, DELETE and TRUNCATE whoever writes. Let through, as fix_events_append_only does: the
-- delete of an event whose account no longer exists, and an update that only clears check_id,
-- report_id or api_key_id once the row it named no longer exists (their foreign keys' set null).
create or replace function public.usage_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.accounts a where a.id = old.account_id) then
      return old;
    end if;
  elsif tg_op = 'UPDATE' then
    if (new.id, new.account_id, new.kind, new.result, new.billable, new.compute_seconds,
        new.request_count, new.occurred_at, new.idempotency_key)
         is not distinct from
       (old.id, old.account_id, old.kind, old.result, old.billable, old.compute_seconds,
        old.request_count, old.occurred_at, old.idempotency_key)
       and (new.check_id is not distinct from old.check_id
            or (new.check_id is null and not exists (select 1 from public.checks c where c.id = old.check_id)))
       and (new.report_id is not distinct from old.report_id
            or (new.report_id is null and not exists (select 1 from public.reports r where r.id = old.report_id)))
       and (new.api_key_id is not distinct from old.api_key_id
            or (new.api_key_id is null and not exists (select 1 from public.api_keys k where k.id = old.api_key_id)))
    then
      return new;
    end if;
  end if;
  raise exception 'usage_events is append-only' using errcode = '55000';
end;
$$;

revoke all on function public.usage_events_references() from public, anon, authenticated, service_role;
revoke all on function public.usage_events_append_only() from public, anon, authenticated, service_role;

drop trigger if exists usage_events_references on public.usage_events;
create trigger usage_events_references before insert on public.usage_events
  for each row execute function public.usage_events_references();
drop trigger if exists usage_events_append_only on public.usage_events;
create trigger usage_events_append_only before update or delete on public.usage_events
  for each row execute function public.usage_events_append_only();
drop trigger if exists usage_events_no_truncate on public.usage_events;
create trigger usage_events_no_truncate before truncate on public.usage_events
  for each statement execute function public.usage_events_append_only();

-- Members read what was delivered and whether it was billable; not the compute, the request count,
-- the references or the idempotency key.
alter table public.usage_events enable row level security;

drop policy if exists usage_events_member_read on public.usage_events;
create policy usage_events_member_read on public.usage_events
  for select to authenticated using (public.is_member(account_id));

revoke all on table public.usage_events from public, anon, authenticated;
grant all on table public.usage_events to service_role;
grant select (id, account_id, kind, result, billable, occurred_at) on public.usage_events to authenticated;

-- ─── The ledger's first partitions ────────────────────────────────────────────────────────────────
-- As 003: this month and the three after it.

select public.v2_premake_month_partitions(
  date_trunc('month', now())::date, (date_trunc('month', now()) + interval '3 months')::date);
