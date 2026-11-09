-- v2 migration 006d (CC-06d): the contract fields CC-12d added that no column held yet.
--
-- Additive. It adds page_results.title and page_results.meta_description, eight access_tests columns
-- (identity_role, tagged, witness, fly_region, request_signing, signature_verified, worker_release,
-- timing), two shape functions for page_results' CHECKs, and widens four enum CHECKs to the values
-- the contract added: other_egress on access_tests.source_ip_class and page_results.source_ip_class,
-- and SignalKind's ucp, rsl, agent_card and llms_full on research.check_runs.signals_detected and
-- signals_indeterminate. No column, policy or grant is dropped or renamed.
--
-- identity_role and tagged are NOT NULL with no default, because no value is right for a row that
-- predates them. The migration therefore refuses while access_tests holds a row and either column is
-- missing; production held none (measured 2026-11-08: no writer exists before CC-20b).
--
-- page_results is written by crawl_worker straight from the worker (owner ruling 1, 2026-11-02), so
-- its new fields' shapes and its rule head_text_absent are CHECKs, as its other fields' are. Only the
-- server writes access_tests, through persist_built_check (008), after the pipeline parses each row
-- with the contract's AccessTestSchema; its new rules are the writer's (RULES_AT_WRITE in
-- apps/web/__tests__/helpers/v2-contract-storage.ts), and its CHECKs hold the enums and the two
-- regular-expression value shapes.
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261108000003_v2_006d_contract_columns.revert.sql.
-- Tested by: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-006d-contract-columns.test.ts \
--   __tests__/v2-contract-guard.test.ts __tests__/v2-003-rule-agreement.test.ts \
--   __tests__/v2-003-contract-fixtures.test.ts __tests__/v2-006b-data-foundations.test.ts

-- ─── The precondition ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if (select count(*) from pg_catalog.pg_attribute
       where attrelid = 'public.access_tests'::regclass
         and attname in ('identity_role', 'tagged') and not attisdropped) < 2
     and exists (select 1 from public.access_tests) then
    raise exception '006d: access_tests holds rows, and identity_role and tagged are NOT NULL with no default'
      using errcode = '55000';
  end if;
end;
$$;

-- ─── page_results: title and meta_description ─────────────────────────────────────────────────────

-- The contract's head text (PageTitleSchema, MetaDescriptionSchema): exactly text (crawled text
-- within p_max_bytes UTF-8 bytes, or null), chars (a safe integer, 0 or more) and cut (a boolean); or
-- a jsonb null, which reads as null to the contract. Whether text and chars agree is
-- v2_head_text_absent_ok's.
create or replace function public.v2_head_text_shape_ok(p_value jsonb, p_max_bytes integer)
returns boolean language plpgsql immutable strict set search_path = pg_catalog
as $f$
begin
  -- One test per statement, as v2_redirect_shape_ok (003).
  if jsonb_typeof(p_value) = 'null' then return true; end if;
  if jsonb_typeof(p_value) <> 'object' then return false; end if;
  if not (p_value ?& array['text', 'chars', 'cut']) then return false; end if;
  if p_value - array['text', 'chars', 'cut'] <> '{}'::jsonb then return false; end if;
  if jsonb_typeof(p_value -> 'cut') <> 'boolean' then return false; end if;
  if jsonb_typeof(p_value -> 'chars') <> 'number' then return false; end if;
  if (p_value ->> 'chars')::numeric not between 0 and 9007199254740991 then return false; end if;
  if (p_value ->> 'chars')::numeric <> trunc((p_value ->> 'chars')::numeric) then return false; end if;
  if p_value -> 'text' = 'null'::jsonb then return true; end if;
  return coalesce(public.v2_crawled_text_ok(p_value -> 'text', p_max_bytes, 0), false);
end;
$f$;

