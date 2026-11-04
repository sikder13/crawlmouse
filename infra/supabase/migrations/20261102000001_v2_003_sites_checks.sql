-- v2 migration 003 (ARCH-2 §6.1): the check-data tables.
--
-- Additive only. It creates measurement_lineages, sites, checks, page_results, link_edges,
-- access_tests, site_fixes, fix_events, changes, evidence_blobs, alert_rules, alert_events, reports,
-- report_schedules, share_links, api_keys, deploy_hooks and seat_sites; adds seats.client_scope_all
-- and frontier.check_id / frontier_politeness.check_id; creates is_member_for_site(); and replaces
-- apply_entitlement_transition() with a body that also applies the site effects. No existing table,
-- column, policy or grant is dropped or renamed. v1 reads none of the new objects.
--
-- Data foundations (CC-06b, docs/specs/v2/06b-data-foundations.md). Each measurement row names the
-- lineage that produced it (measurement_lineages). page_results, link_edges and access_tests are
-- partitioned by the month their check was queued (checks.check_month), with the partitions in the
-- schema `partitions`, which no client role can use; v2_premake_month_partitions() creates them.
-- checks and access_tests carry their measurement status as generated columns.
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
--
-- What these comments state about access, constraints and re-running is tested by:
--   pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-003-check-tables.test.ts \
--   __tests__/v2-003-cross-account.test.ts __tests__/v2-003-site-effects.test.ts \
--   __tests__/v2-contract-guard.test.ts __tests__/v2-003-contract-fixtures.test.ts

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

-- ─── measurement_lineages ─────────────────────────────────────────────────────────────────────────
-- What produced a measurement: the engine build, the detector rules, the crawler registry, the worker
-- release when a worker took part, and the graded-population definition where one applies. One row
-- per distinct combination, shared by every row it produced, so a time series can be split wherever
-- any of them changed.

create table if not exists public.measurement_lineages (
  id uuid primary key default gen_random_uuid(),
  engine_sha text not null,
  detector_ruleset_version text not null,
  -- sha256 of the registry's serialised entries (crawlerRegistryVersion in packages/types/src/v2).
  crawler_registry_version text not null,
  worker_release text,
  population_version text,
  created_at timestamptz not null default now(),
  constraint measurement_lineages_engine_sha check (engine_sha ~ '^[0-9a-f]{40}$'),
  constraint measurement_lineages_detector_ruleset_version check (
    detector_ruleset_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint measurement_lineages_crawler_registry_version check (
    crawler_registry_version ~ '^[0-9a-f]{64}$'),
  constraint measurement_lineages_worker_release check (worker_release ~ '^[!-~]{1,200}$'),
  constraint measurement_lineages_population_version check (
    population_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint measurement_lineages_uq unique nulls not distinct (
    engine_sha, detector_ruleset_version, crawler_registry_version, worker_release, population_version)
);

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
  paused_reason text check (paused_reason in ('trial_ended', 'over_limit', 'staging_not_in_plan', 'user')),
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
  constraint sites_staging_kept check (account_id is not null or staging_of_site_id is null),
  -- Only a staging site is paused for want of staging in the plan.
  constraint sites_staging_pause check (
    paused_reason is distinct from 'staging_not_in_plan' or staging_of_site_id is not null)
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
  -- The lineage the grading ran under; per-row lineages are on the measurement tables.
  lineage_id uuid references public.measurement_lineages (id),
  -- Database only: the UTC month the check was queued, the partition key of its measurement rows.
  check_month date generated always as ((date_trunc('month', queued_at at time zone 'UTC'))::date) stored,
  -- The contract's MeasurementStatus of each grade (technicalSeoStatus and aiReadabilityStatus in
  -- packages/types/src/v2/measurement.ts): null until the check has ended.
  technical_seo_status text generated always as (case
    when status not in ('finished', 'partial', 'failed') then null
    when technical_seo is null or technical_seo = 'null'::jsonb then 'not_measurable'
    when technical_seo -> 'refusal' -> 'refused' = 'true'::jsonb then 'withheld'
    else 'measured' end) stored
    check (technical_seo_status in ('measured', 'not_measurable', 'unevaluable', 'withheld')),
  ai_readability_status text generated always as (case
    when status not in ('finished', 'partial', 'failed') then null
    when ai_readability is null or ai_readability = 'null'::jsonb then 'not_measurable'
    when ai_readability -> 'withheld' = 'true'::jsonb then 'withheld'
    else 'measured' end) stored
    check (ai_readability_status in ('measured', 'not_measurable', 'unevaluable', 'withheld')),
  constraint checks_id_site_uq unique (id, site_id),
  constraint checks_id_month_uq unique (id, check_month),
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
    status in ('finished', 'partial') or (technical_seo is null and ai_readability is null)),
  constraint checks_lineage check ((status in ('finished', 'partial')) = (lineage_id is not null)),
  -- The two values the generated statuses read are present and boolean (coalesce: a CHECK passes a
  -- null), so the database and the contract's functions read every stored grade the same way. The
  -- rest of each grade is the writer's to parse.
  constraint checks_technical_seo_refused check (
    technical_seo is null or technical_seo = 'null'::jsonb
    or coalesce(jsonb_typeof(technical_seo -> 'refusal' -> 'refused') = 'boolean', false)),
  constraint checks_ai_readability_withheld check (
    ai_readability is null or ai_readability = 'null'::jsonb
    or coalesce(jsonb_typeof(ai_readability -> 'withheld') = 'boolean', false))
);

