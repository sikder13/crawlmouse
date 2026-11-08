-- SECURITY DEFINER functions search the caller's temporary schema last.
--
-- Postgres searches pg_temp first for relations and types when search_path does not name it, even
-- before pg_catalog. A caller who can create temporary objects could then stand a temp table or a
-- temp domain in for a name a definer function's body writes without a schema, and a domain's CHECK
-- would run as the function's owner. Naming pg_temp last closes that for relations and types;
-- Postgres never looks there for functions or operators.
--
-- This sets search_path on every SECURITY DEFINER function in public but start_trial_with_ledger,
-- whose search_path is already '' (20261108000001). No body changes. pg_catalog moves ahead of public
-- in the paths that listed public first; read on production on 2026-11-08, no public relation, type,
-- function or operator shares a name with a pg_catalog one, so no name resolves differently (the
-- query is in docs/specs/v2/sec-baseline.md).
-- v2_premake_month_partitions searched pg_catalog only and keeps to that, with pg_temp last.
--
-- infra/supabase/checks/09-definer-search-path.sql fails on a definer function this leaves out. The
-- rollback restores each function's previous setting, read from production on 2026-11-08.

alter function public.alert_events_rule_scope() set search_path = pg_catalog, public, pg_temp;
alter function public.alert_rules_entitlement_check() set search_path = pg_catalog, public, pg_temp;
alter function public.alert_rules_fired_check_scope() set search_path = pg_catalog, public, pg_temp;
alter function public.apply_entitlement_transition(uuid, integer, text, text, text, timestamp with time zone, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer, integer, integer, timestamp with time zone, text, timestamp with time zone) set search_path = pg_catalog, public, pg_temp;
alter function public.assert_entitlement_version(uuid, integer) set search_path = pg_catalog, public, pg_temp;
alter function public.crawl_worker_check_id() set search_path = pg_catalog, public, pg_temp;
alter function public.crawl_worker_check_month() set search_path = pg_catalog, public, pg_temp;
alter function public.crawl_worker_lineage_id() set search_path = pg_catalog, public, pg_temp;
alter function public.crawl_worker_part_path_ok(text) set search_path = pg_catalog, public, pg_temp;
alter function public.fix_events_append_only() set search_path = pg_catalog, public, pg_temp;
alter function public.fix_events_references() set search_path = pg_catalog, public, pg_temp;
alter function public.handle_new_user() set search_path = pg_catalog, public, pg_temp;
alter function public.is_member(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.is_member_for_site(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.member_role(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.usage_counts(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.usage_events_append_only() set search_path = pg_catalog, public, pg_temp;
alter function public.usage_events_references() set search_path = pg_catalog, public, pg_temp;
alter function public.v2_premake_month_partitions(date, date) set search_path = pg_catalog, pg_temp;
