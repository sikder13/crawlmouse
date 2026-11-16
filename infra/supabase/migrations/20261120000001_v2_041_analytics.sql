-- v2 migration 041 (CC-41, the data foundation for growth): first-touch attribution, the research
-- ledger's writer function, and the read path for analysis.
--
-- It creates public.account_attribution, public.check_ledger_drafts, public.record_check_ledger(),
-- the schema `analytics` with its views, and the role analytics_reader. No existing table, column or
-- policy is dropped or changed. One kind of existing grant is: section 5 revokes PUBLIC's SELECT on
-- pg_stat_statements' two views, and records what it revoked so the revert restores it.
--
-- 1. public.account_attribution: one row per account, written once at the account's first login from
--    the visitor's first-party `cm_ft` cookie (apps/web/lib/analytics/first-touch.ts). The CHECKs
--    repeat that module's bounds, so a writer that skips the module is refused here as well. No
--    client role holds anything on it; service_role inserts and reads.
-- 2. public.check_ledger_drafts, the de-identified fields a check's build step leaves for the
--    writer; and public.record_check_ledger(), which writes one ended check's research.check_runs
--    row, its crawler_observations and its check_ledger_links row in one transaction and deletes the
--    check's draft, or, when the check already has a link, only deletes the draft. Both are
--    service_role's alone. The function is plpgsql, so its body records no dependency on the ledger
--    (the 006b guard reads pg_depend).
-- 3. Schema `analytics`: views with no email, name, host, URL, IP or token column, except the two
--    attribution columns named in infra/supabase/checks/10-analytics-no-pii.sql. Each view lists its
--    columns. They are owned by the migration's role, so they read with its rights and RLS does not
--    filter them: what a view exposes is decided by its column list. A check's id is the capability
--    to read, cancel and claim a check nobody keeps (lib/v2/pipeline/public.ts readableCheck), so no
--    view exposes the id of such a check: `checks.id` is null for it, and the fix views hold only the
--    fixes of kept sites.
-- 4. Role analytics_reader: LOGIN with no password (the owner sets one through the runbook),
--    connection limit 3, statement_timeout 30s; USAGE on `analytics` and SELECT on its views.
-- 5. PUBLIC's grants on pg_stat_statements' views, revoked: every role holds what PUBLIC holds, the
--    reader included.
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261120000001_v2_041_analytics.revert.sql.
-- Tested by: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-041-analytics.test.ts

-- ─── 1. First-touch attribution ───────────────────────────────────────────────────────────────────

create table if not exists public.account_attribution (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  utm_source text check (utm_source ~ '^[A-Za-z0-9 ._~+-]{1,100}$'),
  utm_medium text check (utm_medium ~ '^[A-Za-z0-9 ._~+-]{1,100}$'),
  utm_campaign text check (utm_campaign ~ '^[A-Za-z0-9 ._~+-]{1,100}$'),
  utm_content text check (utm_content ~ '^[A-Za-z0-9 ._~+-]{1,100}$'),
  utm_term text check (utm_term ~ '^[A-Za-z0-9 ._~+-]{1,100}$'),
  -- A hostname only: lowercase letters, digits, hyphens and dots, never a scheme, path or query.
  referrer_host text check (
    referrer_host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
    and length(referrer_host) <= 253),
  -- A path on our own site, as a shape: no query or fragment, and a segment that could name something
  -- (an id, a host) is written `~` (first-touch.ts landingShape; this CHECK bounds its alphabet).
  landing_path text check (landing_path ~ '^/[A-Za-z0-9/._~-]{0,199}$'),
  ref text check (ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  first_seen_at timestamptz not null,
  captured_at timestamptz not null default now()
);

alter table public.account_attribution enable row level security;
-- Supabase's default privileges give service_role every privilege on a new table; it keeps the two
-- the first login uses.
revoke all on table public.account_attribution from public, anon, authenticated, service_role;
grant select, insert on table public.account_attribution to service_role;

-- ─── 2. The ledger writer ─────────────────────────────────────────────────────────────────────────

-- What the check's build step computes for the ledger from what only it reads (the crawl batches,
-- whose unanswered pages no persisted row holds, and robots.txt as read), held until the writer
-- records the check's ledger rows and deletes this row. It goes with its check: the anonymous expiry's delete takes it in the same cascade. Its keys are
-- exactly the ledger's own fields, so it can hold nothing the ledger may not (CC-41 rulings Q2, Q13).
create table if not exists public.check_ledger_drafts (
  check_id uuid primary key references public.checks (id) on delete cascade,
  draft jsonb not null,
  created_at timestamptz not null default now(),
  constraint check_ledger_drafts_shape check (
    jsonb_typeof(draft) = 'object'
    and draft ?& array['cms', 'frontend_framework', 'edge_vendor', 'without_js_state', 'share_2xx',
                       'share_3xx', 'share_4xx', 'share_5xx', 'share_unanswered', 'signals_detected',
                       'signals_indeterminate', 'observations']
    and (draft - array['cms', 'frontend_framework', 'edge_vendor', 'without_js_state', 'share_2xx',
                       'share_3xx', 'share_4xx', 'share_5xx', 'share_unanswered', 'signals_detected',
                       'signals_indeterminate', 'observations']) = '{}'::jsonb
    and jsonb_typeof(draft->'observations') = 'array')
);

