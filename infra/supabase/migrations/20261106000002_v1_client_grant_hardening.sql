-- v1 client-grant hardening: anon and authenticated keep only what the v1 app reads.
--
-- The v1 tables were created on production while Supabase's default privileges for postgres in
-- public granted every privilege on new tables, sequences and functions to anon and authenticated.
-- anon held DELETE, INSERT and TRUNCATE on public.users and public.audits, among others; RLS scoped
-- the row-level ones, and nothing but the grant stood in front of TRUNCATE, which RLS does not
-- govern. This revokes every privilege the two client roles hold on the 18 v1 tables and 2 v1
-- functions, revokes those default privileges, and grants back the columns that the dashboard, the
-- Pro and billing checks and the verify page select, filter or order by, running as a signed-in
-- user. anon keeps nothing on them.
--
-- One reader is left without grants on purpose (owner ruling, 2026-11-06): the tRPC procedures in
-- apps/web/lib/trpc/router.ts, audits.getById (public, so also reached as anon) and audits.listMine,
-- have no caller, and the v1.2 API will be built on the v2 tables. After this they answer
-- query_failed; scripts/db/hardening.test.ts runs their exact queries and expects the refusal.
--
-- An RLS policy's own expression needs no column privilege (measured in PGlite on 2026-11-06), so
-- the policies are unchanged and still scope every row.
--
-- The lines this removes and adds on production, read before it ran, are in
-- scripts/db/fixtures/20261106000002-expected-change.json; scripts/db/hardening.test.ts checks this
-- file and its rollback against them, and runs the app's queries as each role after it. Tables
-- created in public by later migrations get no client privileges by default: each migration grants
-- what it needs, explicitly.
--
-- REVOKE ALL on a table also removes its column grants (measured in PGlite on 2026-11-06).

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

revoke all on table public.audits, public.benchmark_cohorts, public.domain_verifications, public.email_events, public.embed_badges, public.findings, public.fixes, public.frontier, public.frontier_politeness, public.links, public.pages, public.public_reports, public.rate_limits, public.sessions, public.stripe_events, public.takedown_requests, public.users, public.waitlist from anon, authenticated;

revoke all on function public.handle_new_user(), public.increment_rate_limit(p_bucket_key text, p_window_start timestamp with time zone) from anon, authenticated;

-- lib/pro.ts:9 and the billing routes (pro_until, stripe_customer_id, filtered by id)
grant select (id, pro_until, stripe_customer_id) on table public.users to authenticated;

-- lib/dashboard.ts:143, the dashboard list (selected, filtered by status and expires_at, ordered by completed_at)
grant select (completed_at, confidence, expires_at, grade, id, previous_audit_id, score, status, url) on table public.audits to authenticated;

-- app/verify/[id]/page.tsx:33 (selected, filtered by id and user_id)
grant select (domain, id, method, user_id, verification_token, verified_at) on table public.domain_verifications to authenticated;