-- The head_text_absent rule: a head text the page does not declare (text null) has no length and was
-- not cut. A value of another shape is the shape CHECK's to refuse.
create or replace function public.v2_head_text_absent_ok(p_value jsonb)
returns boolean language sql immutable strict set search_path = pg_catalog
as $f$
  select case when jsonb_typeof(p_value) = 'object' and p_value -> 'text' = 'null'::jsonb
              then coalesce(p_value -> 'chars' = '0'::jsonb and p_value -> 'cut' = 'false'::jsonb, false)
              else true end
$f$;

revoke all on function public.v2_head_text_shape_ok(jsonb, integer), public.v2_head_text_absent_ok(jsonb)
  from public, anon, authenticated;
grant execute on function public.v2_head_text_shape_ok(jsonb, integer), public.v2_head_text_absent_ok(jsonb)
  to service_role;
-- crawl_worker inserts page_results (007), and its inserts evaluate the CHECKs below, which call these
-- functions: a CHECK's function needs EXECUTE for the role that inserts. Both are immutable shape
-- tests with no side effect and a pinned search_path; no client role may execute them (check 06).
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'crawl_worker') then
    grant execute on function public.v2_head_text_shape_ok(jsonb, integer),
      public.v2_head_text_absent_ok(jsonb) to crawl_worker;
  end if;
end;
$$;

alter table public.page_results add column if not exists title jsonb;
alter table public.page_results add column if not exists meta_description jsonb;

-- TITLE_BYTES and DESCRIPTION_BYTES in packages/types/src/v2/page-result.ts.
alter table public.page_results drop constraint if exists page_results_title;
alter table public.page_results add constraint page_results_title
  check (public.v2_head_text_shape_ok(title, 512));
alter table public.page_results drop constraint if exists page_results_meta_description;
alter table public.page_results add constraint page_results_meta_description
  check (public.v2_head_text_shape_ok(meta_description, 1024));
alter table public.page_results drop constraint if exists page_results_head_text_absent;
alter table public.page_results add constraint page_results_head_text_absent
  check (public.v2_head_text_absent_ok(title) and public.v2_head_text_absent_ok(meta_description));

-- ─── access_tests: identity, vantage and timing ───────────────────────────────────────────────────

alter table public.access_tests add column if not exists identity_role text not null;
alter table public.access_tests add column if not exists tagged boolean not null;
alter table public.access_tests add column if not exists witness jsonb;
alter table public.access_tests add column if not exists fly_region text;
alter table public.access_tests add column if not exists request_signing text;
alter table public.access_tests add column if not exists signature_verified text;
alter table public.access_tests add column if not exists worker_release text;
alter table public.access_tests add column if not exists timing jsonb;

-- The contract's IdentityRole, RequestSigning and SignatureVerification.
alter table public.access_tests drop constraint if exists access_tests_identity_role_check;
alter table public.access_tests add constraint access_tests_identity_role_check
  check (identity_role in ('control', 'crawler', 'canary', 'render'));
alter table public.access_tests drop constraint if exists access_tests_request_signing_check;
alter table public.access_tests add constraint access_tests_request_signing_check
  check (request_signing in ('unsigned'));
alter table public.access_tests drop constraint if exists access_tests_signature_verified_check;
alter table public.access_tests add constraint access_tests_signature_verified_check
  check (signature_verified in ('not_observable'));
-- FlyRegionSchema and WorkerReleaseSchema in packages/types/src/v2/access-test.ts.
alter table public.access_tests drop constraint if exists access_tests_fly_region;
alter table public.access_tests add constraint access_tests_fly_region
  check (fly_region ~ '^[a-z]{3}$');
alter table public.access_tests drop constraint if exists access_tests_worker_release;
alter table public.access_tests add constraint access_tests_worker_release
  check (worker_release ~ '^(?:[0-9a-f]{12}|unreleased)$');

