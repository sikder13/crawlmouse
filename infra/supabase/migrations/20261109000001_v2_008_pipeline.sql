-- v2 migration 008 (CC-20b, ARCH-2 §6.1 row 008): what the check pipeline stores beside a check.
--
-- Additive. It creates public.crawl_batches; adds checks.inngest_run_id, heartbeat_at, diff_inputs
-- and map_path, and sites.next_check_at and schedule_offset_min; adds the unique partial index
-- checks_one_running_per_site and the reaper's index; and creates four functions:
--   claim_check, fail_check, reap_stalled_checks: a check's state moves, each one statement the
--     pipeline (inngest/check.ts, through apps/web/lib/v2/pipeline) calls as service_role;
--   persist_built_check: a built check written whole, in one transaction.
-- No existing column, policy or grant is dropped or renamed. v1 reads none of the new objects.
--
-- Access. RLS is on for crawl_batches, which no client role or crawl_worker may touch; service_role
-- reads and writes it. The new checks and sites columns are not granted to any client role: 003 grants
-- authenticated SELECT on checks and sites column by column, so a column added later stays hidden.
-- Only service_role may execute the four functions.
--
-- search_path. persist_built_check is SECURITY DEFINER (it creates a month's partitions, which
-- service_role may not), with search_path pg_catalog, pg_temp and every other name schema-qualified;
-- the three state functions are SECURITY INVOKER with search_path pg_catalog, public, pg_temp (owner
-- ruling, 2026-11-08).
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261109000001_v2_008_pipeline.revert.sql.
-- Tested by: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-008-pipeline.test.ts \
--   lib/v2/pipeline/persist.test.ts lib/v2/pipeline/round-trip.test.ts

-- ─── crawl_batches: one row per batch the pipeline posted to the worker ───────────────────────────

create table if not exists public.crawl_batches (
  check_id uuid not null references public.checks (id) on delete cascade,
  -- The worker's batch number: one sequence per check, access batches after the crawl's.
  batch integer not null,
  kind text not null check (kind in ('crawl', 'access')),
  -- The single-use nonce the batch was posted with (the worker's BatchRequest.nonce).
  nonce text not null,
  status text not null check (status in ('posted', 'done', 'failed', 'released')),
  posted_at timestamptz not null,
  finished_at timestamptz,
  -- Counts the read step returned, under Inngest's step-output size.
  summary jsonb,
  -- The batch result's object in the private evidence bucket, once stored.
  result_path text,
  primary key (check_id, batch),
  constraint crawl_batches_batch check (batch between 0 and 1000000),
  constraint crawl_batches_nonce check (nonce ~ '^[A-Za-z0-9_-]{16,128}$')
);

alter table public.crawl_batches enable row level security;
revoke all on table public.crawl_batches from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.crawl_batches to service_role;

-- Revoked by name, as 006b does, so a default privilege that names it cannot reach this table.
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'crawl_worker') then
    revoke all on table public.crawl_batches from crawl_worker;
  end if;
end;
$$;

-- ─── checks and sites: the pipeline's columns ─────────────────────────────────────────────────────

-- The Inngest run that claimed the check; a cancelled run is matched to its check by it.
alter table public.checks add column if not exists inngest_run_id text;
-- When the run last showed progress; the reaper fails a check whose heartbeat is too old.
alter table public.checks add column if not exists heartbeat_at timestamptz;
-- What the next check's diff reads of this one (the engine's DiffInputs).
alter table public.checks add column if not exists diff_inputs jsonb;
-- The stored map drawing's object in the evidence bucket.
alter table public.checks add column if not exists map_path text;

-- When the site is next checked on its schedule, and its minute within the scheduled hour.
alter table public.sites add column if not exists next_check_at timestamptz;
alter table public.sites add column if not exists schedule_offset_min smallint;
alter table public.sites drop constraint if exists sites_schedule_offset_min;
alter table public.sites add constraint sites_schedule_offset_min
  check (schedule_offset_min between 0 and 59);

-- One running check per site: Inngest's per-site concurrency key counts executing steps, and a run
-- asleep between polls holds no slot, so the database is what keeps two checks of a site apart.
create unique index if not exists checks_one_running_per_site on public.checks (site_id)
  where status = 'running';
