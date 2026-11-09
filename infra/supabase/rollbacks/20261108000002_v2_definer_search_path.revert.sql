-- Revert of infra/supabase/migrations/20261108000002_v2_definer_search_path.sql.
--
-- Puts back each function's search_path as production held it on 2026-11-08, before the migration
-- ran. This leaves pg_temp searched first for relations and types again; run it only to undo a
-- failed apply.

alter function public.alert_events_rule_scope() set search_path = public, pg_catalog;
alter function public.alert_rules_entitlement_check() set search_path = public, pg_catalog;
alter function public.alert_rules_fired_check_scope() set search_path = public, pg_catalog;
alter function public.apply_entitlement_transition(uuid, integer, text, text, text, timestamp with time zone, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer, integer, integer, timestamp with time zone, text, timestamp with time zone) set search_path = public, pg_catalog;
alter function public.assert_entitlement_version(uuid, integer) set search_path = public, pg_catalog;
alter function public.crawl_worker_check_id() set search_path = public, pg_catalog;
alter function public.crawl_worker_check_month() set search_path = pg_catalog, public;
alter function public.crawl_worker_lineage_id() set search_path = pg_catalog, public;
alter function public.crawl_worker_part_path_ok(text) set search_path = public, pg_catalog;
alter function public.fix_events_append_only() set search_path = public, pg_catalog;
alter function public.fix_events_references() set search_path = public, pg_catalog;
alter function public.handle_new_user() set search_path = public, pg_catalog;
alter function public.is_member(uuid) set search_path = public, pg_catalog;
alter function public.is_member_for_site(uuid) set search_path = public, pg_catalog;
alter function public.member_role(uuid) set search_path = public, pg_catalog;
alter function public.start_trial_with_ledger(uuid, jsonb, jsonb) set search_path = '';
alter function public.usage_counts(uuid) set search_path = pg_catalog, public;
alter function public.usage_events_append_only() set search_path = pg_catalog, public;
alter function public.usage_events_references() set search_path = pg_catalog, public;
alter function public.v2_premake_month_partitions(date, date) set search_path = pg_catalog;