create index if not exists checks_site_queued_idx on public.checks (site_id, queued_at desc);
create index if not exists checks_lineage_idx on public.checks (lineage_id);
create index if not exists checks_previous_idx on public.checks (previous_check_id);
create index if not exists checks_active_idx on public.checks (status) where status in ('queued', 'running');
create index if not exists checks_expires_idx on public.checks (expires_at) where expires_at is not null;

-- ─── Shape functions for page_results' CHECKs ───────────────────────────────────────────────────
-- Immutable and side-effect free; a CHECK that calls one needs EXECUTE for the role that writes, so
-- service_role holds it here and crawl_worker in 007. Each returns null for a null argument (strict),
-- which a CHECK accepts: nullability is the column's. A jsonb null document reads as null to the
-- contract, so the shape functions of nullable columns accept it too.

-- The contract's HttpUrl, by scheme only (it also parses the URL, which Postgres cannot). The contract
-- trims JavaScript whitespace before it reads the scheme, so the same leading characters are allowed.
create or replace function public.v2_http_url_ok(p_url text)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$ select p_url ~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*https?://' $f$;

-- A jsonb string that is the contract's crawledText(p_max_bytes, p_min_length): within the UTF-8 byte
-- budget and at least that long. (Postgres text cannot hold NUL or a lone surrogate.)
create or replace function public.v2_crawled_text_ok(p_value jsonb, p_max_bytes integer, p_min_length integer)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$
  select case when jsonb_typeof(p_value) = 'string'
              then octet_length(p_value #>> '{}') <= p_max_bytes and length(p_value #>> '{}') >= p_min_length
              else false end
$f$;

-- A jsonb value that is null or a string the HttpUrl check accepts.
create or replace function public.v2_nullable_url_ok(p_value jsonb)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$
  select case jsonb_typeof(p_value)
           when 'null' then true
           when 'string' then public.v2_http_url_ok(p_value #>> '{}')
           else false end
$f$;

-- RedirectChain's shape: exactly hops and loop; at most 6 hops (MAX_REDIRECT_HOPS), each exactly
-- from (HttpUrl), status (an HTTP status 100-599) and location (HttpUrl or null). Which statuses a hop
-- may have, and the loop rule, are their own CHECKs.
create or replace function public.v2_redirect_shape_ok(p_redirect jsonb)
returns boolean language plpgsql immutable strict set search_path = pg_catalog
as $f$
declare
  v_hop jsonb;
begin
  -- One test per statement: SQL does not promise to evaluate OR left to right, and a cast must not
  -- run before its type is known.
  if jsonb_typeof(p_redirect) = 'null' then return true; end if;
  if jsonb_typeof(p_redirect) <> 'object' then return false; end if;
  if p_redirect - array['hops', 'loop'] <> '{}'::jsonb then return false; end if;
  if jsonb_typeof(p_redirect -> 'loop') is distinct from 'boolean' then return false; end if;
  if jsonb_typeof(p_redirect -> 'hops') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_redirect -> 'hops') > 6 then return false; end if;
  for v_hop in select e from jsonb_array_elements(p_redirect -> 'hops') e loop
    if jsonb_typeof(v_hop) <> 'object' then return false; end if;
    if not (v_hop ?& array['from', 'status', 'location']) then return false; end if;
    if v_hop - array['from', 'status', 'location'] <> '{}'::jsonb then return false; end if;
    if jsonb_typeof(v_hop -> 'from') <> 'string' then return false; end if;
    if not public.v2_http_url_ok(v_hop ->> 'from') then return false; end if;
    if jsonb_typeof(v_hop -> 'status') <> 'number' then return false; end if;
    if (v_hop ->> 'status')::numeric not between 100 and 599 then return false; end if;
    if (v_hop ->> 'status')::numeric <> trunc((v_hop ->> 'status')::numeric) then return false; end if;
    if not public.v2_nullable_url_ok(v_hop -> 'location') then return false; end if;
  end loop;
  return true;
end;
$f$;

-- The redirect_status rule: every hop answered a redirect status the worker follows
-- (REDIRECT_STATUSES). A hop of another shape is the shape CHECK's to refuse.
create or replace function public.v2_redirect_statuses_ok(p_redirect jsonb)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$
  select case when jsonb_typeof(p_redirect -> 'hops') = 'array'
              then not exists (
                select 1 from jsonb_array_elements(p_redirect -> 'hops') h
                 where jsonb_typeof(h -> 'status') = 'number'
                   and (h -> 'status') not in ('301', '302', '303', '307', '308'))
              else true end
$f$;

-- DeclaredCanonical's shape: exactly href (crawled text, 1 to 8,192 UTF-8 bytes, or null) and url
-- (HttpUrl or null). The canonical_href rule is its own CHECK.
create or replace function public.v2_canonical_shape_ok(p_canonical jsonb)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$
  select case when jsonb_typeof(p_canonical) = 'null' then true
              when jsonb_typeof(p_canonical) = 'object'
                   and p_canonical ?& array['href', 'url']
                   and p_canonical - array['href', 'url'] = '{}'::jsonb
              then (p_canonical -> 'href' = 'null'::jsonb
                    or public.v2_crawled_text_ok(p_canonical -> 'href', 8192, 1))
                   and public.v2_nullable_url_ok(p_canonical -> 'url')
              else false end
$f$;

-- Hreflang's shape: exactly links and complete; at most 256 links (MAX_HREFLANG_LINKS), each exactly
-- hreflang (crawled text, 1 to 256 UTF-8 bytes) and href (HttpUrl).
create or replace function public.v2_hreflang_shape_ok(p_hreflang jsonb)
returns boolean language plpgsql immutable strict set search_path = pg_catalog
as $f$
declare
  v_link jsonb;
begin
  -- One test per statement, as v2_redirect_shape_ok.
  if jsonb_typeof(p_hreflang) = 'null' then return true; end if;
  if jsonb_typeof(p_hreflang) <> 'object' then return false; end if;
  if p_hreflang - array['links', 'complete'] <> '{}'::jsonb then return false; end if;
  if jsonb_typeof(p_hreflang -> 'complete') is distinct from 'boolean' then return false; end if;
  if jsonb_typeof(p_hreflang -> 'links') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_hreflang -> 'links') > 256 then return false; end if;
  for v_link in select e from jsonb_array_elements(p_hreflang -> 'links') e loop
    if jsonb_typeof(v_link) <> 'object' then return false; end if;
    if v_link - array['hreflang', 'href'] <> '{}'::jsonb then return false; end if;
    if not coalesce(public.v2_crawled_text_ok(v_link -> 'hreflang', 256, 1), false) then return false; end if;
    if jsonb_typeof(v_link -> 'href') is distinct from 'string' then return false; end if;
    if not public.v2_http_url_ok(v_link ->> 'href') then return false; end if;
  end loop;
  return true;