alter table public.check_ledger_drafts enable row level security;
revoke all on table public.check_ledger_drafts from public, anon, authenticated, service_role;
grant select, insert, delete on table public.check_ledger_drafts to service_role;

-- p_run holds check_runs' columns but id; p_observations is an array of crawler_observations' columns
-- but run_id and observed_month, which are the run's. Returns the run's id: the new one, or the one
-- already linked to the check.
create or replace function public.record_check_ledger(
  p_check_id uuid,
  p_run jsonb,
  p_observations jsonb
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_run uuid;
  v_month date;
begin
  if p_check_id is null or p_run is null or jsonb_typeof(p_observations) is distinct from 'array' then
    raise exception 'record_check_ledger: a check id, a run and an observations array are required'
      using errcode = '22023';
  end if;

  -- One writer per check at a time: the after-finalize write and the backfill may meet.
  perform pg_advisory_xact_lock(hashtextextended('record_check_ledger:' || p_check_id::text, 0));

  select l.run_id into v_run from public.check_ledger_links l where l.check_id = p_check_id limit 1;
  if v_run is not null then
    delete from public.check_ledger_drafts d where d.check_id = p_check_id;
    return v_run;
  end if;

  v_month := (p_run->>'observed_month')::date;
  insert into research.check_runs (
    observed_month, site_key, site_key_version, lineage_id, cms, frontend_framework, edge_vendor,
    without_js_state, share_2xx, share_3xx, share_4xx, share_5xx, share_unanswered,
    signals_detected, signals_indeterminate)
  values (
    v_month,
    p_run->>'site_key',
    (p_run->>'site_key_version')::smallint,
    (p_run->>'lineage_id')::uuid,
    p_run->>'cms',
    p_run->>'frontend_framework',
    p_run->>'edge_vendor',
    p_run->>'without_js_state',
    (p_run->>'share_2xx')::numeric,
    (p_run->>'share_3xx')::numeric,
    (p_run->>'share_4xx')::numeric,
    (p_run->>'share_5xx')::numeric,
    (p_run->>'share_unanswered')::numeric,
    coalesce(array(select jsonb_array_elements_text(p_run->'signals_detected')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_run->'signals_indeterminate')), '{}'))
  returning id into v_run;

  insert into research.crawler_observations (run_id, observed_month, crawler, verdict, cause, robots_rule)
  select v_run, v_month, o->>'crawler', o->>'verdict', o->>'cause', o->>'robots_rule'
    from jsonb_array_elements(p_observations) o;

  insert into public.check_ledger_links (check_id, run_id, observed_month)
  values (p_check_id, v_run, v_month);
  delete from public.check_ledger_drafts d where d.check_id = p_check_id;

  return v_run;
end;
$$;

