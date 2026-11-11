-- v2 signed-in product (CC-26b D4, D5, D6): the SQL that holds the account's limits and the fix
-- lifecycle, so two concurrent requests cannot both pass a cap. Spec:
-- docs/specs/v2/26b-dashboard-wiring.md. Functions are owned by postgres and revoked from every
-- client role; each section's header names the role each one is granted to. A route checks the
-- caller's membership through the caller's own session before it calls a service_role function.
--
-- The statements are re-runnable (the tests apply the file twice).
-- The revert is infra/supabase/rollbacks/20261112000001_v2_026b_sites_fixes.revert.sql.

-- ═══ A: sites and re-checks (D4, D6) ══════════════════════════════════════════════════════════════

-- ═══ end A ════════════════════════════════════════════════════════════════════════════════════════

-- ═══ B: fixes and the persist watermark (D5) ══════════════════════════════════════════════════════

-- The table fix_email_requests, service_role only. Functions, each security definer with
-- search_path pg_catalog, pg_temp, owned by postgres and revoked from every client role:
-- is_member_for_fix is granted to authenticated and service_role, mark_fix_done and
-- persist_built_check to service_role only.
-- Tests: apps/web/__tests__/v2-026b-fixes.test.ts, apps/web/lib/v2/pipeline/watermark.test.ts and,
-- on a real Postgres, scripts/db/fixes-race.test.ts.

-- ─── fix_email_requests ───────────────────────────────────────────────────────────────────────────
-- A member's request that a fix's packet be emailed to a developer (D9, owner ruling Q8). The address
-- is held here, not in the Inngest event, which names only the row (an address in a third party's
-- event history cannot be erased). CC-28's mailer reads the row and sets sent_at. RLS on and no client
-- grant: the route writes it with the service role once the caller's membership is established.