end;
$f$;

-- SearchRobots' shape: an array of exactly ua (a non-empty string) and verdict (a Verdict). Which
-- verdicts robots.txt can give, and one entry per ua, are their own CHECKs.
create or replace function public.v2_search_robots_shape_ok(p_robots jsonb)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$
  select case when jsonb_typeof(p_robots) = 'array'
              then not exists (
                select 1 from jsonb_array_elements(p_robots) r
                 -- CASE, not OR: `jsonb - text[]` raises on a scalar, and OR has no evaluation order.
                 where case when jsonb_typeof(r) <> 'object' then true
                            when r - array['ua', 'verdict'] <> '{}'::jsonb then true
                            when jsonb_typeof(r -> 'ua') is distinct from 'string' then true
                            when r ->> 'ua' = '' then true
                            when jsonb_typeof(r -> 'verdict') is distinct from 'string' then true
                            else r ->> 'verdict' not in ('allowed', 'allowed_thin', 'disallowed_by_robots',
                                       'blocked_by_ua_rule', 'challenged_ua', 'refused_unverified',
                                       'rate_limited', 'payment_required', 'edge_blocks_automation',
                                       'redirected_away', 'not_measured')
                       end)
              else false end
$f$;

-- The robots_verdict rule: robots.txt alone gives allowed, disallowed_by_robots or not_measured.
create or replace function public.v2_search_robots_verdicts_ok(p_robots jsonb)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$
  select case when jsonb_typeof(p_robots) = 'array'
              then not exists (
                select 1 from jsonb_array_elements(p_robots) r
                 where jsonb_typeof(r -> 'verdict') = 'string'
                   and r ->> 'verdict' not in ('allowed', 'disallowed_by_robots', 'not_measured'))
              else true end
$f$;

-- The robots_ua_unique rule: one entry per ua.
create or replace function public.v2_search_robots_ua_unique(p_robots jsonb)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$
  select case when jsonb_typeof(p_robots) = 'array'
              then (select count(r -> 'ua') = count(distinct r -> 'ua') from jsonb_array_elements(p_robots) r)
              else true end
$f$;

-- The contract's Header list: an array of at most 32 (MAX_HEADERS), each exactly name (crawled text,
-- 1 to 128 UTF-8 bytes) and value (crawled text, at most 1,024 UTF-8 bytes).
create or replace function public.v2_headers_shape_ok(p_headers jsonb)
returns boolean language plpgsql immutable strict set search_path = pg_catalog
as $f$
declare
  v_header jsonb;
begin
  -- One test per statement, as v2_redirect_shape_ok.
  if jsonb_typeof(p_headers) <> 'array' then return false; end if;
  if jsonb_array_length(p_headers) > 32 then return false; end if;
  for v_header in select e from jsonb_array_elements(p_headers) e loop
    if jsonb_typeof(v_header) <> 'object' then return false; end if;
    if v_header - array['name', 'value'] <> '{}'::jsonb then return false; end if;
    if not coalesce(public.v2_crawled_text_ok(v_header -> 'name', 128, 1), false) then return false; end if;
    if not coalesce(public.v2_crawled_text_ok(v_header -> 'value', 1024, 0), false) then return false; end if;
  end loop;
  return true;
end;
$f$;

revoke all on function public.v2_http_url_ok(text), public.v2_crawled_text_ok(jsonb, integer, integer),
  public.v2_nullable_url_ok(jsonb), public.v2_redirect_shape_ok(jsonb),
  public.v2_redirect_statuses_ok(jsonb), public.v2_canonical_shape_ok(jsonb),
  public.v2_hreflang_shape_ok(jsonb), public.v2_search_robots_shape_ok(jsonb),
  public.v2_search_robots_verdicts_ok(jsonb), public.v2_search_robots_ua_unique(jsonb),
  public.v2_headers_shape_ok(jsonb)
  from public, anon, authenticated;
