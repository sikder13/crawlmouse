-- Revert of infra/supabase/migrations/20261106000002_v1_client_grant_hardening.sql.
--
-- Returns anon and authenticated to what production held before it ran: every line it removed is
-- granted again and every line it added is revoked, as listed in
-- scripts/db/fixtures/20261106000002-expected-change.json (scripts/db/hardening.test.ts checks this
-- file against that list). This puts back the broad client privileges, so run it only to undo a
-- failed hardening, and take the live smoke again after.

-- The column grants it added, where production had a table-wide SELECT before.
revoke select (domain, id, method, user_id, verification_token, verified_at) on table public.domain_verifications from authenticated;
revoke select (id, pro_until, stripe_customer_id) on table public.users from authenticated;

-- The default privileges for objects postgres creates in public.
alter default privileges for role postgres in schema public grant delete, insert, maintain, references, select, trigger, truncate, update on tables to anon;
alter default privileges for role postgres in schema public grant delete, insert, maintain, references, select, trigger, truncate, update on tables to authenticated;
alter default privileges for role postgres in schema public grant select, update, usage on sequences to anon;
alter default privileges for role postgres in schema public grant select, update, usage on sequences to authenticated;
alter default privileges for role postgres in schema public grant execute on functions to anon;
alter default privileges for role postgres in schema public grant execute on functions to authenticated;

-- Table privileges.
grant delete, insert, maintain, references, trigger, truncate on table public.audits to anon;
grant delete, insert, maintain, references, trigger, truncate on table public.audits to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.benchmark_cohorts to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.benchmark_cohorts to authenticated;
grant maintain, references, select, trigger, truncate on table public.domain_verifications to anon;
grant maintain, references, select, trigger, truncate on table public.domain_verifications to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.email_events to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.email_events to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.embed_badges to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.embed_badges to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.findings to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.findings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.links to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.links to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public.pages to anon;
grant delete, insert, maintain, references, trigger, truncate, update on table public.pages to authenticated;
grant delete, maintain, references, trigger, truncate on table public.public_reports to anon;
grant delete, maintain, references, trigger, truncate on table public.public_reports to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rate_limits to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rate_limits to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.sessions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.sessions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.stripe_events to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.stripe_events to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.takedown_requests to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.takedown_requests to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate on table public.users to anon;
grant delete, insert, maintain, references, select, trigger, truncate on table public.users to authenticated;

-- Column privileges.
grant select (anonymous_session_id, block_rate, blocked_count, branch, canceled_at, cms_detected, cms_metadata, commit_sha, completed_at, confidence, confidence_band, coverage, coverage_pct, crawl_activity, crawl_estimated_total, crawl_phase, deployment_id, discovered_count, environment, expires_at, failure_reason, fetched_ok_count, grade, id, link_count, page_count, pages_crawled, partial, previous_audit_id, projected_grade, projected_score, refusal, score, settings, started_at, status, url, user_id) on table public.audits to anon;
grant select (anonymous_session_id, block_rate, blocked_count, branch, canceled_at, cms_detected, cms_metadata, commit_sha, confidence_band, coverage, coverage_pct, crawl_activity, crawl_estimated_total, crawl_phase, deployment_id, discovered_count, environment, failure_reason, fetched_ok_count, link_count, page_count, pages_crawled, partial, projected_grade, projected_score, refusal, settings, started_at, user_id) on table public.audits to authenticated;
grant select (audit_id, depth, excluded_from_grade, fetch_outcome, id, in_degree, is_orphan, out_degree, pagerank, status_code, title, url, url_hash) on table public.pages to anon;
grant select (audit_id, depth, excluded_from_grade, fetch_outcome, id, in_degree, is_orphan, out_degree, pagerank, status_code, title, url, url_hash) on table public.pages to authenticated;
grant select (audit_id, avg_depth, claimed_at, cms_detected, created_at, domain, grade, hidden_at, indexable, listed, og_image_url, opt_in_leaderboard, orphan_count, report_snapshot, score, slug, takedown_reason, takedown_requested_at, white_label) on table public.public_reports to anon;
grant select (audit_id, avg_depth, claimed_at, cms_detected, created_at, domain, grade, hidden_at, indexable, listed, og_image_url, opt_in_leaderboard, orphan_count, report_snapshot, score, slug, takedown_reason, takedown_requested_at, white_label) on table public.public_reports to authenticated;