-- ─── The enum CHECKs the contract widened ─────────────────────────────────────────────────────────
-- 003 and 006b wrote them inline, so Postgres named them. Each is found by the catalog as the enum
-- CHECK on its one column (`= ANY (ARRAY[…])`, or `<@ ARRAY[…]` for an array), dropped, and added
-- again under that same name with the contract's values; the block after raises unless exactly that
-- one enum CHECK remains on the column.

do $$
declare
  v_target record;
  v_name text;
begin
  for v_target in
    select * from (values
      ('public.access_tests'::regclass, 'source_ip_class'),
      ('public.page_results'::regclass, 'source_ip_class'),
      ('research.check_runs'::regclass, 'signals_detected'),
      ('research.check_runs'::regclass, 'signals_indeterminate')) as t (rel, col)
  loop
    for v_name in
      select k.conname
        from pg_catalog.pg_constraint k
       where k.conrelid = v_target.rel and k.contype = 'c'
         and k.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
                                where a.attrelid = v_target.rel and a.attname = v_target.col)]::int2[]
         and pg_catalog.pg_get_constraintdef(k.oid) ~ '^CHECK \(\(?\w+ (= ANY \(ARRAY|<@ ARRAY)'
    loop
      execute pg_catalog.format('alter table %s drop constraint %I', v_target.rel, v_name);
    end loop;
  end loop;
end;
$$;

alter table public.access_tests add constraint access_tests_source_ip_class_check
  check (source_ip_class in ('fly_egress', 'browser_rendering', 'owner_logs', 'other_egress'));
alter table public.page_results add constraint page_results_source_ip_class_check
  check (source_ip_class in ('fly_egress', 'browser_rendering', 'owner_logs', 'other_egress'));
alter table research.check_runs add constraint check_runs_signals_detected_check
  check (signals_detected <@ array['schema_org', 'content_signals', 'web_bot_auth', 'llms_txt',
                                   'mcp_server_card', 'markdown_negotiation', 'agent_skills_index',
                                   'ucp', 'rsl', 'agent_card', 'llms_full']);
alter table research.check_runs add constraint check_runs_signals_indeterminate_check
  check (signals_indeterminate <@ array['schema_org', 'content_signals', 'web_bot_auth', 'llms_txt',
                                        'mcp_server_card', 'markdown_negotiation', 'agent_skills_index',
                                        'ucp', 'rsl', 'agent_card', 'llms_full']);

do $$
declare
  v_target record;
begin
  for v_target in
    select * from (values
      ('public.access_tests'::regclass, 'source_ip_class', 'access_tests_source_ip_class_check'),
      ('public.page_results'::regclass, 'source_ip_class', 'page_results_source_ip_class_check'),
      ('research.check_runs'::regclass, 'signals_detected', 'check_runs_signals_detected_check'),
      ('research.check_runs'::regclass, 'signals_indeterminate', 'check_runs_signals_indeterminate_check'))
      as t (rel, col, name)
  loop
    if (select pg_catalog.array_agg(k.conname order by k.conname)
          from pg_catalog.pg_constraint k
         where k.conrelid = v_target.rel and k.contype = 'c'
           and k.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
                                  where a.attrelid = v_target.rel and a.attname = v_target.col)]::int2[]
           and pg_catalog.pg_get_constraintdef(k.oid) ~ '^CHECK \(\(?\w+ (= ANY \(ARRAY|<@ ARRAY)')
       is distinct from array[v_target.name]::name[] then
      raise exception '006d: %.% must have exactly one enum CHECK, %', v_target.rel, v_target.col, v_target.name;
    end if;
  end loop;
end;
$$;

-- ─── Grants ───────────────────────────────────────────────────────────────────────────────────────
-- authenticated reads the new columns as it reads their siblings (003): through the tables' member
-- policies. Check 01 (infra/supabase/checks/01-client-table-privileges.sql) lists them.

grant select (title, meta_description) on public.page_results to authenticated;
grant select (
  identity_role, tagged, witness, fly_region, request_signing, signature_verified, worker_release, timing
) on public.access_tests to authenticated;