create table if not exists public.fix_email_requests (
  id uuid primary key default gen_random_uuid(),
  fix_id uuid not null references public.site_fixes (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  requested_by_seat_id uuid references public.seats (id) on delete set null,
  to_email text not null check (char_length(to_email) between 3 and 254),
  requested_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists fix_email_requests_fix_idx on public.fix_email_requests (fix_id);
create index if not exists fix_email_requests_account_idx on public.fix_email_requests (account_id);
create index if not exists fix_email_requests_seat_idx
  on public.fix_email_requests (requested_by_seat_id);

alter table public.fix_email_requests enable row level security;
revoke all on table public.fix_email_requests from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.fix_email_requests to service_role;

-- ─── is_member_for_fix ────────────────────────────────────────────────────────────────────────────
-- is_member_for_site of the fix's site, for the caller's session: site_fixes has no client grant, so
-- a fix route asks this before it makes a service-role client. A boolean only; false for no such fix.

create or replace function public.is_member_for_fix(p_fix uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (select 1 from public.site_fixes f
                  where f.id = p_fix and public.is_member_for_site(f.site_id));
$$;

-- ─── mark_fix_done ────────────────────────────────────────────────────────────────────────────────
-- A member's "I fixed it" (D5), in one transaction: locks the fix, then
--   no such fix                                → {"outcome": "not_found"}
--   its site removed                           → {"outcome": "removed"}
--   p_seat not an active seat of the site's account → raises 22023 (the route passes the caller's own)
--   status marked_done                         → {"outcome": "already"}, nothing written
--   status other than open, reopened, unable_to_verify → {"outcome": "refused", "status": …}
--   otherwise sets status marked_done (rank and every other column kept) and appends a marked_done
--   fix_events row by p_seat, → {"outcome": "marked", "event_id", "at"}.
-- The event's time is the database's clock to the millisecond (the precision a JavaScript Date
-- holds), moved to 1 ms after the fix's latest event when that is not earlier: the engine orders a
-- fix's events by time and refuses a fix whose status is not its last event's consequence.

create or replace function public.mark_fix_done(p_fix uuid, p_seat uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_fix record;
  v_at timestamptz;
  v_event uuid;
begin
  select f.id, f.status, s.account_id, s.removed_at into v_fix
    from public.site_fixes f join public.sites s on s.id = f.site_id
   where f.id = p_fix
     for update of f;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_fix.removed_at is not null then
    return jsonb_build_object('outcome', 'removed');
  end if;
  if not exists (select 1 from public.seats st
                  where st.id = p_seat and st.account_id = v_fix.account_id
                    and st.status = 'active') then
    raise exception 'mark_fix_done: seat % is not an active seat of the fix''s account', p_seat
      using errcode = '22023';
  end if;
  if v_fix.status = 'marked_done' then
    return jsonb_build_object('outcome', 'already');
  end if;
  if v_fix.status not in ('open', 'reopened', 'unable_to_verify') then
    return jsonb_build_object('outcome', 'refused', 'status', v_fix.status);
  end if;

  select greatest(date_trunc('milliseconds', now()),
                  max(e.at) + interval '1 millisecond')
    into v_at
    from public.fix_events e where e.fix_id = p_fix;
  update public.site_fixes set status = 'marked_done' where id = p_fix;
  insert into public.fix_events (id, fix_id, at, kind, by_seat_id, check_id)
  values (gen_random_uuid(), p_fix, v_at, 'marked_done', p_seat, null)
  returning id into v_event;
  return jsonb_build_object('outcome', 'marked', 'event_id', v_event, 'at', v_at);
end;
$$;

-- ─── persist_built_check, with the watermark ──────────────────────────────────────────────────────
-- Migration 008's function (its header states what it does) with three changes:
--   - p carries `read`: [{fix_id, last_event_id}], one per fix the build read, last_event_id the last
--     of that fix's events the build read, or null. A fix whose last event in the table, ordered by
--     (at, id), is not that one is WITHHELD: its site_fixes row is left as it is, and this check's
--     fix_events and changes rows naming it are not written. Each row-count assertion is
--     written + withheld = given, and counts gains fixes_withheld, fix_events_withheld and
--     changes_withheld.
--   - before that comparison it locks the read fixes (in id order), so mark_fix_done waits for it.
--   - it returns `verified`: [{fix_id, type, checks_to_close}] for each verified event it wrote; an
--     answer of {"written": false} carries an empty list, so a repeated call reports none.
-- The revert restores 008's body.

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
  v_expected bigint;
  v_counts jsonb := '{}'::jsonb;
  v_usage_skipped integer := 0;
  v_withheld uuid[];
  v_skipped bigint;
  v_verified jsonb;
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
  foreach v_key in array array['fixes', 'fix_events', 'changes', 'read'] loop
    if jsonb_typeof(p -> v_key) is distinct from 'array' then
      raise exception 'persist_built_check: % is not an array', v_key using errcode = '22023';
    end if;
  end loop;
  foreach v_key in array array['page_results', 'link_edges', 'access_tests'] loop
    if jsonb_typeof(p -> 'staged' -> v_key -> 'chunks') is distinct from 'number'
       or jsonb_typeof(p -> 'staged' -> v_key -> 'rows') is distinct from 'number' then
      raise exception 'persist_built_check: staged.% is not {chunks, rows}', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- 1. The check.
  v_id := (p -> 'check' ->> 'id')::uuid;
  select * into v_check from public.checks where id = v_id for update;
  if not found then
    raise exception 'persist_built_check: check % not found', v_id using errcode = 'P0002';
  end if;
  if v_check.status in ('finished', 'partial') then
    return jsonb_build_object('written', false, 'counts', '{}'::jsonb, 'verified', '[]'::jsonb);
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
  -- The staged chunks: exactly 0 to n−1 of each collection, holding the stated rows.
  foreach v_key in array array['page_results', 'link_edges', 'access_tests'] loop
    if (select count(*) filter (where c.chunk < (p -> 'staged' -> v_key ->> 'chunks')::integer)
                 is distinct from (p -> 'staged' -> v_key ->> 'chunks')::bigint
               or count(*) filter (where c.chunk >= (p -> 'staged' -> v_key ->> 'chunks')::integer) > 0
          from public.persist_chunks c where c.check_id = v_id and c.collection = v_key) then
      raise exception 'persist_built_check: the staged % are not chunks 0 to %', v_key,
        (p -> 'staged' -> v_key ->> 'chunks')::integer - 1 using errcode = '22023';
    end if;
    select coalesce(sum(jsonb_array_length(c.rows)), 0) into v_n
      from public.persist_chunks c where c.check_id = v_id and c.collection = v_key;
    if v_n <> (p -> 'staged' -> v_key ->> 'rows')::bigint then
      raise exception 'persist_built_check: % staged rows of %, not %', v_n, v_key,
        p -> 'staged' -> v_key ->> 'rows' using errcode = '22023';
    end if;
  end loop;
  -- Every row names this check, and every fix and change this check's site.
  if exists (select 1 from public.persist_chunks c, jsonb_array_elements(c.rows) e
              where c.check_id = v_id and (e ->> 'check_id')::uuid is distinct from v_id)
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

  -- 4. The measurement rows, from the staging, which is then deleted.
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
    from public.persist_chunks c
   cross join lateral jsonb_to_recordset(c.rows) as r (
      url text, template_key text, kind text, status_code smallint, depth integer,
      links_in integer, links_out integer, pagerank_share double precision, is_orphan boolean,
      js_only boolean, found_via text, sitemap_lastmod date, suggested_parent_url text,
      sampled boolean, without_js jsonb, crawlers_reached integer, crawlers_reading_text integer,
      content_failures text[], final_url text, redirect jsonb, canonical_declared jsonb,
      hreflang jsonb, content_simhash text, is_html boolean, links_read boolean,
      robots_search jsonb, title jsonb, meta_description jsonb, identity_sent text,
      source_ip_class text, request_headers jsonb, headers jsonb)
   where c.check_id = v_id and c.collection = 'page_results';
  get diagnostics v_n = row_count;
  v_expected := (p -> 'staged' -> 'page_results' ->> 'rows')::bigint;
  if v_n <> v_expected then
    raise exception 'persist_built_check: wrote % of % page_results', v_n, v_expected
      using errcode = 'P0001';
  end if;
  v_counts := v_counts || jsonb_build_object('page_results', v_n);

  insert into public.link_edges (check_id, check_month, lineage_id, from_url, to_url, anchor_text,
                                 is_generic_anchor, js_only)
  select v_id, v_check.check_month, v_fetching, r.from_url, r.to_url, r.anchor_text,
         r.is_generic_anchor, r.js_only
    from public.persist_chunks c
   cross join lateral jsonb_to_recordset(c.rows) as r (
      from_url text, to_url text, anchor_text text, is_generic_anchor boolean, js_only boolean)
   where c.check_id = v_id and c.collection = 'link_edges';
  get diagnostics v_n = row_count;
  v_expected := (p -> 'staged' -> 'link_edges' ->> 'rows')::bigint;
  if v_n <> v_expected then
    raise exception 'persist_built_check: wrote % of % link_edges', v_n, v_expected
      using errcode = 'P0001';
  end if;
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
    from public.persist_chunks c
   cross join lateral jsonb_to_recordset(c.rows) as r (
      id uuid, ua text, page_url text, template_key text, tested_at timestamptz, verdict text,
      evidence_class text, identity_sent text, source_ip_class text, limitations text[],
      cause text, request_headers jsonb, raw_status smallint, final_url text, headers jsonb,
      byte_count bigint, word_count integer, body_excerpt text, method text, http_version text,
      identity_role text, tagged boolean, witness jsonb, fly_region text, request_signing text,
      signature_verified text, worker_release text, timing jsonb)
   where c.check_id = v_id and c.collection = 'access_tests';
  get diagnostics v_n = row_count;
  v_expected := (p -> 'staged' -> 'access_tests' ->> 'rows')::bigint;
  if v_n <> v_expected then
    raise exception 'persist_built_check: wrote % of % access_tests', v_n, v_expected
      using errcode = 'P0001';
  end if;
  v_counts := v_counts || jsonb_build_object('access_tests', v_n);

  delete from public.persist_chunks where check_id = v_id;

  -- 5. Fixes, their events, the changes, the usage event.
  -- The watermark (CC-26b D5): `read` names, for each fix the build read, the last of its events the
  -- build read (null for none). A fix whose last event in the table, by (at, id), is another one
  -- moved after the build read it (a member marked it done), so this check's result for it is
  -- withheld: its row is left as it is, and its events, its changes and its verification are not
  -- written. The fixes are locked first, so a mark made now waits for this transaction and then
  -- sees what it wrote. This check's own events are not in the table yet, so they cannot withhold.
  perform 1 from public.site_fixes f
    where f.id in (select (r ->> 'fix_id')::uuid from jsonb_array_elements(p -> 'read') r)
    order by f.id
    for update;
  select coalesce(array_agg(x.fix_id), '{}') into v_withheld
    from (select (r ->> 'fix_id')::uuid as fix_id, (r ->> 'last_event_id')::uuid as read_last
            from jsonb_array_elements(p -> 'read') r) x
   where (select e.id from public.fix_events e
           where e.fix_id = x.fix_id
           order by e.at desc, e.id desc
           limit 1) is distinct from x.read_last;

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
   where r.id <> all (v_withheld)
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
  select count(*) into v_skipped from jsonb_array_elements(p -> 'fixes') e
   where (e ->> 'id')::uuid = any (v_withheld);
  if v_n + v_skipped <> jsonb_array_length(p -> 'fixes') then
    raise exception 'persist_built_check: wrote % and withheld % of % fixes', v_n, v_skipped,
      jsonb_array_length(p -> 'fixes') using errcode = 'P0001';
  end if;
  v_counts := v_counts || jsonb_build_object('fixes', v_n, 'fixes_withheld', v_skipped);

  if exists (select 1 from jsonb_array_elements(p -> 'fix_events') e
              where not exists (select 1 from public.site_fixes f
                                 where f.id = (e ->> 'fix_id')::uuid and f.site_id = v_check.site_id)) then
    raise exception 'persist_built_check: an event names a fix of another site than check %''s', v_id
      using errcode = '22023';
  end if;
  insert into public.fix_events (id, fix_id, at, kind, by_seat_id, check_id)
  select r.id, r.fix_id, r.at, r.kind, r.by_seat_id, r.check_id
    from jsonb_to_recordset(p -> 'fix_events') as r (
      id uuid, fix_id uuid, at timestamptz, kind text, by_seat_id uuid, check_id uuid)
   where r.fix_id <> all (v_withheld);
  get diagnostics v_n = row_count;
  select count(*) into v_skipped from jsonb_array_elements(p -> 'fix_events') e
   where (e ->> 'fix_id')::uuid = any (v_withheld);
  if v_n + v_skipped <> jsonb_array_length(p -> 'fix_events') then
    raise exception 'persist_built_check: wrote % and withheld % of % fix_events', v_n, v_skipped,
      jsonb_array_length(p -> 'fix_events') using errcode = 'P0001';
  end if;
  v_counts := v_counts || jsonb_build_object('fix_events', v_n, 'fix_events_withheld', v_skipped);

  insert into public.changes (id, site_id, check_id, previous_check_id, detected_at, kind, severity,
                              subject, summary, "where", pages_affected, ua, grade_deltas, cause,
                              fix_id, notified)
  select r.id, v_check.site_id, v_id, r.previous_check_id, r.detected_at, r.kind, r.severity,
         r.subject, r.summary, r."where", r.pages_affected, r.ua, r.grade_deltas, r.cause,
         r.fix_id, r.notified
    from jsonb_to_recordset(p -> 'changes') as r (
      id uuid, previous_check_id uuid, detected_at timestamptz, kind text, severity text,
      subject text, summary text, "where" text, pages_affected integer, ua text,
      grade_deltas jsonb, cause jsonb, fix_id uuid, notified jsonb)
   where r.fix_id is null or r.fix_id <> all (v_withheld);
  get diagnostics v_n = row_count;
  select count(*) into v_skipped from jsonb_array_elements(p -> 'changes') e
   where (e ->> 'fix_id')::uuid = any (v_withheld);
  if v_n + v_skipped <> jsonb_array_length(p -> 'changes') then
    raise exception 'persist_built_check: wrote % and withheld % of % changes', v_n, v_skipped,
      jsonb_array_length(p -> 'changes') using errcode = 'P0001';
  end if;
  v_counts := v_counts || jsonb_build_object('changes', v_n, 'changes_withheld', v_skipped);

  -- The verifications this call wrote (questions.md Q6, plan revision R27): a `verified` event of
  -- this check that was not withheld. checks_to_close counts the site's graded checks queued after
  -- the one that first found the fix, this one included.
  select coalesce(jsonb_agg(jsonb_build_object(
           'fix_id', f.id, 'type', f.type,
           'checks_to_close', 1 + (select count(*) from public.checks c, public.checks first
                                    where first.id = f.first_seen_check_id
                                      and c.site_id = v_check.site_id
                                      and c.id <> v_id
                                      and c.status in ('finished', 'partial')
                                      and c.queued_at > first.queued_at))
           order by f.id), '[]'::jsonb)
    into v_verified
    from jsonb_to_recordset(p -> 'fix_events') as r (fix_id uuid, kind text)
    join public.site_fixes f on f.id = r.fix_id
   where r.kind = 'verified' and r.fix_id <> all (v_withheld);

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

  return jsonb_build_object('written', true, 'counts', v_counts, 'verified', v_verified);
end;
$$;

-- ─── Ownership and grants ─────────────────────────────────────────────────────────────────────────

alter function public.is_member_for_fix(uuid) owner to postgres;
alter function public.mark_fix_done(uuid, uuid) owner to postgres;
alter function public.persist_built_check(jsonb) owner to postgres;

revoke all on function public.is_member_for_fix(uuid), public.mark_fix_done(uuid, uuid),
  public.persist_built_check(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.is_member_for_fix(uuid) to authenticated, service_role;
grant execute on function public.mark_fix_done(uuid, uuid), public.persist_built_check(jsonb)
  to service_role;

-- ═══ end B ════════════════════════════════════════════════════════════════════════════════════════