revoke all on function public.record_check_ledger(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_check_ledger(uuid, jsonb, jsonb) to service_role;

-- ─── 3. The analytics schema ──────────────────────────────────────────────────────────────────────

create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

create or replace view analytics.accounts as
select a.id, a.kind, a.state, a.tier as plan, a.internal, a.created_at, a.trial_variant,
       a.trial_ends_at, a.trial_used_at, a.past_due_since, a.disputed_at, a.deleted_at
  from public.accounts a;

create or replace view analytics.subscriptions as
select s.id, s.account_id, s.plan, s.interval, s.status, s.seat_quantity, s.extra_site_quantity,
       s.price_ids, s.current_period_end, s.trial_end, s.cancel_at_period_end, s.canceled_at,
       s.ended_at, s.created_at, s.updated_at
  from public.subscriptions s;

-- A failure reason is shown only in the shape the pipeline writes (a snake_case code); anything else
-- reads as 'other', so free text cannot reach this view.
-- `id` is null for a check whose site no account keeps: that id is the check's capability.
create or replace view analytics.checks as
select case when s.account_id is null then null else c.id end as id, s.account_id, c.trigger,
       c.status, c.queued_at, c.started_at, c.finished_at,
       extract(epoch from (c.finished_at - c.started_at))::numeric(12, 3) as duration_seconds,
       (c.technical_seo->>'score')::numeric as technical_seo_score, c.technical_seo_status,
       (c.ai_readability->>'score')::numeric as ai_readability_score, c.ai_readability_status,
       c.grade_version, c.lineage_id, l.engine_sha, l.detector_ruleset_version,
       l.crawler_registry_version, l.population_version,
       case when c.failure_reason is null then null
            when c.failure_reason ~ '^[a-z_]{1,40}$' then c.failure_reason
            else 'other' end as failure_reason
  from public.checks c
  join public.sites s on s.id = c.site_id
  left join public.measurement_lineages l on l.id = c.lineage_id;

-- Kept sites only: a fix names checks, and an unkept site's check ids are capabilities.
create or replace view analytics.fixes as
select f.id, s.account_id, f.type, f.section, f.recommendation_class, f.status, f.confidence,
       f.affected_pages, f.rank, f.first_seen_check_id, f.last_measured_check_id
  from public.site_fixes f
  join public.sites s on s.id = f.site_id
 where s.account_id is not null;

create or replace view analytics.fix_events as
select e.id, e.fix_id, s.account_id, e.at, e.kind, e.check_id
  from public.fix_events e
  join public.site_fixes f on f.id = e.fix_id
  join public.sites s on s.id = f.site_id
 where s.account_id is not null;

create or replace view analytics.seats as
select account_id, role, status, count(*)::bigint as seats
  from public.seats
 group by account_id, role, status;

create or replace view analytics.usage_events as
select u.id, u.account_id, u.kind, u.check_id, u.result, u.billable, u.compute_seconds,
       u.request_count, u.occurred_at
  from public.usage_events u;

create or replace view analytics.account_attribution as
select t.account_id, t.utm_source, t.utm_medium, t.utm_campaign, t.utm_content, t.utm_term,
       t.referrer_host, t.landing_path, t.ref, t.first_seen_at, t.captured_at
  from public.account_attribution t;

-- The ledger, by month, crawler and verdict: counts only, no site key and no run. The one view over
-- the ledger the 006b guard allows (apps/web/__tests__/helpers/data-foundations.ts,
-- ALLOWED_LEDGER_VIEW).
create or replace view analytics.ledger_monthly as
select o.observed_month, o.crawler, o.verdict, o.measurement_status,
       count(*)::bigint as observations
  from research.crawler_observations o
 group by o.observed_month, o.crawler, o.verdict, o.measurement_status;

-- Supabase's default privileges may grant a new relation to its client roles; none keeps anything.
revoke all on all tables in schema analytics from public, anon, authenticated, service_role;

-- ─── 4. The reader ────────────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'analytics_reader') then
    create role analytics_reader login noinherit connection limit 3;
  end if;
end;
$$;