grant execute on function public.v2_http_url_ok(text), public.v2_crawled_text_ok(jsonb, integer, integer),
  public.v2_nullable_url_ok(jsonb), public.v2_redirect_shape_ok(jsonb),
  public.v2_redirect_statuses_ok(jsonb), public.v2_canonical_shape_ok(jsonb),
  public.v2_hreflang_shape_ok(jsonb), public.v2_search_robots_shape_ok(jsonb),
  public.v2_search_robots_verdicts_ok(jsonb), public.v2_search_robots_ua_unique(jsonb),
  public.v2_headers_shape_ok(jsonb)
  to service_role;

-- ─── page_results and link_edges ──────────────────────────────────────────────────────────────────
-- Keyed by sha256 hex of the UTF-8 URL, as frontier.url_hash, set by a trigger because the
-- text-to-bytes conversion is not immutable and so cannot be a generated column.
--
-- Partitioned by check_month. The foreign key (check_id, check_month) to checks keeps every row of a
-- check in the partition of the month the check was queued, so dropping a partition never splits a
-- check. A key that names a row includes check_month, as a partitioned table requires.

create table if not exists public.page_results (
  check_id uuid not null,
  check_month date not null,
  lineage_id uuid not null references public.measurement_lineages (id),
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
  final_url text,
  redirect jsonb,
  canonical_declared jsonb,
  hreflang jsonb,
  content_simhash text,
  is_html boolean not null,
  links_read boolean not null,
  robots_search jsonb not null,
  -- The vantage of the fetch, as the worker returns it on its crawl row.
  identity_sent text not null,
  source_ip_class text not null check (source_ip_class in ('fly_egress', 'browser_rendering', 'owner_logs')),
  request_headers jsonb not null default '[]',
  headers jsonb not null default '[]',
  primary key (check_id, url_hash, check_month),
  constraint page_results_check_fkey foreign key (check_id, check_month)
    references public.checks (id, check_month) on delete cascade,
  -- The bounds of the contract's PageResult that the column types do not hold. crawl_worker writes
  -- this table straight from the worker, so the database checks them (owner ruling 1). A URL's
  -- scheme only: the contract also parses the URL (v2_http_url_ok).
  constraint page_results_url check (public.v2_http_url_ok(url)),
  constraint page_results_suggested_parent_url check (public.v2_http_url_ok(suggested_parent_url)),
  constraint page_results_final_url check (public.v2_http_url_ok(final_url)),
  constraint page_results_redirect check (public.v2_redirect_shape_ok(redirect)),
  constraint page_results_canonical_declared check (public.v2_canonical_shape_ok(canonical_declared)),
  constraint page_results_hreflang check (public.v2_hreflang_shape_ok(hreflang)),
  constraint page_results_content_simhash check (content_simhash ~ '^[0-9a-f]{16}$'),
  constraint page_results_robots_search check (public.v2_search_robots_shape_ok(robots_search)),
  -- The enum CHECK on the column holds the values; `<@` also accepts an array of arrays.
  constraint page_results_content_failures check (array_ndims(content_failures) = 1),
  constraint page_results_template_key check (starts_with(template_key, '/')),
  constraint page_results_status_code check (status_code between 100 and 599),
  constraint page_results_depth check (depth >= 0),
  constraint page_results_links_in check (links_in >= 0),
  constraint page_results_links_out check (links_out >= 0),
  constraint page_results_crawlers_reached check (crawlers_reached >= 0),
  constraint page_results_crawlers_reading_text check (crawlers_reading_text >= 0),
  -- NaN sorts above every number in Postgres, so it is refused too.
  constraint page_results_pagerank_share check (pagerank_share >= 0 and pagerank_share <= 1),
  -- The contract's date is YYYY-MM-DD, years 0000 to 9999. Postgres has no year 0 (the date type
  -- refuses it), so a writer must not pass one; this refuses after 9999 and before 1 AD.
  constraint page_results_sitemap_lastmod check (
    sitemap_lastmod between date '0001-01-01' and date '9999-12-31'),
  -- Exactly the four keys, counts that are safe integers ≥ 0, a share in 0..1 and a JsTextState.
  -- Each value is read only after its type is known (CASE), so a wrong type refuses, never errors; a
  -- missing key has no type and refuses the same way.
  constraint page_results_without_js check (
    without_js is null or without_js = 'null'::jsonb or case
      -- CASE, not AND: `jsonb - text[]` raises on a scalar.
      when jsonb_typeof(without_js) <> 'object' then false
      else (
      without_js - array['raw_words', 'rendered_words', 'text_share', 'state'] = '{}'::jsonb
      and case when jsonb_typeof(without_js -> 'raw_words') = 'number'
               then (without_js ->> 'raw_words')::numeric between 0 and 9007199254740991
                    and (without_js ->> 'raw_words')::numeric = trunc((without_js ->> 'raw_words')::numeric)
               else false end
      and case when jsonb_typeof(without_js -> 'rendered_words') = 'number'
               then (without_js ->> 'rendered_words')::numeric between 0 and 9007199254740991
                    and (without_js ->> 'rendered_words')::numeric
                        = trunc((without_js ->> 'rendered_words')::numeric)
               else false end
      and case when jsonb_typeof(without_js -> 'text_share') = 'number'
               then (without_js ->> 'text_share')::numeric between 0 and 1
               else false end
      and case when jsonb_typeof(without_js -> 'state') = 'string'
               then without_js ->> 'state' in ('readable', 'partial', 'empty_shell')
               else false end) end),
  -- The contract's PageResult rules.
  constraint page_results_links_read_html check (not links_read or is_html),
  constraint page_results_redirect_status check (public.v2_redirect_statuses_ok(redirect)),
  constraint page_results_redirect_loop check (
    redirect is null or case when redirect -> 'loop' = 'true'::jsonb
                                  and jsonb_typeof(redirect -> 'hops') = 'array'
                             then jsonb_array_length(redirect -> 'hops') > 0
                             else true end),
  constraint page_results_canonical_href check (
    canonical_declared is null
    or coalesce(canonical_declared -> 'url', 'null'::jsonb) = 'null'::jsonb
    or canonical_declared -> 'href' is distinct from 'null'::jsonb),
  constraint page_results_robots_verdict check (public.v2_search_robots_verdicts_ok(robots_search)),
  constraint page_results_robots_ua_unique check (public.v2_search_robots_ua_unique(robots_search)),
  -- The contract's crawledText(512, 1), and its Header lists.
  constraint page_results_identity_sent check (identity_sent <> '' and octet_length(identity_sent) <= 512),
  constraint page_results_request_headers check (public.v2_headers_shape_ok(request_headers)),
  constraint page_results_headers check (public.v2_headers_shape_ok(headers))
) partition by range (check_month);