-- reap_stalled_checks reads this expression over the checks still in flight.
create index if not exists checks_heartbeat_idx on public.checks ((coalesce(heartbeat_at, queued_at)))
  where status in ('queued', 'running');

-- ─── claim_check ──────────────────────────────────────────────────────────────────────────────────
-- 'claimed' when it moved the check from queued to running (start time to the millisecond, the
-- precision a JavaScript Date holds; progress, run and heartbeat), and again when the check already
-- runs under the same run (a retried step); 'site_busy' when another check of the site is running
-- (checks_one_running_per_site refused the move); 'gone' otherwise: no such check, another status,
-- or another run.

create or replace function public.claim_check(p_check uuid, p_run text, p_progress jsonb)
returns text
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_constraint text;
begin
  begin
    update public.checks
       set status = 'running',
           started_at = date_trunc('milliseconds', now()),
           progress = p_progress,
           inngest_run_id = p_run,
           heartbeat_at = now()
     where id = p_check and status = 'queued';
    if found then
      return 'claimed';
    end if;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'checks_one_running_per_site' then
      return 'site_busy';
    end if;
    raise;
  end;
  if exists (select 1 from public.checks
              where id = p_check and status = 'running' and inngest_run_id = p_run) then
    return 'claimed';
  end if;
  return 'gone';
end;
$$;

-- ─── fail_check ───────────────────────────────────────────────────────────────────────────────────
-- Moves a queued or running check to failed with p_reason, found by p_check, or by its run when
-- p_check is null: finished now, started now if it never started (the contract gives a failed check a
-- start), progress cleared, and its posted batches released. True only when it made that move.

create or replace function public.fail_check(p_check uuid, p_reason text, p_run text default null)
returns boolean
language sql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
  with failed as (
    update public.checks c
       set status = 'failed',
           failure_reason = p_reason,
           finished_at = date_trunc('milliseconds', now()),
           started_at = coalesce(c.started_at, date_trunc('milliseconds', now())),
           progress = null
     where c.status in ('queued', 'running')
       and case when p_check is not null then c.id = p_check else c.inngest_run_id = p_run end
    returning c.id
  ), released as (
    update public.crawl_batches b
       set status = 'released'
     where b.check_id in (select f.id from failed f) and b.status = 'posted'
  )
  select exists (select 1 from failed)
$$;

-- ─── reap_stalled_checks ──────────────────────────────────────────────────────────────────────────
-- In one statement: every queued or running check whose heartbeat (its queue time when it has none)
-- is before p_cutoff fails as fail_check fails one, with reason not_started when no run claimed it and
-- stalled when one did, and its posted batches are released. Returns the checks it failed.

create or replace function public.reap_stalled_checks(p_cutoff timestamptz)
returns table (check_id uuid, site_id uuid, reason text)
language sql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
  with reaped as (
    update public.checks c
       set status = 'failed',
           failure_reason = case when c.inngest_run_id is null then 'not_started' else 'stalled' end,
           finished_at = date_trunc('milliseconds', now()),
           started_at = coalesce(c.started_at, date_trunc('milliseconds', now())),
           progress = null
     where c.status in ('queued', 'running')
       and coalesce(c.heartbeat_at, c.queued_at) < p_cutoff
    returning c.id, c.site_id, c.failure_reason
  ), released as (
    update public.crawl_batches b
       set status = 'released'
     where b.check_id in (select r.id from reaped r) and b.status = 'posted'
  )
  select r.id, r.site_id, r.failure_reason from reaped r
$$;

