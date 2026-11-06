-- Service-role parity: what production holds for service_role that a new branch lacks.
--
-- Supabase creates a branch "without default privileges on the public schema, regardless of the
-- setting on your base project" (its branching docs). Production has 24 such default privileges
-- for postgres in public, and the tables and functions the v1 migrations created there received
-- grants from them that a replay of the same migrations onto a branch does not. The difference, as
-- read on 2026-11-06 from a branch after its replay finished, is in
-- scripts/db/fixtures/2026-11-06-settled-branch-vs-production.json. This file holds its
-- service_role lines and the report-logos bucket, which was made by hand (docs/specs/04-progress-
-- log.md, runbook C). Its anon and authenticated lines are not granted here.
--
-- Production already holds what this file adds, so its fingerprint is expected to read the same
-- before and after; the apply steps in docs/ops/db-migrations.md §9 check that. On a branch it
-- adds them, so the branch matches production. scripts/db/parity.test.ts compares the statements
-- with the fixture's lines.

-- Default privileges for objects postgres creates in public, for service_role only.
alter default privileges for role postgres in schema public grant delete, insert, select, update on tables to service_role;
alter default privileges for role postgres in schema public grant select, update, usage on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- Grants on the v1 tables and functions, for service_role only.
grant delete, insert, select, update on table public.audits to service_role;
grant delete, insert, select, update on table public.benchmark_cohorts to service_role;
grant delete, insert, select, update on table public.domain_verifications to service_role;
grant delete, insert, select, update on table public.email_events to service_role;
grant delete, insert, select, update on table public.embed_badges to service_role;
grant delete, insert, select, update on table public.findings to service_role;
grant delete, insert, select, update on table public.fixes to service_role;
grant delete, insert, select, update on table public.frontier to service_role;
grant delete, insert, select, update on table public.frontier_politeness to service_role;
grant delete, insert, select, update on table public.links to service_role;
grant delete, insert, select, update on table public.pages to service_role;
grant delete, insert, select, update on table public.public_reports to service_role;
grant delete, insert, select, update on table public.rate_limits to service_role;
grant delete, insert, select, update on table public.sessions to service_role;
grant delete, insert, select, update on table public.stripe_events to service_role;
grant delete, insert, select, update on table public.takedown_requests to service_role;
grant delete, insert, select, update on table public.users to service_role;
grant delete, insert, select, update on table public.waitlist to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.increment_rate_limit(p_bucket_key text, p_window_start timestamp with time zone) to service_role;

-- The bucket report logos are uploaded to (apps/web/lib/report-brand.ts). Its other columns keep
-- their defaults, which are production's values (type STANDARD, versioning_status DISABLED,
-- avif_autodetection false). On production the row exists and holds an object, so nothing changes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-logos', 'report-logos', true, 204800, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