create index if not exists page_results_template_idx on public.page_results (check_id, template_key);
create index if not exists page_results_orphan_idx on public.page_results (check_id) where is_orphan;

create table if not exists public.link_edges (
  check_id uuid not null,
  check_month date not null,
  lineage_id uuid not null references public.measurement_lineages (id),
  from_url text not null,
  to_url text not null,
  from_hash text not null,
  to_hash text not null,
  anchor_text text not null,
  is_generic_anchor boolean not null,
  js_only boolean not null,
  primary key (check_id, from_hash, to_hash, check_month),
  constraint link_edges_check_fkey foreign key (check_id, check_month)
    references public.checks (id, check_month) on delete cascade
) partition by range (check_month);

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

-- Partitioned by check_month, as page_results.
create table if not exists public.access_tests (
  id uuid not null default gen_random_uuid(),
  check_id uuid not null,
  check_month date not null,
  lineage_id uuid not null references public.measurement_lineages (id),
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
  method text check (method in ('GET')),
  http_version text check (http_version in ('1.1')),
  -- The contract's MeasurementStatus of the verdict (verdictStatus in
  -- packages/types/src/v2/measurement.ts).
  measurement_status text generated always as (case verdict
    when 'not_measured' then 'unevaluable'
    when 'edge_blocks_automation' then 'not_measurable'
    else 'measured' end) stored not null
    check (measurement_status in ('measured', 'not_measurable', 'unevaluable', 'withheld')),
  primary key (id, check_month),
  constraint access_tests_check_fkey foreign key (check_id, check_month)
    references public.checks (id, check_month) on delete cascade,
  constraint access_tests_observed_owner_logs check (
    (evidence_class = 'observed') = (source_ip_class = 'owner_logs')),
  constraint access_tests_request_line check ((method is null) = (http_version is null))
) partition by range (check_month);

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
  gone jsonb,
  constraint site_fixes_id_site_uq unique (id, site_id),
  constraint site_fixes_site_fingerprint_uq unique (site_id, fingerprint),
  constraint site_fixes_last_measured_check_fkey foreign key (last_measured_check_id, site_id)
    references public.checks (id, site_id),
  constraint site_fixes_first_seen_check_fkey foreign key (first_seen_check_id, site_id)
    references public.checks (id, site_id),
  -- The contract's Fix rules (LAST_STATE_FOR_STATUS, fix_rank, packet_framework, effect_pending,
  -- fix_gone).
  constraint site_fixes_last_state check (case status
    when 'open' then last_state in ('detected', 'indeterminate')
    when 'reopened' then last_state in ('detected', 'indeterminate')
    when 'verified_resolved' then last_state in ('not_detected', 'indeterminate')
    when 'unable_to_verify' then last_state = 'indeterminate'
    else true end),
  constraint site_fixes_gone check (gone is null or gone = 'null'::jsonb or last_state = 'indeterminate'),
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
  -- Deferred: deleting a site removes its checks and its fixes (with their events) in one statement,
  -- and the events go only after the checks they cite. Checked at commit, so a delete of a check
  -- that an event still cites fails then.
  check_id uuid references public.checks (id) deferrable initially deferred,
  -- marked_done records who; the other kinds record the check that measured the fix.
  constraint fix_events_kind_fields check (case
    when kind = 'marked_done' then check_id is null
    else check_id is not null and by_seat_id is null end)
);

create index if not exists fix_events_fix_at_idx on public.fix_events (fix_id, at);
create index if not exists fix_events_check_idx on public.fix_events (check_id);
create index if not exists fix_events_seat_idx on public.fix_events (by_seat_id);

-- Refuses UPDATE, DELETE and TRUNCATE whichever role writes (the service role included). Two writes are let through, both made by a
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