-- ─── persist_built_check ──────────────────────────────────────────────────────────────────────────
-- Writes a built check (the engine's BuiltCheck, as apps/web/lib/v2/pipeline/persist.ts sends it after
-- parsing every row with the contract's schemas) in one transaction:
--   1. locks the check; finished or partial already → {"written": false} and no write; any status
--      but running → raises. The built check's id, site, trigger, queue time, start time and grade
--      version must equal the row's, and its status be finished or partial.
--   2. creates the check month's partitions if they are missing.
--   3. records the grading and fetching lineages, each found by its five values when it exists.
--   4. inserts the page results (with the vantage the crawl row carried), link edges and access
--      tests, each naming this check, its month and the fetching lineage.
--   5. upserts the site's fixes by id (a fix of another site is refused), inserts their events and
--      the check's changes, and the usage event while the site still belongs to the event's account
--      (otherwise the event is skipped and counted as skipped).
--   6. updates the check's pipeline-owned columns last, so every checks_* CHECK holds as it ends.
-- Every insert's row count must equal the payload's; a difference raises. It never writes expires_at,
-- result_email, deferred_until or failure_reason. Returns {"written": true, "counts": {…}}.

create or replace function public.persist_built_check(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
  v_check public.checks%rowtype;
  v_new record;
  v_grading uuid;
  v_fetching uuid;
  v_account uuid;
  v_key text;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
  v_usage_skipped integer := 0;
begin
  -- The payload's frame. Each row's fields are the caller's to parse (the contract schemas).
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'check') <> 'object'
     or jsonb_typeof(p -> 'lineages' -> 'grading') <> 'object'
     or jsonb_typeof(p -> 'lineages' -> 'fetching') <> 'object'
     or jsonb_typeof(p -> 'diff_inputs') <> 'object'
     or jsonb_typeof(p -> 'usage_event') not in ('object', 'null')
     or jsonb_typeof(p -> 'map_path') not in ('string', 'null') then
    raise exception 'persist_built_check: p is not a built check' using errcode = '22023';
  end if;
  foreach v_key in array array['page_results', 'link_edges', 'access_tests', 'fixes', 'fix_events',
                               'changes'] loop
    if jsonb_typeof(p -> v_key) is distinct from 'array' then
      raise exception 'persist_built_check: % is not an array', v_key using errcode = '22023';
    end if;
  end loop;

  -- 1. The check.
  v_id := (p -> 'check' ->> 'id')::uuid;
  select * into v_check from public.checks where id = v_id for update;
  if not found then
    raise exception 'persist_built_check: check % not found', v_id using errcode = 'P0002';
  end if;
  if v_check.status in ('finished', 'partial') then
    return jsonb_build_object('written', false, 'counts', '{}'::jsonb);
  end if;
  if v_check.status <> 'running' then
    raise exception 'persist_built_check: check % is %, not running', v_id, v_check.status
      using errcode = '55000';
  end if;
  select * into v_new from jsonb_to_record(p -> 'check') as x (
    site_id uuid, previous_check_id uuid, status text, trigger text, grade_version text,
    queued_at timestamptz, started_at timestamptz, finished_at timestamptz, tested_at timestamptz,
    coverage jsonb, technical_seo jsonb, ai_readability jsonb, structure jsonb, without_js jsonb,
    content jsonb, signals jsonb, crawlers jsonb, stack jsonb, competitors jsonb);
  if v_new.site_id is distinct from v_check.site_id
     or v_new.trigger is distinct from v_check.trigger
     or v_new.grade_version is distinct from v_check.grade_version
     or v_new.queued_at is distinct from v_check.queued_at
     or v_new.started_at is distinct from v_check.started_at then
    raise exception 'persist_built_check: the built check''s site, trigger, grade version, queue time or start time differs from check %', v_id
      using errcode = '22023';
  end if;
  if v_new.status is null or v_new.status not in ('finished', 'partial') then
    raise exception 'persist_built_check: a built check is finished or partial, not %', v_new.status
      using errcode = '22023';
  end if;
  -- Every row names this check, and every fix and change this check's site.
  if exists (select 1 from jsonb_array_elements(p -> 'page_results') e where (e ->> 'check_id')::uuid is distinct from v_id)
     or exists (select 1 from jsonb_array_elements(p -> 'link_edges') e where (e ->> 'check_id')::uuid is distinct from v_id)
     or exists (select 1 from jsonb_array_elements(p -> 'access_tests') e where (e ->> 'check_id')::uuid is distinct from v_id)
     or exists (select 1 from jsonb_array_elements(p -> 'changes') e
                 where (e ->> 'check_id')::uuid is distinct from v_id
                    or (e ->> 'site_id')::uuid is distinct from v_check.site_id)
     or exists (select 1 from jsonb_array_elements(p -> 'fixes') e
                 where (e ->> 'site_id')::uuid is distinct from v_check.site_id)
     or (jsonb_typeof(p -> 'usage_event') = 'object'
         and (p -> 'usage_event' ->> 'check_id')::uuid is distinct from v_id) then
    raise exception 'persist_built_check: a row names another check or site than check %', v_id
      using errcode = '22023';
  end if;

  -- 2. The month's partitions.
  perform public.v2_premake_month_partitions(v_check.check_month, v_check.check_month);

  -- 3. The lineages.
  insert into public.measurement_lineages (id, engine_sha, detector_ruleset_version,
                                           crawler_registry_version, worker_release,
                                           population_version, created_at)
  select (l ->> 'id')::uuid, l ->> 'engine_sha', l ->> 'detector_ruleset_version',
         l ->> 'crawler_registry_version', l ->> 'worker_release', l ->> 'population_version',
         (l ->> 'created_at')::timestamptz
    from jsonb_array_elements(jsonb_build_array(p -> 'lineages' -> 'grading',
                                                p -> 'lineages' -> 'fetching')) l
  on conflict (engine_sha, detector_ruleset_version, crawler_registry_version, worker_release,
               population_version) do nothing;
  select m.id into strict v_grading
    from public.measurement_lineages m, jsonb_extract_path(p, 'lineages', 'grading') l
   where m.engine_sha = l ->> 'engine_sha'
     and m.detector_ruleset_version = l ->> 'detector_ruleset_version'
     and m.crawler_registry_version = l ->> 'crawler_registry_version'
     and m.worker_release is not distinct from l ->> 'worker_release'
     and m.population_version is not distinct from l ->> 'population_version';
  select m.id into strict v_fetching
    from public.measurement_lineages m, jsonb_extract_path(p, 'lineages', 'fetching') l
   where m.engine_sha = l ->> 'engine_sha'
     and m.detector_ruleset_version = l ->> 'detector_ruleset_version'
     and m.crawler_registry_version = l ->> 'crawler_registry_version'
     and m.worker_release is not distinct from l ->> 'worker_release'
     and m.population_version is not distinct from l ->> 'population_version';

  -- 4. The measurement rows.
  insert into public.page_results (
    check_id, check_month, lineage_id, url, template_key, kind, status_code, depth, links_in,
    links_out, pagerank_share, is_orphan, js_only, found_via, sitemap_lastmod, suggested_parent_url,
    sampled, without_js, crawlers_reached, crawlers_reading_text, content_failures, final_url,
    redirect, canonical_declared, hreflang, content_simhash, is_html, links_read, robots_search,
    title, meta_description, identity_sent, source_ip_class, request_headers, headers)
  select v_id, v_check.check_month, v_fetching, r.url, r.template_key, r.kind, r.status_code,
         r.depth, r.links_in, r.links_out, r.pagerank_share, r.is_orphan, r.js_only, r.found_via,
         r.sitemap_lastmod, r.suggested_parent_url, r.sampled, r.without_js, r.crawlers_reached,
         r.crawlers_reading_text, r.content_failures, r.final_url, r.redirect,
         r.canonical_declared, r.hreflang, r.content_simhash, r.is_html, r.links_read,
         r.robots_search, r.title, r.meta_description, r.identity_sent, r.source_ip_class,
         r.request_headers, r.headers
    from jsonb_to_recordset(p -> 'page_results') as r (
      url text, template_key text, kind text, status_code smallint, depth integer,
      links_in integer, links_out integer, pagerank_share double precision, is_orphan boolean,
      js_only boolean, found_via text, sitemap_lastmod date, suggested_parent_url text,
      sampled boolean, without_js jsonb, crawlers_reached integer, crawlers_reading_text integer,
      content_failures text[], final_url text, redirect jsonb, canonical_declared jsonb,
      hreflang jsonb, content_simhash text, is_html boolean, links_read boolean,
      robots_search jsonb, title jsonb, meta_description jsonb, identity_sent text,
      source_ip_class text, request_headers jsonb, headers jsonb);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('page_results', v_n);

  insert into public.link_edges (check_id, check_month, lineage_id, from_url, to_url, anchor_text,
                                 is_generic_anchor, js_only)
  select v_id, v_check.check_month, v_fetching, r.from_url, r.to_url, r.anchor_text,
         r.is_generic_anchor, r.js_only
    from jsonb_to_recordset(p -> 'link_edges') as r (
      from_url text, to_url text, anchor_text text, is_generic_anchor boolean, js_only boolean);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('link_edges', v_n);

  insert into public.access_tests (
    id, check_id, check_month, lineage_id, ua, page_url, template_key, tested_at, verdict,
    evidence_class, identity_sent, source_ip_class, limitations, cause, request_headers, raw_status,
    final_url, headers, byte_count, word_count, body_excerpt, method, http_version, identity_role,
    tagged, witness, fly_region, request_signing, signature_verified, worker_release, timing)
  select r.id, v_id, v_check.check_month, v_fetching, r.ua, r.page_url, r.template_key,
         r.tested_at, r.verdict, r.evidence_class, r.identity_sent, r.source_ip_class,
         r.limitations, r.cause, r.request_headers, r.raw_status, r.final_url, r.headers,
         r.byte_count, r.word_count, r.body_excerpt, r.method, r.http_version, r.identity_role,
         r.tagged, r.witness, r.fly_region, r.request_signing, r.signature_verified,
         r.worker_release, r.timing
    from jsonb_to_recordset(p -> 'access_tests') as r (
      id uuid, ua text, page_url text, template_key text, tested_at timestamptz, verdict text,
      evidence_class text, identity_sent text, source_ip_class text, limitations text[],
      cause text, request_headers jsonb, raw_status smallint, final_url text, headers jsonb,
      byte_count bigint, word_count integer, body_excerpt text, method text, http_version text,
      identity_role text, tagged boolean, witness jsonb, fly_region text, request_signing text,
      signature_verified text, worker_release text, timing jsonb);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('access_tests', v_n);

  -- 5. Fixes, their events, the changes, the usage event.
  insert into public.site_fixes (
    id, site_id, fingerprint, number, type, section, title, detail, recommendation_class, status,
    last_state, last_measured_check_id, first_seen_check_id, confidence, affected_pages,
    template_key, crawler_uas, rank, effect, effort, before_after, packet, gone)
  select r.id, v_check.site_id, r.fingerprint, r.number, r.type, r.section, r.title, r.detail,
         r.recommendation_class, r.status, r.last_state, r.last_measured_check_id,
         r.first_seen_check_id, r.confidence, r.affected_pages, r.template_key, r.crawler_uas,
         r.rank, r.effect, r.effort, r.before_after, r.packet, r.gone
    from jsonb_to_recordset(p -> 'fixes') as r (
      id uuid, fingerprint text, number integer, type text, section text, title text, detail text,
      recommendation_class text, status text, last_state text, last_measured_check_id uuid,
      first_seen_check_id uuid, confidence text, affected_pages integer, template_key text,
      crawler_uas text[], rank integer, effect jsonb, effort jsonb, before_after jsonb,
      packet jsonb, gone jsonb)
  on conflict (id) do update
     set fingerprint = excluded.fingerprint, number = excluded.number, type = excluded.type,
         section = excluded.section, title = excluded.title, detail = excluded.detail,
         recommendation_class = excluded.recommendation_class, status = excluded.status,
         last_state = excluded.last_state,
         last_measured_check_id = excluded.last_measured_check_id,
         first_seen_check_id = excluded.first_seen_check_id, confidence = excluded.confidence,
         affected_pages = excluded.affected_pages, template_key = excluded.template_key,
         crawler_uas = excluded.crawler_uas, rank = excluded.rank, effect = excluded.effect,
         effort = excluded.effort, before_after = excluded.before_after, packet = excluded.packet,
         gone = excluded.gone
   -- A fix id of another site is not updated, so the count below refuses it.
   where public.site_fixes.site_id = excluded.site_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('fixes', v_n);

  if exists (select 1 from jsonb_array_elements(p -> 'fix_events') e
              where not exists (select 1 from public.site_fixes f
                                 where f.id = (e ->> 'fix_id')::uuid and f.site_id = v_check.site_id)) then
    raise exception 'persist_built_check: an event names a fix of another site than check %''s', v_id
      using errcode = '22023';
  end if;
  insert into public.fix_events (id, fix_id, at, kind, by_seat_id, check_id)
  select r.id, r.fix_id, r.at, r.kind, r.by_seat_id, r.check_id
    from jsonb_to_recordset(p -> 'fix_events') as r (
      id uuid, fix_id uuid, at timestamptz, kind text, by_seat_id uuid, check_id uuid);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('fix_events', v_n);

  insert into public.changes (id, site_id, check_id, previous_check_id, detected_at, kind, severity,
                              subject, summary, "where", pages_affected, ua, grade_deltas, cause,
                              fix_id, notified)
  select r.id, v_check.site_id, v_id, r.previous_check_id, r.detected_at, r.kind, r.severity,
         r.subject, r.summary, r."where", r.pages_affected, r.ua, r.grade_deltas, r.cause,
         r.fix_id, r.notified
    from jsonb_to_recordset(p -> 'changes') as r (
      id uuid, previous_check_id uuid, detected_at timestamptz, kind text, severity text,
      subject text, summary text, "where" text, pages_affected integer, ua text,
      grade_deltas jsonb, cause jsonb, fix_id uuid, notified jsonb);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('changes', v_n);

  v_n := 0;
  if jsonb_typeof(p -> 'usage_event') = 'object' then
    select s.account_id into v_account from public.sites s where s.id = v_check.site_id for share;
    if v_account is not distinct from (p -> 'usage_event' ->> 'account_id')::uuid then
      insert into public.usage_events (id, account_id, kind, check_id, report_id, result, billable,
                                       compute_seconds, request_count, occurred_at, idempotency_key)
      select r.id, r.account_id, r.kind, v_id, r.report_id, r.result, r.billable,
             r.compute_seconds, r.request_count, r.occurred_at, 'usage:' || v_id::text
        from jsonb_to_record(p -> 'usage_event') as r (
          id uuid, account_id uuid, kind text, report_id uuid, result text, billable boolean,
          compute_seconds double precision, request_count integer, occurred_at timestamptz);
      get diagnostics v_n = row_count;
    else
      v_usage_skipped := 1;
    end if;
  end if;
  v_counts := v_counts || jsonb_build_object('usage_events', v_n, 'usage_events_skipped', v_usage_skipped);

  foreach v_key in array array['page_results', 'link_edges', 'access_tests', 'fixes', 'fix_events',
                               'changes'] loop
    if (v_counts ->> v_key)::bigint <> jsonb_array_length(p -> v_key) then
      raise exception 'persist_built_check: wrote % of % %', v_counts ->> v_key,
        jsonb_array_length(p -> v_key), v_key using errcode = 'P0001';
    end if;
  end loop;

  -- 6. The check, last. Contract nulls arrive as JSON null, which jsonb_to_record reads as SQL null.
  update public.checks
     set status = v_new.status,
         previous_check_id = v_new.previous_check_id,
         finished_at = v_new.finished_at,
         tested_at = v_new.tested_at,
         coverage = v_new.coverage,
         technical_seo = v_new.technical_seo,
         ai_readability = v_new.ai_readability,
         structure = v_new.structure,
         without_js = v_new.without_js,
         content = v_new.content,
         signals = v_new.signals,
         crawlers = v_new.crawlers,
         stack = v_new.stack,
         competitors = v_new.competitors,
         progress = null,
         lineage_id = v_grading,
         diff_inputs = p -> 'diff_inputs',
         map_path = p ->> 'map_path',
         heartbeat_at = now()
   where id = v_id;

  return jsonb_build_object('written', true, 'counts', v_counts);
end;
$$;

-- ─── Ownership and grants ─────────────────────────────────────────────────────────────────────────

alter function public.claim_check(uuid, text, jsonb) owner to postgres;
alter function public.fail_check(uuid, text, text) owner to postgres;
alter function public.reap_stalled_checks(timestamptz) owner to postgres;
alter function public.persist_built_check(jsonb) owner to postgres;

revoke all on function public.claim_check(uuid, text, jsonb), public.fail_check(uuid, text, text),
  public.reap_stalled_checks(timestamptz), public.persist_built_check(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_check(uuid, text, jsonb), public.fail_check(uuid, text, text),
  public.reap_stalled_checks(timestamptz), public.persist_built_check(jsonb)
  to service_role;