alter role analytics_reader connection limit 3;
alter role analytics_reader set statement_timeout = '30s';
grant usage on schema analytics to analytics_reader;
grant select on all tables in schema analytics to analytics_reader;

-- ─── 5. What the reader would hold through PUBLIC ─────────────────────────────────────────────────
--
-- analytics_reader is noinherit and a member of no role, but every role holds what PUBLIC holds, and
-- check 10 reports anything it holds outside `analytics`. pg_stat_statements' two views in
-- `extensions` carry PUBLIC SELECT (`=r/postgres` on production, 2026-11-16) and hold the text of
-- every role's statements. The reader cannot reach them while `extensions` grants it no USAGE; the
-- grant is revoked anyway. dashboard_user has its own grant and keeps it.
-- pg_net's schema `net` is not handled here. Its objects are not the migration role's to revoke on
-- (a dry-run branch, 2026-11-16: "no privileges could be revoked"), and production has no `net`
-- schema. If pg_net is installed while analytics_reader exists, check 10 reports `net` and the dry
-- run fails (docs/ops/go-live.md).
-- Only PUBLIC's grants are revoked. The block fails if PUBLIC still holds one afterwards (a REVOKE by
-- a role that is not the object's owner and holds no grant option only warns) or if any named role's
-- grant changed. What PUBLIC held and lost is kept as JSON in the comment on schema `analytics`,
-- merged across re-runs, so the revert gives back exactly that and nothing PUBLIC did not hold.
do $$
declare
  rels oid[] := array_remove(array[to_regclass('extensions.pg_stat_statements')::oid,
                                   to_regclass('extensions.pg_stat_statements_info')::oid], null);
  -- Every grant on those views, one element per grantee and privilege, PUBLIC named 'PUBLIC'.
  grants constant text := $q$
    select coalesce(jsonb_agg(jsonb_build_object('object', g.object, 'grantee', g.grantee,
                                                 'privilege', g.privilege, 'grantable', g.grantable)
                              order by g.object, g.grantee, g.privilege), '[]'::jsonb)
      from (select format('%I.%I', n.nspname, c.relname) as object,
                   case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end
                     as grantee,
                   a.privilege_type as privilege, a.is_grantable as grantable
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
             cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
             where c.oid = any($1)) g
  $q$;
  before jsonb;
  after jsonb;
  held jsonb;
  kept jsonb;
  e jsonb;
begin
  execute grants into before using rels;
  select coalesce(jsonb_agg(x - 'grantee' - 'grantable' order by x->>'object', x->>'privilege'),
                  '[]'::jsonb)
    into held
    from jsonb_array_elements(before) x
   where x->>'grantee' = 'PUBLIC';

  for e in select jsonb_array_elements(held) loop
    execute format('revoke %s on table %s from public', e->>'privilege', e->>'object');
  end loop;

  execute grants into after using rels;
  if exists (select 1 from jsonb_array_elements(after) x where x->>'grantee' = 'PUBLIC') then
    raise exception 'PUBLIC still holds % after the revoke: the role running this migration could not revoke it',
      (select string_agg(format('%s on %s', x->>'privilege', x->>'object'), ', ')
         from jsonb_array_elements(after) x where x->>'grantee' = 'PUBLIC');
  end if;
  select coalesce(jsonb_agg(x order by x->>'object', x->>'grantee', x->>'privilege'), '[]'::jsonb)
    into kept
    from jsonb_array_elements(before) x
   where x->>'grantee' <> 'PUBLIC';
  if after <> kept then
    raise exception 'a named role''s grant changed: before %, after %', kept, after;
  end if;

  select coalesce(jsonb_agg(x order by x->>'object', x->>'privilege'), '[]'::jsonb)
    into held
    from (select jsonb_array_elements(coalesce(
                   obj_description('analytics'::regnamespace, 'pg_namespace')::jsonb, '[]'::jsonb)) x
          union
          select jsonb_array_elements(held)) u;
  execute format('comment on schema analytics is %L', held::text);
  raise notice 'migration 041: PUBLIC lost %; the named grants on those views are %', held, after;
end;
$$;