-- An event's check is a check of its fix's site, and its seat a seat of that site's account.
create or replace function public.fix_events_references()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.check_id is not null and not exists (
       select 1 from public.site_fixes f join public.checks c on c.site_id = f.site_id
        where f.id = new.fix_id and c.id = new.check_id) then
    raise exception 'fix_events: check_id must be a check of the fix''s site' using errcode = '23503';
  end if;
  if new.by_seat_id is not null and not exists (
       select 1 from public.site_fixes f join public.sites s on s.id = f.site_id
         join public.seats st on st.account_id = s.account_id
        where f.id = new.fix_id and st.id = new.by_seat_id) then
    raise exception 'fix_events: by_seat_id must be a seat of the fix''s account' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.fix_events_references() from public, anon, authenticated, service_role;

drop trigger if exists fix_events_append_only on public.fix_events;
create trigger fix_events_append_only before update or delete on public.fix_events
  for each row execute function public.fix_events_append_only();
drop trigger if exists fix_events_references on public.fix_events;
create trigger fix_events_references before insert on public.fix_events
  for each row execute function public.fix_events_references();
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
  kind text not null check (kind in ('opened', 'resolved', 'changed', 'baseline')),
  severity text check (severity in ('bad', 'warn', 'info')),
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
    references public.site_fixes (id, site_id) on delete set null (fix_id),
  -- The contract's Change rules (change_severity, change_resolved_info).
  constraint changes_severity check ((kind in ('opened', 'resolved')) = (severity is not null)),
  constraint changes_resolved_info check (kind <> 'resolved' or severity is null or severity = 'info')
);

-- A retried diff cannot write the same change twice.
create unique index if not exists changes_idempotency_uq
  on public.changes (check_id, kind, subject, "where", ua, fix_id) nulls not distinct;
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
  -- One of the rule's account's checks (alert_rules_fired_check_scope).
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

-- Slack is a paid-plan channel (GATES in apps/web/lib/entitlement-v2.ts). A write that adds Slack to
-- a rule (an insert with it, an update that adds it or moves the rule to another account) is refused
-- when the account's effective tier is Free, as effectiveTier() there computes it: a no-card Pro trial
-- is Free from trial_ends_at, and past_due keeps past_due_tier for 168 hours from past_due_since. A
-- rule that already sends to Slack can still be updated after a downgrade, so it can be switched off
-- and alertFn can record when it fired; whether to send is alertFn's decision at send time. The
-- trigger runs AFTER the row's RLS check, so a client learns nothing about an account it cannot
-- write to, and it runs for every writer, the service role included.
create or replace function public.alert_rules_entitlement_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tier text;
begin
  if 'slack' = any (new.channels)
     and (tg_op = 'INSERT' or not ('slack' = any (old.channels)) or new.account_id <> old.account_id) then
    select case
             when a.state = 'pro_trial' and a.trial_variant = 'no_card'
               then case when now() < a.trial_ends_at then a.tier else 'free' end
             when a.state = 'past_due'
               then case when now() < a.past_due_since + interval '168 hours' then a.past_due_tier else 'free' end
             else a.tier
           end
      into v_tier
      from public.accounts a
     where a.id = new.account_id;
    if v_tier is null or v_tier not in ('pro', 'agency') then
      raise exception 'alert_rules: Slack alerts need a paid plan' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;

-- The check a rule last fired on is one of the rule's account's, and of its site for a site rule.
create or replace function public.alert_rules_fired_check_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.last_fired_check_id is not null and not exists (
       select 1 from public.checks c join public.sites s on s.id = c.site_id
        where c.id = new.last_fired_check_id and s.account_id = new.account_id
          and (new.site_id is null or c.site_id = new.site_id)) then
    raise exception 'alert_rules: last_fired_check_id must be a check of the rule''s sites'
      using errcode = '23503';
  end if;
  return null;
end;
$$;

revoke all on function public.alert_rules_entitlement_check() from public, anon, authenticated, service_role;
revoke all on function public.alert_rules_fired_check_scope() from public, anon, authenticated, service_role;

drop trigger if exists alert_rules_entitlement_check on public.alert_rules;
create trigger alert_rules_entitlement_check after insert or update on public.alert_rules
  for each row execute function public.alert_rules_entitlement_check();
drop trigger if exists alert_rules_fired_check_scope on public.alert_rules;
create trigger alert_rules_fired_check_scope after insert or update on public.alert_rules
  for each row execute function public.alert_rules_fired_check_scope();

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

-- An event's rule belongs to the account of the event's site, and is account-wide or that site's.
create or replace function public.alert_events_rule_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not exists (
       select 1 from public.alert_rules r join public.sites s on s.account_id = r.account_id
        where r.id = new.rule_id and s.id = new.site_id and (r.site_id is null or r.site_id = s.id)) then
    raise exception 'alert_events: the rule must be one of the site''s account''s' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.alert_events_rule_scope() from public, anon, authenticated, service_role;

drop trigger if exists alert_events_rule_scope on public.alert_events;
create trigger alert_events_rule_scope before insert or update of rule_id, site_id on public.alert_events
  for each row execute function public.alert_events_rule_scope();

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

-- ─── Monthly partitions ───────────────────────────────────────────────────────────────────────────
-- A partition is a table of its own, and on production a new table in `public` would arrive with
-- every privilege for anon and authenticated (pg_default_acl). Partitions are therefore created in
-- the schema `partitions`, which no client role may use, each with RLS on and every role's
-- privileges revoked. A row is read and written through its parent, whose grants and policies apply.
--
-- v2_premake_month_partitions(from, through) creates each missing month from the month of `from` to
-- the month of `through` (inclusive, at most 37 months) for every table in `public` or `research` that is range-partitioned
-- on one date column named check_month or observed_month, found from the catalog, so a table
-- partitioned later is covered without editing this function. It returns how many it created. There
-- is no default partition: a row for a month that has no partition is refused, not misfiled. Postgres
-- clones a parent's row triggers onto a new partition but not its statement triggers, so each of the
-- parent's TRUNCATE triggers (the ledger's append-only rule) is created on the partition too. Run
-- daily by the owner's pg_cron job (docs/specs/v2/06b-data-foundations.md, runbook).

create schema if not exists partitions;
revoke all on schema partitions from public, anon, authenticated;

create or replace function public.v2_premake_month_partitions(p_from date, p_through date)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_parent record;
  v_trigger record;
  v_first date;
  v_last date;
  v_month date;
  v_name text;
  v_role text;
  v_made integer := 0;
begin
  if p_from is null or p_through is null then
    raise exception 'partitions: from and through are required' using errcode = '22004';
  end if;
  v_first := date_trunc('month', p_from)::date;
  v_last := date_trunc('month', p_through)::date;
  if v_last < v_first or v_last >= v_first + interval '37 months' then
    raise exception 'partitions: % to % is not a range of at most 37 months', p_from, p_through
      using errcode = '22023';
  end if;
  for v_parent in
    select c.oid as parent_oid, n.nspname as schema_name, c.relname
      from pg_partitioned_table pt
      join pg_class c on c.oid = pt.partrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = pt.partattrs[0]
     where n.nspname in ('public', 'research')
       and pt.partstrat = 'r'
       and pt.partnatts = 1
       and a.attname in ('check_month', 'observed_month')
       and a.atttypid = 'date'::regtype
     order by 1, 2
  loop
    v_month := v_first;
    while v_month <= v_last loop
      v_name := format('%s_%s_%s', v_parent.schema_name, v_parent.relname, to_char(v_month, 'YYYY_MM'));
      if to_regclass(format('partitions.%I', v_name)) is null then
        execute format('create table partitions.%I partition of %I.%I for values from (%L) to (%L)',
                       v_name, v_parent.schema_name, v_parent.relname,
                       v_month, (v_month + interval '1 month')::date);
        execute format('alter table partitions.%I enable row level security', v_name);
        execute format('revoke all on table partitions.%I from public', v_name);
        for v_role in
          select rolname from pg_roles
           where rolname in ('anon', 'authenticated', 'service_role', 'crawl_worker', 'research_retention')
        loop
          execute format('revoke all on table partitions.%I from %I', v_name, v_role);
        end loop;
        for v_trigger in
          select t.tgname, t.tgfoid::regproc::text as fn
            from pg_trigger t
           where t.tgrelid = v_parent.parent_oid and not t.tgisinternal
             and (t.tgtype & 32) <> 0  -- TRUNCATE
        loop
          execute format('create trigger %I before truncate on partitions.%I for each statement execute function %s()',
                         v_trigger.tgname, v_name, v_trigger.fn);
        end loop;
        v_made := v_made + 1;
      end if;
      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;
  return v_made;
end;
$$;

revoke all on function public.v2_premake_month_partitions(date, date) from public, anon, authenticated;
grant execute on function public.v2_premake_month_partitions(date, date) to service_role;

-- ─── RLS ──────────────────────────────────────────────────────────────────────────────────────────

alter table public.measurement_lineages enable row level security;
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

-- A lineage's columns are build and version identifiers the server writes (06b §1); the database
-- checks their shape, not their meaning. It is shared by every row it produced and names no account
-- column, so any signed-in user may read it.
drop policy if exists measurement_lineages_read on public.measurement_lineages;
create policy measurement_lineages_read on public.measurement_lineages
  for select to authenticated using (true);

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
-- rule is read by any member and written by the owner (seats_owner_unscoped keeps owner seats unscoped).
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

revoke all on table public.measurement_lineages, public.sites, public.checks, public.page_results,
  public.link_edges, public.access_tests, public.site_fixes, public.fix_events, public.changes,
  public.evidence_blobs, public.alert_rules, public.alert_events, public.reports,
  public.report_schedules, public.share_links, public.api_keys, public.deploy_hooks, public.seat_sites
  from public, anon, authenticated;

grant all on table public.measurement_lineages, public.sites, public.checks, public.page_results,
  public.link_edges, public.access_tests, public.site_fixes, public.fix_events, public.changes,
  public.evidence_blobs, public.alert_rules, public.alert_events, public.reports,
  public.report_schedules, public.share_links, public.api_keys, public.deploy_hooks, public.seat_sites
  to service_role;

grant select (client_scope_all) on public.seats to authenticated;

grant select (
  id, engine_sha, detector_ruleset_version, crawler_registry_version, worker_release,
  population_version, created_at
) on public.measurement_lineages to authenticated;

grant select (
  id, account_id, host, staging_of_site_id, client_name, client_contact_name, client_contact_email,
  schedule_cadence, schedule_iso_weekday, schedule_hour_local, paused_reason, paused, competitor_hosts,
  slack_channel, owner_seat_id, created_at, updated_at, removed_at
) on public.sites to authenticated;
grant select (
  id, site_id, previous_check_id, status, trigger, grade_version, queued_at, started_at, finished_at,
  tested_at, expires_at, deferred_until, failure_reason, result_email, coverage, technical_seo,
  ai_readability, structure, without_js, content, signals, crawlers, stack, competitors, progress,
  lineage_id, check_month, technical_seo_status, ai_readability_status
) on public.checks to authenticated;
grant select (
  check_id, check_month, lineage_id, url, url_hash, template_key, kind, status_code, depth, links_in,
  links_out, pagerank_share, is_orphan, js_only, found_via, sitemap_lastmod, suggested_parent_url,
  sampled, without_js, crawlers_reached, crawlers_reading_text, content_failures, final_url, redirect,
  canonical_declared, hreflang, content_simhash, is_html, links_read, robots_search, identity_sent,
  source_ip_class, request_headers, headers
) on public.page_results to authenticated;
grant select (
  check_id, check_month, lineage_id, from_url, to_url, from_hash, to_hash, anchor_text,
  is_generic_anchor, js_only
) on public.link_edges to authenticated;
grant select (
  id, check_id, check_month, lineage_id, ua, page_url, template_key, tested_at, verdict,
  evidence_class, identity_sent, source_ip_class, limitations, cause, request_headers, raw_status,
  final_url, headers, byte_count, word_count, body_excerpt, method, http_version, measurement_status
) on public.access_tests to authenticated;
grant select (
  id, site_id, check_id, previous_check_id, detected_at, kind, severity, summary, "where",
  pages_affected, ua, grade_deltas, cause, notified
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
-- (apps/web/lib/billing/state-machine-sites.ts), decided as applied() decides them
-- (apps/web/lib/billing/state-machine.ts): pause_others on a move to Free from a paid tier;
-- otherwise pause_over_limit when the site limit falls, resume when it rises.
--
-- They apply to the account's primary sites (not staging, not removed), oldest first by created_at
-- to the millisecond (planSites compares Dates), then id; a site the user paused is not changed but
-- keeps its place in that order. A pause records paused_reason and keeps the schedule; a resume
-- clears it. On a move to Free the oldest site, unless the user paused it, takes Free's monthly
-- check, even if it was checked on deploy (Free has no deploy hooks:
-- GATES.free.stagingAndDeployHooks). Otherwise a timed schedule takes the tier's cadence (Free:
-- monthly, paid: weekly) and a site checked on deploy keeps that cadence, which planSites does not
-- model. A site given a timed cadence without a weekday or hour gets the weekday it was created on,
-- in the account's time zone (UTC if that zone is not one Postgres knows), at 06:00.
--
-- Staging sites (not removed) follow planStagingSites in the same file, on every transition: on a
-- tier without staging and deploy hooks (GATES[tier].stagingAndDeployHooks is false for Free alone)
-- a running staging site pauses as staging_not_in_plan, keeping its schedule; on a tier with them, one
-- paused as staging_not_in_plan runs again. A staging site paused for another reason is not changed.

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
  v_tz text;
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
    v_tz := coalesce((select z.name from pg_timezone_names z where z.name = v_account.timezone limit 1), 'UTC');
    with ordered as (
      select s.id, s.schedule_cadence, s.paused_reason,
             row_number() over (order by date_trunc('milliseconds', s.created_at), s.id) - 1 as place,
             extract(isodow from s.created_at at time zone v_tz)::smallint as created_weekday
        from public.sites s
       where s.account_id = p_account_id
         and s.staging_of_site_id is null
         and s.removed_at is null
    ), target as (
      select o.id, o.created_weekday,
             case
               when v_effect = 'pause_others' and o.place = 0 then 'monthly'
               when o.schedule_cadence = 'on_deploy' then 'on_deploy'
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
           schedule_iso_weekday = case when t.cadence in ('weekly', 'monthly')
                                       then coalesce(s.schedule_iso_weekday, t.created_weekday)
                                       else s.schedule_iso_weekday end,
           schedule_hour_local = case when t.cadence in ('weekly', 'monthly')
                                      then coalesce(s.schedule_hour_local, 6)
                                      else s.schedule_hour_local end,
           paused_reason = t.reason,
           updated_at = now()
      from target t
     where s.id = t.id
       and (s.schedule_cadence is distinct from t.cadence or s.paused_reason is distinct from t.reason);
  end if;

  update public.sites s
     set paused_reason = case when p_tier = 'free' then 'staging_not_in_plan' end,
         updated_at = now()
   where s.account_id = p_account_id
     and s.staging_of_site_id is not null
     and s.removed_at is null
     and s.paused_reason is not distinct from
         case when p_tier = 'free' then null else 'staging_not_in_plan' end;

  return v_account.entitlement_version + 1;
end;
$$;

revoke all on function public.apply_entitlement_transition(
  uuid, integer, text, text, text, timestamptz, text, timestamptz, timestamptz, timestamptz,
  integer, integer, integer, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_entitlement_transition(
  uuid, integer, text, text, text, timestamptz, text, timestamptz, timestamptz, timestamptz,
  integer, integer, integer, timestamptz, text, timestamptz) to service_role;

-- ─── The first partitions ─────────────────────────────────────────────────────────────────────────
-- The month this runs in and the three after it. Rows for an earlier month (004's backfill of
-- migrated audits) need their months created first, by the same function.

select public.v2_premake_month_partitions(
  date_trunc('month', now())::date, (date_trunc('month', now()) + interval '3 months')::date);
